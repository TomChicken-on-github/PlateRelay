<script setup lang="ts">
import { computed } from 'vue';
import WavyProgress from './WavyProgress.vue';
import type { Printer } from '../types';
import cameraFallback from '../assets/dashboard/8f1af.png';
import printerIcon from '../assets/dashboard/7b5f4.svg';
import activeDot from '../assets/dashboard/b008f.svg';
import avatarIcon from '../assets/dashboard/a118a.svg';
import errorIcon from '../assets/dashboard/70824.svg';
import lockIcon from '../assets/dashboard/a099e.svg';

const props = withDefaults(
  defineProps<{
    printer: Printer;
    currentTime?: number;
  }>(),
  {
    currentTime: () => Math.floor(Date.now() / 1000),
  }
);

const emit = defineEmits<{
  (e: 'select', id: string): void;
}>();
const progress = computed(() => Math.min(100, Math.max(0, props.printer.progress)));

// Dual-nozzle detection: either nozzle_2 is reported or model indicates dual head (e.g. X2D)
const isDualNozzle = computed(() => {
  return (
    props.printer.temperatures.nozzle_2 !== undefined ||
    props.printer.model.toLowerCase().includes('x2d')
  );
});

// Determine UI variant based on printer state and messages
const cardVariant = computed<'printing' | 'error' | 'blocked' | 'clearing' | 'offline' | 'idle' | 'preparing'>(() => {
  const state = props.printer.state;
  if (state === 'OFFLINE') return 'offline';
  if (state === 'CLEARING_REQUIRED') return 'clearing';
  if (state === 'PRINTING') return 'printing';
  if (state === 'PREPARING') return 'preparing';
  if (state === 'PAUSED') {
    const msg = (props.printer.status_message || '').toLowerCase();
    if (msg.includes('ams') || msg.includes('耗材') || msg.includes('blocked')) {
      return 'blocked';
    }
    return 'error';
  }
  return 'idle';
});

// Status label and color variant
const statusInfo = computed(() => {
  switch (props.printer.state) {
    case 'PRINTING':
      return { label: '打印中', class: 'status-printing' };
    case 'CLEARING_REQUIRED':
      return { label: '待清台', class: 'status-clearing' };
    case 'PAUSED': {
      const msg = (props.printer.status_message || '').toLowerCase();
      if (msg.includes('ams') || msg.includes('耗材') || msg.includes('blocked')) {
        return { label: '问题', class: 'status-blocked' };
      }
      return { label: '故障', class: 'status-error' };
    }
    case 'PREPARING':
      return { label: '预热', class: 'status-preparing' };
    case 'OFFLINE':
      return { label: '离线', class: 'status-offline' };
    case 'UNMANAGED_PRINTING':
      return { label: '未登记', class: 'status-warning' };
    case 'IDLE':
    default:
      return { label: '就绪', class: 'status-idle' };
  }
});

// Safety / warning banner
const safetyBanner = computed<{ show: boolean; icon: string; text: string; isDanger: boolean }>(() => {
  const variant = cardVariant.value;
  if (variant === 'error') {
    return {
      show: true,
      icon: errorIcon,
      text: props.printer.status_message || 'A2 断料 · 请暂停后补料并复核',
      isDanger: true,
    };
  }
  if (variant === 'blocked') {
    return {
      show: true,
      icon: lockIcon,
      text: props.printer.status_message || 'AMS 匹配耗材失败',
      isDanger: false,
    };
  }
  if (variant === 'clearing') {
    return {
      show: true,
      icon: lockIcon,
      text: props.printer.status_message || '热床未清空',
      isDanger: false,
    };
  }
  return { show: false, icon: '', text: '', isDanger: false };
});

function normalizeTrayColor(rawColor: string): string {
  const hex = rawColor.startsWith('#') ? rawColor : '#' + rawColor;
  if (hex.toLowerCase() === '#000000' || hex.toLowerCase() === '#111111') {
    return '#555555';
  }
  return hex;
}

const defaultAmsSlots = [
  { label: 'A1', material: 'PLA', color: '#00C0E8', remainPercent: 80 },
  { label: 'A2', material: 'PETG', color: '#6155F5', remainPercent: 65 },
  { label: 'A3', material: 'PLA', color: '#00AE42', remainPercent: 40 },
  { label: 'A4', material: 'PLA', color: '#E03C31', remainPercent: 90 },
];

