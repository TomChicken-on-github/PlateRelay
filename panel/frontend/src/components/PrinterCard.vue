<script setup lang="ts">
import { computed } from 'vue';
import type { Printer } from '../types';
import AmsSlot from './AmsSlot.vue';

const props = defineProps<{
  printer: Printer;
}>();

const isPrinting = computed(() => props.printer.state === 'PRINTING');
const isIdle = computed(() => props.printer.state === 'IDLE');
const isClearing = computed(() => props.printer.state === 'CLEARING_REQUIRED');
const isOffline = computed(() => props.printer.state === 'OFFLINE');
const isPaused = computed(() => props.printer.state === 'PAUSED');

const stateConfig = computed(() => {
  switch (props.printer.state) {
    case 'PRINTING':
      return {
        label: '打印中',
        badgeClass: 'badge-printing',
        dotClass: 'bg-emerald-400 pulse-dot-green',
        borderClass: 'border-emerald-500/30'
      };
    case 'IDLE':
      return {
        label: '待命中',
        badgeClass: 'badge-idle',
        dotClass: 'bg-green-400',
        borderClass: 'border-green-500/20'
      };
    case 'CLEARING_REQUIRED':
      return {
        label: '待清台',
        badgeClass: 'badge-clearing',
        dotClass: 'bg-amber-400 animate-bounce',
        borderClass: 'border-amber-500/30'
      };
    case 'PAUSED':
      return {
        label: '已暂停',
        badgeClass: 'badge-paused',
        dotClass: 'bg-yellow-400',
        borderClass: 'border-yellow-500/30'
      };
    case 'OFFLINE':
    default:
      return {
        label: '离线',
        badgeClass: 'badge-offline',
        dotClass: 'bg-slate-400',
        borderClass: 'border-slate-800'
      };
  }
});

const modelBadgeClass = computed(() => {
  const m = props.printer.model.toLowerCase();
  if (m.includes('x1')) return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30';
  if (m.includes('p1')) return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
  if (m.includes('a1')) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
  if (m.includes('x2')) return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30';
  return 'bg-purple-500/10 text-purple-400 border-purple-500/30';
});
</script>

