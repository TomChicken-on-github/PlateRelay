<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { Printer, FleetSnapshotMessage, FleetUpdateMessage } from './types';
import PrinterCard from './components/PrinterCard.vue';

const printers = ref<Printer[]>([]);
const isConnected = ref(false);
const latencyMs = ref<number | null>(null);
const reconnectAttempts = ref(0);
const searchQuery = ref('');
const selectedStateFilter = ref<string>('ALL');

let ws: WebSocket | null = null;
let pingInterval: number | null = null;
let reconnectTimer: number | null = null;
let pingStartTime = 0;

// Fleet Summary Computed Stats
const totalCount = computed(() => printers.value.length);
const printingCount = computed(() => printers.value.filter(p => p.state === 'PRINTING').length);
const idleCount = computed(() => printers.value.filter(p => p.state === 'IDLE').length);
const clearingCount = computed(() => printers.value.filter(p => p.state === 'CLEARING_REQUIRED').length);
const offlineCount = computed(() => printers.value.filter(p => p.state === 'OFFLINE').length);

// Filtered & Sorted Printers
const filteredPrinters = computed(() => {
  return printers.value.filter(p => {
    // State Filter
    if (selectedStateFilter.value !== 'ALL' && p.state !== selectedStateFilter.value) {
      return false;
    }
    // Search Filter
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase().trim();
      const matchName = p.name.toLowerCase().includes(q);
      const matchModel = p.model.toLowerCase().includes(q);
      const matchSerial = p.serial_number.toLowerCase().includes(q);
      return matchName || matchModel || matchSerial;
    }
    return true;
  });
});

function connectWebSocket() {
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const wsUrl = `${protocol}//${host}/api/v1/ws/dashboard`;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      isConnected.value = true;
      reconnectAttempts.value = 0;
      startHeartbeat();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'FLEET_SNAPSHOT') {
          printers.value = (data as FleetSnapshotMessage).printers;
        } else if (data.type === 'FLEET_UPDATE') {
          printers.value = (data as FleetUpdateMessage).printers;
        } else if (data.type === 'PONG') {
          if (pingStartTime > 0) {
            latencyMs.value = Math.max(1, Math.round(performance.now() - pingStartTime));
          }
        }
      } catch (err) {
        console.error('Failed to parse incoming WebSocket message:', err);
      }
    };

    ws.onclose = () => {
      isConnected.value = false;
      stopHeartbeat();
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.warn('Dashboard WebSocket encounter:', err);
      try { ws?.close(); } catch {}
    };
  } catch (e) {
    scheduleReconnect();
  }
}

function startHeartbeat() {
  stopHeartbeat();
  pingInterval = window.setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      pingStartTime = performance.now();
      ws.send(JSON.stringify({ type: 'PING' }));
    }
  }, 5000);
}

function stopHeartbeat() {
  if (pingInterval !== null) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimer !== null) return;
  reconnectAttempts.value++;
  // Exponential backoff capped at 5s
  const delay = Math.min(5000, 1000 * Math.pow(1.5, Math.min(reconnectAttempts.value, 6)));
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, delay);
}

onMounted(() => {
  connectWebSocket();
});

onUnmounted(() => {
  stopHeartbeat();
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
});
</script>