// Dynamic AMS slots driven by filament remaining percentage & color
const displayAms = computed(() => {
  if (props.printer.ams_trays && props.printer.ams_trays.length > 0) {
    return props.printer.ams_trays.slice(0, 4).map((tray, idx) => ({
      label: `A${tray.id + 1}`,
      material: tray.tray_type || 'PLA',
      color: normalizeTrayColor(tray.tray_color || defaultAmsSlots[idx % defaultAmsSlots.length].color),
      remainPercent: Math.max(0, Math.min(100, tray.remain_percent ?? 100)),
      isActive: tray.is_active ?? false,
    }));
  }
  return defaultAmsSlots.map((slot, idx) => ({
    ...slot,
    isActive: cardVariant.value === 'printing' && idx === 0,
  }));
});

function formatDuration(sec: number): string {
  if (sec <= 0) return '0m';
  const totalMin = Math.floor(sec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  return `${m}m`;
}

const submitterName = computed(() => {
  if (props.printer.current_job?.submitter_name) {
    return props.printer.current_job.submitter_name;
  }
  if (props.printer.state === 'UNMANAGED_PRINTING') {
    return '未登记任务';
  }
  if (props.printer.state === 'IDLE' || props.printer.state === 'OFFLINE') {
    return '无任务';
  }
  return '参赛选手';
});

const submitterAvatar = computed(() => {
  return props.printer.current_job?.submitter_avatar_url || avatarIcon;
});

const taskFilename = computed(() => {
  return (
    props.printer.current_job?.plate_name ||
    props.printer.task_name ||
    (props.printer.state === 'IDLE' ? '等待派单中' : '未命名任务.3mf')
  );
});

// Format remaining & elapsed time description
const timeDescription = computed(() => {
  const job = props.printer.current_job;
  const now = props.currentTime ?? Math.floor(Date.now() / 1000);

  if (cardVariant.value === 'clearing') {
    // 待清台状态：公开透明公示“打印总耗时”与“已等待清台时长”
    let printDurationSec = 5760; // 默认 1h 36m 回退
    let waitClearingSec = 2100; // 默认 35m 回退
    if (job?.started_at && job?.finished_at) {
      printDurationSec = Math.max(0, job.finished_at - job.started_at);
      waitClearingSec = Math.max(0, now - job.finished_at);
    } else if (job?.finished_at) {
      waitClearingSec = Math.max(0, now - job.finished_at);
    }
    return `总耗时 ${formatDuration(printDurationSec)} / 等待清台 ${formatDuration(waitClearingSec)}`;
  }

  if (cardVariant.value === 'printing' || cardVariant.value === 'error') {
    let elapsedSec = 5760; // 1h 36m 默认回退
    if (job?.started_at) {
      elapsedSec = Math.max(0, now - job.started_at);
    }
    const remainingSec = props.printer.remaining_time_min * 60;
    return `已用 ${formatDuration(elapsedSec)} / 剩余 ${formatDuration(remainingSec)}`;
  }

  if (cardVariant.value === 'blocked') {
    const remainingSec = props.printer.remaining_time_min * 60;
    return `暂未打印 / 剩余 ${formatDuration(remainingSec || 9900)}`;
  }

  if (cardVariant.value === 'preparing') {
    const remainingSec = props.printer.remaining_time_min * 60;
    return `升温准备中 / 剩余 ${formatDuration(remainingSec || 300)}`;
  }

  return '暂未打印 / 剩余 0m';
});

// Format last updated date
const lastUpdatedTime = computed(() => {
  if (props.printer.updated_at) {
    const d = new Date(props.printer.updated_at * 1000);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  return '2026-09-26 22:48:59';
});
</script>

<template>
  <article
    class="printer-card"
    :class="[
      cardVariant,
      { 'has-safety': safetyBanner.show, 'is-dual': isDualNozzle }
    ]"
    :aria-label="`${printer.name} · ${statusInfo.label}`"
    @click="emit('select', printer.id)"
  >
    <header class="heading">
      <div class="name">
        <img :src="printerIcon" alt="" />
        <h3>{{ printer.name }}</h3>
      </div>
      <span class="status" :class="statusInfo.class">{{ statusInfo.label }}</span>
    </header>

    <div class="body">
      <div class="overview">
        <img class="camera" :src="cameraFallback" alt="" />

        <div class="readings" :class="{ 'readings-dual': isDualNozzle }">
          <!-- Nozzle 1: Heating (target > 0) -> Orange #FF8D28, Cooling (target == 0) -> Cyan #00C3D0 -->
          <div
            class="reading"
            :class="printer.temperatures.nozzle_target > 0 ? 'is-heating' : 'is-cooling'"
          >
            <span class="reading-icon nozzle" />
            <span>{{ Math.round(printer.temperatures.nozzle) }} / {{ Math.round(printer.temperatures.nozzle_target) }}°C</span>
          </div>

          <!-- Nozzle 2 (Dual Head e.g. X2D) -->
          <div
            v-if="isDualNozzle"
            class="reading"
            :class="(printer.temperatures.nozzle_2_target ?? 0) > 0 ? 'is-heating' : 'is-cooling'"
          >
            <span class="reading-icon nozzle" />
            <span>{{ Math.round(printer.temperatures.nozzle_2 ?? 215) }} / {{ Math.round(printer.temperatures.nozzle_2_target ?? 220) }}°C</span>
          </div>

          <!-- Bed -->
          <div
            class="reading"
            :class="printer.temperatures.bed_target > 0 ? 'is-heating' : 'is-cooling'"
          >
            <span class="reading-icon bed" />
            <span>{{ Math.round(printer.temperatures.bed) }} / {{ Math.round(printer.temperatures.bed_target) }}°C</span>
          </div>

          <!-- Chamber (if available) -->
          <div
            v-if="printer.temperatures.chamber !== undefined"
            class="reading is-neutral"
          >
            <span class="reading-icon chamber" />
            <span>{{ Math.round(printer.temperatures.chamber) }} / 40°C</span>
          </div>

          <!-- Layers -->
          <div class="reading is-neutral">
            <span class="reading-icon layers" />
            <span>{{ printer.current_layer }} / {{ printer.total_layers }}</span>
          </div>
        </div>

        <!-- AMS Slots -->
        <div class="ams">
          <div
            v-for="slot in displayAms"
            :key="slot.label"
            class="ams-row"
            :class="{ 'is-empty': slot.remainPercent === 0 }"
          >
            <span class="ring" :title="slot.remainPercent > 0 ? `余量 ${slot.remainPercent}%` : '无耗材 / 已用尽'">
              <svg class="ring-svg" width="14" height="14" viewBox="0 0 14 14">
                <!-- Dashed grey track: explicitly distinguishes empty/exhausted slots from grey filament -->
                <circle
                  cx="7"
                  cy="7"
                  r="5.2"
                  fill="none"
                  :stroke="slot.remainPercent === 0 ? '#938f99' : 'rgba(255, 255, 255, 0.2)'"
                  :stroke-width="slot.remainPercent === 0 ? 1.5 : 1.4"
                  stroke-dasharray="2.2 1.88"
                />
                <!-- Solid colored arc for active remaining filament -->
                <circle
                  v-if="slot.remainPercent > 0"
                  cx="7"
                  cy="7"
                  r="5.2"
                  fill="none"
                  :stroke="slot.color"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  :stroke-dasharray="`${(32.67 * slot.remainPercent) / 100} 32.67`"
                  transform="rotate(-90 7 7)"
                />
              </svg>
            </span>
            <span class="slot-label">{{ slot.label }}</span>
            <span class="material">{{ slot.material }}</span>
            <img v-if="slot.isActive" class="active" :src="activeDot" alt="" />
          </div>
        </div>
      </div>

      <!-- Task info & Progress -->
      <div class="task">
        <div class="author">
          <img :src="submitterAvatar" alt="" class="avatar-img" />
          <span :title="submitterName">{{ submitterName }}</span>
        </div>
        <div class="filename">
          <span :title="taskFilename">{{ taskFilename }}</span>
          <span class="percent">{{ Math.round(progress) }}%</span>
        </div>
        <div
          class="progress-bar-wrap"
          :class="{ 'is-empty': progress === 0 }"
          role="progressbar"
          :aria-label="`${printer.name} 打印进度`"
          :aria-valuenow="progress"
          aria-valuemin="0"
          aria-valuemax="100"
          :style="{ '--progress': `${progress}%` }"
        >
          <div v-if="progress < 100" class="progress-track-bg" />
          <div class="progress-fill-wrap">
            <WavyProgress v-if="cardVariant === 'printing' && progress > 0 && progress < 100" />
            <div
              v-else
              class="solid-fill"
              :class="{
                'is-error': cardVariant === 'error',
                'is-default': progress === 0 || (cardVariant !== 'printing' && cardVariant !== 'clearing' && cardVariant !== 'error')
              }"
            />
          </div>
          <div v-if="progress < 100" class="progress-stop" />
        </div>
        <p class="time">{{ timeDescription }}</p>
      </div>
    </div>

    <!-- Offline Overlay -->
    <div v-if="cardVariant === 'offline'" class="offline-mask">
      <p class="offline-state"><span class="offline-dot" aria-hidden="true" />设备已离线</p>
      <p class="last-online">最后在线 <time>{{ lastUpdatedTime }}</time></p>
    </div>

    <!-- Safety Banner -->
    <div v-if="safetyBanner.show" class="safety" :class="{ danger: safetyBanner.isDanger }">
      <img :src="safetyBanner.icon" alt="" />
      <span>{{ safetyBanner.text }}</span>
    </div>
  </article>
