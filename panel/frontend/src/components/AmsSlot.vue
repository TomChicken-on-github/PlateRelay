<script setup lang="ts">
import type { AmsTray } from '../types';

defineProps<{
  tray: AmsTray;
}>();

function parseHexColor(color: string): string {
  if (!color) return '#64748b';
  const clean = color.trim().replace(/^#/, '');
  if (clean.length === 6) return `#${clean}`;
  if (clean.length === 8) return `#${clean.slice(0, 6)}`;
  return '#64748b';
}
</script>

<template>
  <div 
    class="relative group flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[#181d27] border transition-all duration-200"
    :class="tray.is_active 
      ? 'border-emerald-500/60 shadow-[0_0_10px_rgba(16,185,129,0.18)] bg-[#13221c]' 
      : 'border-[#28303e] hover:border-slate-600'"
    :title="`AMS 料槽 ${tray.id + 1}: ${tray.tray_type} (${tray.remain_percent ?? 100}%)`"
  >
    <!-- Slot active indicator -->
    <span 
      v-if="tray.is_active" 
      class="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-[#13221c] animate-pulse"
    />

    <!-- Color circle -->
    <div 
      class="w-3.5 h-3.5 rounded-full border border-black/50 shadow-inner flex-shrink-0"
      :style="{ backgroundColor: parseHexColor(tray.tray_color) }"
    />

    <div class="flex flex-col min-w-0">
      <span class="text-[11px] font-semibold text-slate-200 truncate leading-tight">
        {{ tray.tray_type || 'EMPTY' }}
      </span>
      <span class="text-[9px] text-slate-400 leading-none">
        {{ tray.remain_percent !== undefined ? `${tray.remain_percent}%` : '--' }}
      </span>
    </div>
  </div>
</template>