<template>
  <div class="min-h-screen bg-[#0b0e14] text-slate-100 flex flex-col">
    <!-- Top Header Navigation -->
    <header class="sticky top-0 z-30 bg-[#12161f]/95 backdrop-blur border-b border-[#242b38] px-6 py-3.5 shadow-md">
      <div class="max-w-[1700px] mx-auto flex flex-wrap items-center justify-between gap-4">
        <!-- Logo & Branding -->
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-white shadow-lg shadow-emerald-900/30">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h1 class="text-lg font-bold tracking-tight text-white leading-none">
                PlateRelay
              </h1>
              <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                EVENT MODE · 黑客松赛事
              </span>
            </div>
            <p class="text-[11px] text-slate-400 mt-0.5 leading-none">
              局域网共享 3D 打印服务中枢 · 多机台大屏监控
            </p>
          </div>
        </div>

        <!-- Real-Time Metrics Summary Pills -->
        <div class="flex items-center gap-2 text-xs">
          <!-- Total -->
          <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181e2b] border border-[#273042]">
            <span class="text-slate-400">机群总数</span>
            <span class="font-bold text-slate-100 font-mono">{{ totalCount }}</span>
          </div>

          <!-- Printing -->
          <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
            <span class="w-2 h-2 rounded-full bg-emerald-400 pulse-dot-green" />
            <span>打印中</span>
            <span class="font-bold font-mono">{{ printingCount }}</span>
          </div>

          <!-- Idle -->
          <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400">
            <span class="w-2 h-2 rounded-full bg-green-400" />
            <span>待命</span>
            <span class="font-bold font-mono">{{ idleCount }}</span>
          </div>

          <!-- Clearing -->
          <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-400">
            <span class="w-2 h-2 rounded-full bg-amber-400" />
            <span>待铲台</span>
            <span class="font-bold font-mono">{{ clearingCount }}</span>
          </div>

          <!-- Offline -->
          <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300">
            <span class="w-2 h-2 rounded-full bg-slate-400" />
            <span>离线</span>
            <span class="font-bold font-mono">{{ offlineCount }}</span>
          </div>

          <!-- Connection Status -->
          <div 
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ml-2 text-xs font-medium"
            :class="isConnected 
              ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300' 
              : 'bg-rose-950/40 border-rose-500/30 text-rose-300'"
          >
            <span 
              class="w-2 h-2 rounded-full" 
              :class="isConnected ? 'bg-emerald-400' : 'bg-rose-400 animate-ping'" 
            />
            <span v-if="isConnected">
              实时推流 {{ latencyMs ? `(${latencyMs}ms)` : '' }}
            </span>
            <span v-else>
              连接断开 (正在重连...)
            </span>
          </div>
        </div>
      </div>
    </header>

    <!-- Sub-Navbar: Filters & Search Controls -->
    <div class="max-w-[1700px] w-full mx-auto px-6 pt-5 pb-3 flex flex-wrap items-center justify-between gap-3">
      <!-- State Filters -->
      <div class="flex items-center gap-1.5 p-1 rounded-xl bg-[#141923] border border-[#262e3d] text-xs">
        <button
          v-for="filter in [
            { key: 'ALL', label: '全部机台' },
            { key: 'PRINTING', label: '打印中' },
            { key: 'IDLE', label: '待命中' },
            { key: 'CLEARING_REQUIRED', label: '待清台' },
            { key: 'OFFLINE', label: '离线' },
          ]"
          :key="filter.key"
          @click="selectedStateFilter = filter.key"
          class="px-3 py-1.5 rounded-lg font-medium transition-all"
          :class="selectedStateFilter === filter.key 
            ? 'bg-emerald-600 text-white shadow-sm font-semibold' 
            : 'text-slate-400 hover:text-slate-200 hover:bg-[#1c2230]'"
        >
          {{ filter.label }}
        </button>
      </div>

      <!-- Search Input -->
      <div class="relative min-w-[260px]">
        <input 
          v-model="searchQuery" 
          type="text" 
          placeholder="搜索机型 / 名称 / 序列号..." 
          class="w-full bg-[#141923] border border-[#262e3d] rounded-xl px-3.5 py-1.5 text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/40 transition-all"
        />
        <span class="absolute right-3 top-2 text-slate-400 text-xs">🔍</span>
      </div>
    </div>

    <!-- Main Grid Content -->
    <main class="max-w-[1700px] w-full mx-auto px-6 py-4 flex-1">
      <!-- Empty State -->
      <div 
        v-if="filteredPrinters.length === 0" 
        class="py-16 text-center rounded-2xl bg-[#121620] border border-dashed border-[#262f3f] my-6"
      >
        <p class="text-base font-semibold text-slate-300">暂无符合条件的打印机</p>
        <p class="text-xs text-slate-400 mt-1">
          {{ printers.length === 0 ? '正在等待节点探针 (Daemon) 上报数据，请确认 Daemon 进程已启动。' : '请尝试清空搜索条件或切换状态筛选。' }}
        </p>
      </div>

      <!-- Cards Grid -->
      <div 
        v-else 
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"
      >
        <PrinterCard 
          v-for="p in filteredPrinters" 
          :key="p.id" 
          :printer="p" 
        />
      </div>
    </main>

    <!-- Bottom Read-Only Safety Banner -->
    <footer class="mt-auto border-t border-[#1e2533] bg-[#0e1219] px-6 py-2.5 text-center text-[11px] text-slate-400">
      <div class="max-w-[1700px] mx-auto flex items-center justify-between">
        <span class="inline-flex items-center gap-1.5 text-emerald-400/90 font-medium">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          物理安全防线激活：当前处于 Milestone 1 纯遥测监视阶段，下行打印控制已被熔断，真实机床受被动保护。
        </span>
        <span class="font-mono text-slate-400">
          PlateRelay v0.1.0 · WebSocket Telemetry Hub
        </span>
      </div>
    </footer>
  </div>
</template>