</template>

<style scoped>
.printer-card {
  position: relative;
  width: 100%;
  max-width: 464px;
  height: 307px;
  overflow: hidden;
  border-radius: 12px;
  background: #211f26;
  color: #e6e0e9;
  font-family: Roboto, sans-serif;
  font-variation-settings: 'wdth' 100;
  container-type: inline-size;
  container-name: card;
}

/* Hide AMS at narrow card widths (< 420px) so 16:9 camera & readings have breathing room */
@container card (max-width: 420px) {
  .ams {
    display: none !important;
  }
}
.printer-card.error {
  height: 345px;
}
.printer-card.blocked,
.printer-card.clearing {
  height: 359px;
}

.heading {
  position: absolute;
  top: 20px;
  left: 20px;
  right: 20px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  overflow: hidden;
}
.name {
  display: flex;
  align-items: center;
  gap: 8px;
}
.name img {
  width: 20px;
  height: 20px;
}
h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  letter-spacing: 0.15px;
}

/* Status Badges */
.status {
  display: flex;
  flex: none;
  justify-content: center;
  align-items: center;
  padding: 6px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  letter-spacing: 0.1px;
}
.status-printing {
  width: 75px;
  background: #213a2d;
  color: #92d5ab;
}
.status-error {
  background: rgba(255, 56, 60, 0.14);
  color: #ff383c;
}
.status-blocked,
.status-clearing,
.status-preparing,
.status-warning {
  background: #3e2d20;
  color: #f6ba78;
}
.status-offline,
.status-idle {
  background: #2b2930;
  color: #cac4d0;
}