<template>
  <div 
    class="naive-card flex flex-col justify-between overflow-hidden relative p-4 transition-all duration-300"
    :class="stateConfig.borderClass"
  >
    <!-- Top Bar: Model Badge + Title + Status Pill -->
    <div class="flex items-start justify-between gap-2 mb-3">
      <div class="flex flex-col min-w-0">
        <div class="flex items-center gap-1.5 mb-1">
          <span 
            class="px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider border"
            :class="modelBadgeClass"
          >
            {{ printer.model }}
          </span>
          <span class="text-xs font-mono text-slate-400 truncate max-w-[110px]" :title="printer.serial_number">
            {{ printer.serial_number }}
          </span>
        </div>
        <h3 class="text-base font-semibold text-slate-100 truncate tracking-tight">
          {{ printer.name }}
        </h3>
      </div>

      <!-- Status Pill -->
      <div 
        class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium tracking-wide shadow-sm"
        :class="stateConfig.badgeClass"
      >
        <span class="w-2 h-2 rounded-full" :class="stateConfig.dotClass" />
        <span>{{ stateConfig.label }}</span>
      </div>
    </div>

    <!-- Center Section: Contextual by State -->
    <div class="py-2 mb-3">
      <!-- 1. PRINTING STATE -->
      <div v-if="isPrinting" class="space-y-3">
        <!-- Progress Bar & Big Percent -->
        <div>
          <div class="flex items-baseline justify-between mb-1.5">
            <span class="text-2xl font-bold tracking-tight text-emerald-400 font-mono">
              {{ printer.progress.toFixed(1) }}%
            </span>
            <span class="text-xs text-slate-300 font-medium">
              预计剩余 <strong class="text-slate-100 font-mono">{{ printer.remaining_time_min }}</strong> 分钟
            </span>
          </div>
          <!-- Progress bar -->
          <div class="w-full h-2 rounded-full bg-[#1e2430] overflow-hidden p-[1px]">
            <div 
              class="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-700 ease-out shadow-[0_0_8px_rgba(16,185,129,0.4)]"
              :style="{ width: `${Math.min(100, Math.max(0, printer.progress))}%` }"
            />
          </div>
        </div>

        <!-- Task & Layer Info -->
        <div class="flex items-center justify-between text-xs text-slate-300 bg-[#191f2c] px-3 py-1.5 rounded-lg border border-[#2b3343]">
          <span class="truncate max-w-[160px] font-medium" :title="printer.task_name || '未命名工单'">
            📄 {{ printer.task_name || '任务运行中' }}
          </span>
          <span class="font-mono text-slate-400">
            第 {{ printer.current_layer }} / {{ printer.total_layers }} 层
          </span>
        </div>
      </div>

      <!-- 2. IDLE STATE -->
      <div v-else-if="isIdle" class="py-4 px-3 rounded-lg bg-[#18202d]/70 border border-emerald-500/20 text-center">
        <div class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-400 mb-1.5">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p class="text-sm font-medium text-emerald-300">就绪 · 待命排产</p>
        <p class="text-xs text-slate-400 mt-0.5">热床已清理，随时可承接新任务</p>
      </div>

      <!-- 3. CLEARING_REQUIRED STATE -->
      <div v-else-if="isClearing" class="py-4 px-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-center">
        <div class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-500/20 text-amber-300 mb-1.5">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <p class="text-sm font-medium text-amber-300">打印完工 · 待清台铲件</p>
        <p class="text-xs text-slate-400 mt-0.5">请志愿者移走成品并打卡放行</p>
      </div>

      <!-- 4. OFFLINE STATE -->
      <div v-else class="py-4 px-3 rounded-lg bg-[#181d27] border border-[#2b3343] text-center">
        <div class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-slate-800 text-slate-400 mb-1.5">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 4.243a9 9 0 01-2.828-5.657m0 0l2.828-2.829m-2.828 2.829L3 3" />
          </svg>
        </div>
        <p class="text-sm font-medium text-slate-300">机台离线 · 等待连接</p>
        <p class="text-xs text-slate-400 mt-0.5">
          {{ printer.status_message || '请确认机床电源与局域网模式' }}
        </p>
      </div>
    </div>

    <!-- Temperature & Sensors Bar -->
    <div class="grid grid-cols-2 gap-2 mb-3 pt-2 border-t border-[#232936]">
      <!-- Nozzle -->
      <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#181e2a] border border-[#262f40]">
        <span class="text-orange-400 text-sm">🔥</span>
        <div class="flex flex-col min-w-0">
          <span class="text-[10px] text-slate-400 leading-none">喷头温度</span>
          <span class="text-xs font-mono font-medium text-slate-200 mt-0.5">
            {{ printer.temperatures.nozzle.toFixed(0) }}°C
            <span class="text-[10px] text-slate-400">/ {{ printer.temperatures.nozzle_target.toFixed(0) }}°C</span>
          </span>
        </div>
      </div>

      <!-- Heatbed -->
      <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#181e2a] border border-[#262f40]">
        <span class="text-amber-400 text-sm">♨️</span>
        <div class="flex flex-col min-w-0">
          <span class="text-[10px] text-slate-400 leading-none">热床温度</span>
          <span class="text-xs font-mono font-medium text-slate-200 mt-0.5">
            {{ printer.temperatures.bed.toFixed(0) }}°C
            <span class="text-[10px] text-slate-400">/ {{ printer.temperatures.bed_target.toFixed(0) }}°C</span>
          </span>
        </div>
      </div>
    </div>

    <!-- AMS Multi-Color Slots Strip -->
    <div v-if="printer.ams_trays && printer.ams_trays.length > 0" class="mb-3">
      <div class="flex items-center justify-between text-[11px] text-slate-400 mb-1.5 px-0.5">
        <span class="font-medium">AMS 供料系统 ({{ printer.ams_trays.length }} 槽)</span>
        <span class="text-[10px] text-slate-400">自动对齐</span>
      </div>
      <div class="grid grid-cols-4 gap-1.5">
        <AmsSlot 
          v-for="tray in printer.ams_trays" 
          :key="tray.id" 
          :tray="tray" 
        />
      </div>
    </div>

    <!-- Footer: IP & Hardware Read-Only Badge -->
    <div class="pt-2 border-t border-[#232936] flex items-center justify-between text-[11px] text-slate-400">
      <span class="font-mono truncate max-w-[150px]">
        IP: {{ printer.ip_address || '127.0.0.1' }}
      </span>
      <span class="inline-flex items-center gap-1 text-[10px] text-emerald-400/90 font-medium">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400" /> 只读监视
      </span>
    </div>
  </div>
</template>