.body {
  position: absolute;
  left: 20px;
  right: 20px;
  top: 66px;
  height: 220px;
  box-sizing: border-box;
}
.overview {
  display: flex;
  align-items: center;
  width: 100%;
  height: 123px;
  gap: 8px;
}
.camera {
  display: block;
  flex: 1 1 0;
  min-width: 0;
  max-width: 220px;
  aspect-ratio: 16 / 9;
  height: auto;
  max-height: 123px;
  object-fit: cover;
  border-radius: 8px;
}

/* Temperature and layer readings */
.readings {
  width: 98px;
  height: 123px;
  flex: none;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  overflow: hidden;
}
.readings.readings-dual {
  gap: 4px;
}

.reading {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  width: 98px;
  height: 20px;
  white-space: pre;
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  letter-spacing: 0.25px;
}
.readings.readings-dual .reading {
  font-size: 13px;
  gap: 5px;
}

/* Dynamic MD3 SVG coloring via mask */
.reading-icon {
  display: inline-block;
  width: 14px;
  height: 14px;
  flex: none;
  background-color: var(--icon-color, #cac4d0);
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
}
.reading-icon.nozzle {
  -webkit-mask-image: url('../assets/dashboard/fc21c.svg');
  mask-image: url('../assets/dashboard/fc21c.svg');
}
.reading-icon.bed {
  -webkit-mask-image: url('../assets/dashboard/07c3c.svg');
  mask-image: url('../assets/dashboard/07c3c.svg');
}
.reading-icon.chamber {
  -webkit-mask-image: url('../assets/dashboard/e4756.svg');
  mask-image: url('../assets/dashboard/e4756.svg');
}
.reading-icon.layers {
  -webkit-mask-image: url('../assets/dashboard/e37ac.svg');
  mask-image: url('../assets/dashboard/e37ac.svg');
}

/* MD3 Dynamic Temperature Palette */
.reading.is-heating {
  --icon-color: #ff8d28; /* Warm orange */
}
.reading.is-cooling {
  --icon-color: #00c3d0; /* Cool cyan-blue */
}
.reading.is-neutral {
  --icon-color: #808080; /* Neutral grey */
}

/* AMS rows */
.ams {
  display: flex;
  flex: none;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  width: 90px;
  height: 123px;
  padding: 0 4px;
  overflow: hidden;
}
.ams-row {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 20px;
  width: 82px;
  padding: 0 2px;
  overflow: hidden;
  color: white;
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  letter-spacing: 0.5px;
}
.ams-row.is-empty .material {
  color: #938f99;
}
.ring {
  position: relative;
  flex: none;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ring-svg {
  display: block;
  width: 14px;
  height: 14px;
}
.slot-label {
  width: 15px;
  flex: none;
}
.material {
  width: 32px;
  flex: none;
}
.active {
  width: 4px;
  height: 4px;
  flex: none;
}

/* Task & Progress */
.task {
  position: absolute;
  top: 137px;
  left: 0;
  right: 0;
  width: 100%;
  box-sizing: border-box;
}
.author {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  max-width: 180px;
  overflow: hidden;
  color: white;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  letter-spacing: 0.1px;
  white-space: nowrap;
}
.author span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.avatar-img {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  object-fit: cover;
  flex: none;
}
.filename {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  height: 20px;
  margin-top: 4px;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  letter-spacing: 0.1px;
  white-space: nowrap;
}
.filename span:first-child {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.percent {
  flex: none;
  color: #d0bcff;
}
/* Responsive Progress Bar */
.progress-bar-wrap {
  position: relative;
  width: 100%;
  height: 12px;
  margin-top: 4px;
}
.progress-track-bg {
  position: absolute;
  top: 4px;
  left: calc(var(--progress) + 6px);
  right: 8px;
  height: 4px;
  border-radius: 2px;
  background: #4a4458;
  transition: left 0.3s ease;
}
.progress-bar-wrap.is-empty .progress-track-bg {
  left: 0;
}
.progress-fill-wrap {
  position: absolute;
  top: 0;
  left: 0;
  width: var(--progress);
  height: 12px;
  overflow: hidden;
  transition: width 0.3s ease;
}
.solid-fill {
  width: 100%;
  height: 4px;
  margin-top: 4px;
  border-radius: 2px;
  background: #d0bcff;
}
.solid-fill.is-error {
  background: #f2b8b5;
}
.solid-fill.is-default {
  background: #4a4458;
}
.progress-stop {
  position: absolute;
  top: 4px;
  right: 0;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #4a4458;
}
@media (prefers-reduced-motion: reduce) {
  .progress-fill-wrap,
  .progress-track-bg {
    transition: none;
  }
}
.time {
  margin: 0;
  color: #cac4d0;
  font-size: 12px;
  font-weight: 400;
  line-height: 16px;
  letter-spacing: 0.4px;
  white-space: nowrap;
}
.printing .time {
  margin-top: 4px;
}

/* Safety Warning Banner */
.safety {
  position: absolute;
  top: 297px;
  left: 20px;
  right: 20px;
  height: 42px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding-left: 12px;
  border-radius: 8px;
  background: #3e2d20;
  color: #f6ba78;
  font-family: 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  line-height: 16px;
  letter-spacing: 0.4px;
  white-space: nowrap;
  box-sizing: border-box;
}
.safety img {
  width: 18px;
  height: 18px;
  flex: none;
}
.safety.danger {
  top: 303px;
  left: 0;
  right: 0;
  width: 100%;
  border-radius: 0 0 12px 12px;
  padding: 0 20px;
  box-sizing: border-box;
  background: #8c1d18;
  color: #f2b8b5;
  font-weight: 700;
}

/* Offline blur & overlay */
.offline .body {
  filter: blur(3px);
  opacity: 0.48;
}
.offline-mask {
  position: absolute;
  inset: 62px 0 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 0 0 12px 12px;
  background: rgba(29, 27, 32, 0.72);
}
.offline-state {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #f2b8b5;
  font-size: 18px;
  font-weight: 700;
  font-synthesis: weight;
  line-height: 26px;
}
.offline-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}
.last-online {
  color: #938f99;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  white-space: nowrap;
}
.offline::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 0 0 1px rgba(242, 184, 181, 0.4);
  pointer-events: none;
}
</style>
