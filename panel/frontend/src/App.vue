<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { Printer } from './types';
import PrinterCard from './components/PrinterCard.vue';
import brandIcon from './assets/dashboard/1ef04.svg';
import navigationIcon from './assets/dashboard/76b4e.svg';
import notificationIcon from './assets/dashboard/dc112.svg';
import searchIcon from './assets/dashboard/386ce.svg';
import queueIcon from './assets/dashboard/be719.svg';
import printerIcon from './assets/dashboard/44e7c.svg';
import clearingIcon from './assets/dashboard/45be8.svg';
import selectedIcon from './assets/dashboard/103f4.svg';
import tomAvatar from './assets/dashboard/tom_avatar.png';
const page = ref<'overview' | 'print'>('overview');
const query = ref('');
const filter = ref<'focus' | 'all' | 'attention'>('focus');
const isGuest = ref(false); // Toggle between User (117:624) and Guest (120:643) views
const columnCount = ref(3);

function updateColumns() {
  const w = window.innerWidth;
  if (w < 860) {
    columnCount.value = 1;
  } else if (w < 1340) {
    columnCount.value = 2;
  } else if (w < 1820) {
    columnCount.value = 3;
  } else if (w < 2300) {
    columnCount.value = 4;
  } else {
    columnCount.value = 5;
  }
}

const masonryColumns = computed(() => {
  const n = Math.max(1, columnCount.value);
  const cols: Printer[][] = Array.from({ length: n }, () => []);

  // Round-Robin Modulo distribution (index % n):
  // Strictly preserves left-to-right reading order across rows:
  // - In "全部" (all): ordered strictly by machine number/name natural sort
  // - In other views ("重点设备", "需处理"): ordered strictly by attention priority (fault > clearing > blocked > printing)
  // And within each column, cards stack tightly vertically with 16px gap (lifted up / zero row-level empty gaps)
  displayedPrinters.value.forEach((printer, idx) => {
    cols[idx % n].push(printer);
  });
  return cols;
});

function toggleUserAuth() {
  isGuest.value = !isGuest.value;
}
// Global single reactive clock source (ticks every 1s)
const currentTime = ref(Math.floor(Date.now() / 1000));
const baseNow = currentTime.value;

// 20 Registered Printers with UUIDs and authentic current_job metadata:
// 11 printing, 1 preparing, 4 ready (3 clearing, 1 AMS blocked), 1 idle, 1 error, 2 offline
const printers = ref<Printer[]>([
  {
    id: 'e8d2a1b0-1001-4000-8000-000000000001',
    name: 'X1C-01',
    model: 'Bambu X1-Carbon',
    serial_number: '01P11A350100001',
    state: 'PRINTING',
    temperatures: { nozzle: 215, nozzle_target: 220, bed: 62, bed_target: 60, chamber: 38 },
    progress: 80,
    remaining_time_min: 24,
    current_layer: 120,
    total_layers: 215,
    ams_trays: [
      { id: 0, tray_color: 'FFFFFF', tray_type: 'PLA', remain_percent: 80, is_active: true },
      { id: 1, tray_color: '000000', tray_type: 'PETG', remain_percent: 65, is_active: false },
      { id: 2, tray_color: '00AE42', tray_type: 'PLA', remain_percent: 40, is_active: false },
      { id: 3, tray_color: 'E03C31', tray_type: 'PLA', remain_percent: 90, is_active: false },
    ],
    task_name: '机械臂轴承.3mf.gcode',
    current_job: {
      id: 'b1a2c3d4-0001-4000-8000-000000000001',
      job_sn: 'JOB-20261018-001',
      plate_name: '机械臂轴承.3mf.gcode',
      submitter_name: 'Tom_Chicken',
      started_at: baseNow - 5760, // 1h 36m ago
    },
    updated_at: baseNow,
  },
  {
    id: 'e8d2a1b0-1001-4000-8000-000000000002',
    name: 'X1C-02',
    model: 'Bambu X1-Carbon',
    serial_number: '01P11A350100002',
    state: 'PRINTING',
    temperatures: { nozzle: 218, nozzle_target: 220, bed: 60, bed_target: 60, chamber: 37 },
    progress: 45,
    remaining_time_min: 65,
    current_layer: 90,
    total_layers: 200,
    ams_trays: [
      { id: 0, tray_color: 'FFFFFF', tray_type: 'PLA', remain_percent: 70, is_active: true },
      { id: 1, tray_color: '000000', tray_type: 'PETG', remain_percent: 50, is_active: false },
    ],
    task_name: '外壳前盖_v2.3mf.gcode',
    current_job: {
      id: 'b1a2c3d4-0001-4000-8000-000000000002',
      job_sn: 'JOB-20261018-002',
      plate_name: '外壳前盖_v2.3mf.gcode',
      submitter_name: 'Alice_W',
      started_at: baseNow - 3240, // 54m ago
    },
    updated_at: baseNow,
  },
  {
    id: 'e8d2a1b0-1001-4000-8000-000000000003',
    name: 'X1C-03',
    model: 'Bambu X1-Carbon',
    serial_number: '01P11A350100003',
    state: 'PRINTING',
    temperatures: { nozzle: 220, nozzle_target: 220, bed: 61, bed_target: 60, chamber: 36 },
    progress: 12,
    remaining_time_min: 110,
    current_layer: 25,
    total_layers: 210,
    ams_trays: [
      { id: 0, tray_color: 'FFFFFF', tray_type: 'PLA', remain_percent: 95, is_active: true },
    ],
    task_name: '传动齿轮组.3mf.gcode',
    current_job: {
      id: 'b1a2c3d4-0001-4000-8000-000000000003',
      job_sn: 'JOB-20261018-003',
      plate_name: '传动齿轮组.3mf.gcode',
      submitter_name: 'Bob_Maker',
      started_at: baseNow - 900, // 15m ago
    },
    updated_at: baseNow,
  },
  {
    id: 'e8d2a1b0-1001-4000-8000-000000000004',
    name: 'X1C-04',
    model: 'Bambu X1-Carbon',
    serial_number: '01P11A350100004',
    state: 'PRINTING',
    temperatures: { nozzle: 216, nozzle_target: 220, bed: 60, bed_target: 60, chamber: 39 },
    progress: 92,
    remaining_time_min: 8,
    current_layer: 195,
    total_layers: 215,
    ams_trays: [
      { id: 0, tray_color: 'FFFFFF', tray_type: 'PLA', remain_percent: 30, is_active: true },
    ],
    task_name: '底板支架.3mf.gcode',
    current_job: {
      id: 'b1a2c3d4-0001-4000-8000-000000000004',
      job_sn: 'JOB-20261018-004',
      plate_name: '底板支架.3mf.gcode',
      submitter_name: 'Charlie_D',
      started_at: baseNow - 5520, // 1h 32m ago
    },
    updated_at: baseNow,
  },
  {
    id: 'e8d2a1b0-1001-4000-8000-000000000005',
    name: 'X1C-05',
    model: 'Bambu X1-Carbon',
    serial_number: '01P11A350100005',
    state: 'PRINTING',
    temperatures: { nozzle: 215, nozzle_target: 220, bed: 62, bed_target: 60, chamber: 38 },
    progress: 63,
    remaining_time_min: 42,
    current_layer: 135,
    total_layers: 215,
    ams_trays: [
      { id: 0, tray_color: 'FFFFFF', tray_type: 'PLA', remain_percent: 55, is_active: true },
    ],
    task_name: '固定夹具.3mf.gcode',
    current_job: {
      id: 'b1a2c3d4-0001-4000-8000-000000000005',
      job_sn: 'JOB-20261018-005',
      plate_name: '固定夹具.3mf.gcode',
      submitter_name: 'Diana_P',
      started_at: baseNow - 4320, // 1h 12m ago
    },
    updated_at: baseNow,
  },
  {
    id: 'e8d2a1b0-1001-4000-8000-000000000006',
    name: 'X1C-06',
    model: 'Bambu X1-Carbon',
    serial_number: '01P11A350100006',
    state: 'PRINTING',
    temperatures: { nozzle: 219, nozzle_target: 220, bed: 60, bed_target: 60, chamber: 35 },
    progress: 30,
    remaining_time_min: 85,
    current_layer: 60,
    total_layers: 200,
    ams_trays: [
      { id: 0, tray_color: 'FFFFFF', tray_type: 'PLA', remain_percent: 88, is_active: true },
    ],
    task_name: '电机支座.3mf.gcode',
    current_job: {
      id: 'b1a2c3d4-0001-4000-8000-000000000006',
      job_sn: 'JOB-20261018-006',
      plate_name: '电机支座.3mf.gcode',
      submitter_name: 'Eric_H',
      started_at: baseNow - 2160, // 36m ago
    },
    updated_at: baseNow,
  },
  {
    id: 'e8d2a1b0-1001-4000-8000-000000000007',
    name: 'P1SC-01',
    model: 'Bambu P1S',
    serial_number: '01P12B350100007',
    state: 'PRINTING',
    temperatures: { nozzle: 210, nozzle_target: 215, bed: 55, bed_target: 55 },
    progress: 75,
    remaining_time_min: 30,
    current_layer: 150,
    total_layers: 200,
    ams_trays: [
      { id: 0, tray_color: 'FFFFFF', tray_type: 'PLA', remain_percent: 60, is_active: true },
    ],
    task_name: '散热导风罩.3mf.gcode',
    current_job: {
      id: 'b1a2c3d4-0001-4000-8000-000000000007',
      job_sn: 'JOB-20261018-007',
      plate_name: '散热导风罩.3mf.gcode',
      submitter_name: 'Frank_L',
      started_at: baseNow - 5400, // 1h 30m ago
    },
    updated_at: baseNow,
  },
  {
    id: 'e8d2a1b0-1001-4000-8000-000000000008',
    name: 'P1SC-02',
    model: 'Bambu P1S',
    serial_number: '01P12B350100008',
    state: 'PRINTING',
    temperatures: { nozzle: 214, nozzle_target: 215, bed: 55, bed_target: 55 },
    progress: 50,
    remaining_time_min: 60,
    current_layer: 100,
    total_layers: 200,
    ams_trays: [
      { id: 0, tray_color: 'FFFFFF', tray_type: 'PLA', remain_percent: 72, is_active: true },
    ],
    task_name: '连杆摇臂.3mf.gcode',
    current_job: {
      id: 'b1a2c3d4-0001-4000-8000-000000000008',
      job_sn: 'JOB-20261018-008',
      plate_name: '连杆摇臂.3mf.gcode',
      submitter_name: 'Grace_T',
      started_at: baseNow - 3600, // 1h 00m ago
    },
    updated_at: baseNow,
  },
  {
    id: 'e8d2a1b0-1001-4000-8000-000000000009',
    name: 'P1SC-03',
    model: 'Bambu P1S',
    serial_number: '01P12B350100009',
    state: 'PRINTING',
    temperatures: { nozzle: 215, nozzle_target: 215, bed: 55, bed_target: 55 },
    progress: 25,
    remaining_time_min: 90,
    current_layer: 50,
    total_layers: 200,
    ams_trays: [
      { id: 0, tray_color: 'FFFFFF', tray_type: 'PLA', remain_percent: 85, is_active: true },
    ],
    task_name: '卡扣面板.3mf.gcode',
    current_job: {
      id: 'b1a2c3d4-0001-4000-8000-000000000009',
      job_sn: 'JOB-20261018-009',
      plate_name: '卡扣面板.3mf.gcode',
      submitter_name: 'Henry_K',
      started_at: baseNow - 1800, // 30m ago
    },
    updated_at: baseNow,
  },
  {
    id: 'e8d2a1b0-1001-4000-8000-000000000010',
    name: 'P1SC-04',
    model: 'Bambu P1S',
    serial_number: '01P12B350100010',
    state: 'PRINTING',
    temperatures: { nozzle: 212, nozzle_target: 215, bed: 55, bed_target: 55 },
    progress: 88,
    remaining_time_min: 14,
    current_layer: 176,
    total_layers: 200,
    ams_trays: [
      { id: 0, tray_color: 'FFFFFF', tray_type: 'PLA', remain_percent: 42, is_active: true },
    ],
    task_name: '编码器外壳.3mf.gcode',
    current_job: {
      id: 'b1a2c3d4-0001-4000-8000-000000000010',
      job_sn: 'JOB-20261018-010',
      plate_name: '编码器外壳.3mf.gcode',
      submitter_name: 'Iris_M',
      started_at: baseNow - 6120, // 1h 42m ago
    },
    updated_at: baseNow,
  },
  {
    id: 'e8d2a1b0-1001-4000-8000-000000000011',
    name: 'P1SC-05',
    model: 'Bambu P1S',
    serial_number: '01P12B350100011',
    state: 'PAUSED',
    temperatures: { nozzle: 215, nozzle_target: 220, bed: 62, bed_target: 60 },
    progress: 80,
    remaining_time_min: 24,
    current_layer: 120,
    total_layers: 215,
    ams_trays: [
      { id: 0, tray_color: 'FFFFFF', tray_type: 'PLA', remain_percent: 0, is_active: false },
      { id: 1, tray_color: '000000', tray_type: 'PETG', remain_percent: 75, is_active: false },
    ],
    status_message: 'A2 断料 · 请暂停后补料并复核',
    task_name: '机械臂轴承.3mf.gcode',
    current_job: {
      id: 'b1a2c3d4-0001-4000-8000-000000000011',
      job_sn: 'JOB-20261018-011',
      plate_name: '机械臂轴承.3mf.gcode',
      submitter_name: 'Alex_Maker',
      started_at: baseNow - 5760, // 1h 36m ago
    },
    updated_at: baseNow,
  },
  {
    id: 'e8d2a1b0-1001-4000-8000-000000000012',
    name: 'P1SC-06',
    model: 'Bambu P1S',
    serial_number: '01P12B350100012',
    state: 'PRINTING',
    temperatures: { nozzle: 213, nozzle_target: 215, bed: 55, bed_target: 55 },
    progress: 60,
    remaining_time_min: 48,
    current_layer: 120,
    total_layers: 200,
    ams_trays: [
      { id: 0, tray_color: 'FFFFFF', tray_type: 'PLA', remain_percent: 66, is_active: true },
    ],
    task_name: '电池仓盖.3mf.gcode',
    current_job: {
      id: 'b1a2c3d4-0001-4000-8000-000000000012',
      job_sn: 'JOB-20261018-012',
      plate_name: '电池仓盖.3mf.gcode',
      submitter_name: 'Jack_R',
      started_at: baseNow - 4320, // 1h 12m ago
    },
    updated_at: baseNow,
  },
  {
    id: 'e8d2a1b0-1001-4000-8000-000000000013',
    name: 'X2D-01',
    model: 'Bambu X2D',
    serial_number: '02X2D999900001',
    state: 'PAUSED',
    temperatures: {
      nozzle: 215,
      nozzle_target: 220,
      nozzle_2: 215,
      nozzle_2_target: 220,
      bed: 62,
      bed_target: 60,
      chamber: 38,
    },
    progress: 0,
    remaining_time_min: 165,
    current_layer: 0,
    total_layers: 215,
    ams_trays: [
      { id: 0, tray_color: 'FFFFFF', tray_type: 'PLA', remain_percent: 90, is_active: false },
      { id: 1, tray_color: '000000', tray_type: 'PETG', remain_percent: 85, is_active: false },
      { id: 2, tray_color: '00AE42', tray_type: 'PLA', remain_percent: 50, is_active: false },
      { id: 3, tray_color: 'E03C31', tray_type: 'PLA', remain_percent: 80, is_active: false },
    ],
    status_message: 'AMS 匹配耗材失败',
    task_name: '机械臂轴承.3mf.gcode',
    current_job: {
      id: 'b1a2c3d4-0001-4000-8000-000000000013',
      job_sn: 'JOB-20261018-013',
      plate_name: '机械臂轴承.3mf.gcode',
      submitter_name: 'Sarah_Robot',
      started_at: baseNow - 600, // 10m ago
    },
    updated_at: baseNow,
  },
  {
    id: 'e8d2a1b0-1001-4000-8000-000000000014',
    name: 'P2S-01',
    model: 'Bambu P1S',
    serial_number: '01P12B350100014',
    state: 'PREPARING',
    temperatures: { nozzle: 180, nozzle_target: 220, bed: 50, bed_target: 60 },
    progress: 0,
    remaining_time_min: 120,
    current_layer: 0,
    total_layers: 215,
    ams_trays: [
      { id: 0, tray_color: 'FFFFFF', tray_type: 'PLA', remain_percent: 90, is_active: false },
    ],
    status_message: '升温准备中',
    task_name: '控制主板壳.3mf.gcode',
    current_job: {
      id: 'b1a2c3d4-0001-4000-8000-000000000014',
      job_sn: 'JOB-20261018-014',
      plate_name: '控制主板壳.3mf.gcode',
      submitter_name: 'Mike_Chen',
      started_at: baseNow - 120, // 2m ago
    },
    updated_at: baseNow,
  },
  {
    id: 'e8d2a1b0-1001-4000-8000-000000000015',
    name: 'P2S-02',
    model: 'Bambu P1S',
    serial_number: '01P12B350100015',
    state: 'CLEARING_REQUIRED',
    temperatures: { nozzle: 32, nozzle_target: 0, bed: 28, bed_target: 0 },
    progress: 100,
    remaining_time_min: 0,
    current_layer: 215,
    total_layers: 215,
    ams_trays: [
      { id: 0, tray_color: 'FFFFFF', tray_type: 'PLA', remain_percent: 50, is_active: false },
    ],
    status_message: '热床未清空',
    task_name: '履带驱动轴.3mf.gcode',
    current_job: {
      id: 'b1a2c3d4-0001-4000-8000-000000000015',
      job_sn: 'JOB-20261018-015',
      plate_name: '履带驱动轴.3mf.gcode',
      submitter_name: 'Elena_K',
      started_at: baseNow - 7200, // 2h ago
      finished_at: baseNow - 900, // finished 15m ago (print took 1h 45m, wait clearing is 15m)
    },
    updated_at: baseNow,
  },
  {
    id: 'e8d2a1b0-1001-4000-8000-000000000016',
    name: 'P2S-03',
    model: 'Bambu P1S',
    serial_number: '01P12B350100016',
    state: 'OFFLINE',
    temperatures: { nozzle: 25, nozzle_target: 0, bed: 25, bed_target: 0 },
    progress: 0,
    remaining_time_min: 0,
    current_layer: 0,
    total_layers: 215,
    ams_trays: [],
    status_message: '连接超时',
    task_name: '机械臂轴承.3mf.gcode',
    updated_at: baseNow,
  },
  {
    id: 'e8d2a1b0-1001-4000-8000-000000000017',
    name: 'P2S-04',
    model: 'Bambu P1S',
    serial_number: '01P12B350100017',
    state: 'CLEARING_REQUIRED',
    temperatures: { nozzle: 35, nozzle_target: 0, bed: 30, bed_target: 0 },
    progress: 100,
    remaining_time_min: 0,
    current_layer: 215,
    total_layers: 215,
    ams_trays: [
      { id: 0, tray_color: 'FFFFFF', tray_type: 'PLA', remain_percent: 40, is_active: false },
    ],
    status_message: '热床未清空',
    task_name: '机械臂轴承.3mf.gcode',
    current_job: {
      id: 'b1a2c3d4-0001-4000-8000-000000000017',
      job_sn: 'JOB-20261018-017',
      plate_name: '机械臂轴承.3mf.gcode',
      submitter_name: 'David_Wang',
      started_at: baseNow - 8100, // started 2h 15m ago
      finished_at: baseNow - 2100, // finished 35m ago (print took 1h 40m, wait clearing is 35m)
    },
    updated_at: baseNow,
  },
  {
    id: 'e8d2a1b0-1001-4000-8000-000000000018',
    name: 'P2S-05',
    model: 'Bambu P1S',
    serial_number: '01P12B350100018',
    state: 'CLEARING_REQUIRED',
    temperatures: { nozzle: 30, nozzle_target: 0, bed: 27, bed_target: 0 },
    progress: 100,
    remaining_time_min: 0,
    current_layer: 180,
    total_layers: 180,
    ams_trays: [
      { id: 0, tray_color: 'FFFFFF', tray_type: 'PLA', remain_percent: 60, is_active: false },
    ],
    status_message: '热床未清空',
    task_name: '履带驱动轮.3mf.gcode',
    current_job: {
      id: 'b1a2c3d4-0001-4000-8000-000000000018',
      job_sn: 'JOB-20261018-018',
      plate_name: '履带驱动轮.3mf.gcode',
      submitter_name: 'Kevin_Z',
      started_at: baseNow - 10800, // started 3h ago
      finished_at: baseNow - 3000, // finished 50m ago (print took 2h 10m, wait clearing is 50m)
    },
    updated_at: baseNow,
  },
  {
    id: 'e8d2a1b0-1001-4000-8000-000000000019',
    name: 'A1M-01',
    model: 'Bambu A1-Mini',
    serial_number: '01A11A350100019',
    state: 'IDLE',
    temperatures: { nozzle: 26, nozzle_target: 0, bed: 25, bed_target: 0 },
    progress: 0,
    remaining_time_min: 0,
    current_layer: 0,
    total_layers: 0,
    ams_trays: [],
    status_message: '空闲待命',
    updated_at: baseNow,
  },
  {
    id: 'e8d2a1b0-1001-4000-8000-000000000020',
    name: 'A1M-02',
    model: 'Bambu A1-Mini',
    serial_number: '01A11A350100020',
    state: 'OFFLINE',
    temperatures: { nozzle: 24, nozzle_target: 0, bed: 24, bed_target: 0 },
    progress: 0,
    remaining_time_min: 0,
    current_layer: 0,
    total_layers: 0,
    ams_trays: [],
    status_message: '网络中断',
    updated_at: baseNow,
  },
]);

// Reactive counts & metrics computed from printers list
const printingCount = computed(() => printers.value.filter((p) => p.state === 'PRINTING').length);
const preparingCount = computed(() => printers.value.filter((p) => p.state === 'PREPARING').length);
const clearingCount = computed(() => printers.value.filter((p) => p.state === 'CLEARING_REQUIRED').length);
const idleCount = computed(() => printers.value.filter((p) => p.state === 'IDLE').length);
const offlineCount = computed(() => printers.value.filter((p) => p.state === 'OFFLINE').length);
const errorCount = computed(
  () =>
    printers.value.filter((p) => p.state === 'PAUSED' && !(p.status_message || '').toLowerCase().includes('ams'))
      .length
);
const blockedCount = computed(
  () =>
    printers.value.filter((p) => p.state === 'PAUSED' && (p.status_message || '').toLowerCase().includes('ams'))
      .length
);
const readyCount = computed(() => clearingCount.value + blockedCount.value);
const totalPrintersCount = computed(() => printers.value.length);
const utilizationRate = computed(() =>
  Math.round(((printingCount.value + preparingCount.value) / (totalPrintersCount.value || 1)) * 100)
);

// Tab filter badges
const focusPrintersCount = computed(() => 6);
const attentionPrintersCount = computed(
  () => errorCount.value + clearingCount.value + blockedCount.value
);

// Priority ranking helper for attention/focus sorting
function getAttentionRank(printer: Printer): number {
  if (printer.state === 'PAUSED') {
    const msg = (printer.status_message || '').toLowerCase();
    if (msg.includes('ams') || msg.includes('blocked')) return 3;
    return 1; // Fault / Filament out
  }
  if (printer.state === 'CLEARING_REQUIRED') return 2;
  if (printer.state === 'UNMANAGED_PRINTING') return 4;
  if (printer.state === 'PREPARING') return 5;
  if (printer.state === 'PRINTING') return 6;
  if (printer.state === 'IDLE') return 7;
  return 8; // OFFLINE
}

// Displayed and filtered printers list
const displayedPrinters = computed(() => {
  const q = query.value.trim().toLowerCase();
  let list = printers.value.filter((p) => {
    const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
    if (!matchesSearch) return false;

    if (filter.value === 'attention') {
      return (
        p.state === 'PAUSED' ||
        p.state === 'CLEARING_REQUIRED' ||
        p.state === 'UNMANAGED_PRINTING'
      );
    }
    if (filter.value === 'focus') {
      // Focus on 5 attention printers plus 1 active printing/preparing printer
      return (
        p.state === 'PAUSED' ||
        p.state === 'CLEARING_REQUIRED' ||
        p.name === 'X1C-01'
      );
    }
    return true; // 'all'
  });

  // Sorting
  if (filter.value === 'all') {
    // "全部设备": strictly natural numeric sort by name (X1C-01 < X1C-02 < X1C-10)
    return list.slice().sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
  }

  // Other views ("重点设备", "需处理"): sort by attention priority, tie-break by name
  return list.slice().sort((a, b) => {
    const rankDiff = getAttentionRank(a) - getAttentionRank(b);
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
});

function onSelectPrinter(id: string) {
  // Reserved select event hook for future drawer/detail interaction
  console.log(`[PlateRelay] Selected printer UUID: ${id}`);
}

let clockInterval: number | null = null;

onMounted(() => {
  updateColumns();
  window.addEventListener('resize', updateColumns);

  // Single global 1-second clock
  clockInterval = window.setInterval(() => {
    currentTime.value = Math.floor(Date.now() / 1000);
  }, 1000);
});

onUnmounted(() => {
  window.removeEventListener('resize', updateColumns);
  if (clockInterval !== null) {
    clearInterval(clockInterval);
  }
});
</script>

<template>
  <div class="dashboard-viewport">
    <div
      class="dashboard-artboard"
      :data-node-id="page === 'overview' ? '7:356' : '70:581'"
    >
      <aside class="sidebar" aria-label="主导航">
        <div class="brand" data-node-id="7:358">
          <img :src="brandIcon" alt="" width="35" height="32" />
          <p class="brand-name">PlateRelay</p>
          <p class="brand-caption">打印机管理中枢</p>
        </div>
        <nav class="navigation">
          <button
            class="nav-entry"
            :class="{ 'is-active': page === 'overview' }"
            :aria-current="page === 'overview' ? 'page' : undefined"
            @click="page = 'overview'"
          >
            <span class="nav-state-layer">
              <img :src="navigationIcon" alt="" width="20" height="20" />
              <span>概览</span>
            </span>
          </button>
          <button
            class="nav-entry"
            :class="{ 'is-active': page === 'print' }"
            :aria-current="page === 'print' ? 'page' : undefined"
            @click="page = 'print'"
          >
            <span class="nav-state-layer">
              <img :src="navigationIcon" alt="" width="20" height="20" />
              <span>申请打印</span>
            </span>
          </button>
        </nav>
      </aside>

      <main class="workspace">
        <header class="workspace-header" data-node-id="7:371">
          <h1>{{ page === 'overview' ? '概况' : '申请打印' }}</h1>
          <div class="workspace-tools" data-node-id="7:374">
            <span class="notification" role="img" aria-label="通知" data-node-id="7:375">
              <img :src="notificationIcon" alt="" width="24" height="24" />
            </span>
            <div
              v-if="!isGuest"
              class="account-profile"
              role="button"
              tabindex="0"
              title="点击切换为访客视角"
              aria-label="用户账户"
              @click="toggleUserAuth"
              data-node-id="117:624"
            >
              <img class="profile-avatar" :src="tomAvatar" alt="" width="36" height="36" />
              <div class="profile-info">
                <span class="profile-name">Tom_Chicken</span>
                <span class="profile-role">Pro</span>
              </div>
            </div>
            <div
              v-else
              class="account-profile is-guest"
              role="button"
              tabindex="0"
              title="点击切换为已登录视角"
              aria-label="访客，点击登录"
              @click="toggleUserAuth"
              data-node-id="120:643"
            >
              <div class="generic-avatar" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="8" r="4" stroke="#49454F" stroke-width="2" />
                  <path d="M4 20C4 15.5 7.5 14 12 14C16.5 14 20 15.5 20 20" stroke="#49454F" stroke-width="2" stroke-linecap="round" />
                </svg>
              </div>
              <div class="profile-info">
                <span class="profile-name">访客</span>
                <span class="profile-role is-login">点击登录</span>
              </div>
            </div>
          </div>
        </header>

        <template v-if="page === 'overview'">
          <section class="metrics" aria-label="业务流转指标" data-node-id="7:377">
            <article class="metric" data-node-id="7:389">
              <div class="metric-heading">
                <h2>排队 / 等待中</h2>
                <img :src="queueIcon" alt="" width="20" height="20" />
              </div>
              <div class="metric-value">
                <span class="metric-number">16</span>
                <span class="metric-unit">项</span>
              </div>
              <p class="metric-description">含 1 项紧急 · 1 项 AMS 阻断</p>
              <p class="metric-trend">↓ 较 1 小时前 −4</p>
            </article>

            <article class="metric" data-node-id="7:401">
              <div class="metric-heading">
                <h2>正在打印设备</h2>
                <img :src="printerIcon" alt="" width="20" height="20" />
              </div>
              <div class="metric-value">
                <span class="metric-number">{{ printingCount }}</span>
                <span class="metric-unit">/ {{ totalPrintersCount }} 台</span>
              </div>
              <p class="metric-description">当前利用率 {{ utilizationRate }}% · {{ preparingCount }} 台预热</p>
              <p class="metric-trend">↑ 较 1 小时前 +2 台</p>
            </article>

            <article class="metric" data-node-id="7:413">
              <div class="metric-heading">
                <h2>待清台机器</h2>
                <img :src="clearingIcon" alt="" width="20" height="20" />
              </div>
              <div class="metric-value">
                <span class="metric-number">{{ clearingCount }}</span>
                <span class="metric-unit">台</span>
              </div>
              <p class="metric-description is-warning">未入库确认前禁止派单</p>
              <p class="metric-trend">↑ 较 1 小时前 +1 台</p>
            </article>
          </section>

          <section class="equipment" aria-labelledby="equipment-title" data-node-id="7:444">
            <header class="equipment-header">
              <div class="equipment-heading">
                <h2 id="equipment-title">设备状态</h2>
                <p>
                  {{ totalPrintersCount }} 台设备 · {{ printingCount }} 打印中 / {{ preparingCount }} 预热 /
                  {{ readyCount }} 就绪（{{ clearingCount }} 待清台、{{ blockedCount }} AMS 阻断）/
                  {{ idleCount }} 空闲 / {{ errorCount }} 故障 / {{ offlineCount }} 离线
                </p>
              </div>
              <div class="equipment-actions">
                <label class="device-search">
                  <span class="search-leading">
                    <img :src="searchIcon" alt="" width="16" height="16" />
                  </span>
                  <input
                    v-model="query"
                    aria-label="设备"
                    placeholder="搜索设备或 UUID"
                    type="search"
                  />
                </label>
                <div class="device-filters" aria-label="视图筛选">
                  <button
                    class="device-filter focus-filter"
                    :class="{ 'is-selected': filter === 'focus' }"
                    :aria-pressed="filter === 'focus'"
                    @click="filter = 'focus'"
                  >
                    <img :src="selectedIcon" alt="" width="18" height="18" />
                    <span>重点设备 {{ focusPrintersCount }}</span>
                  </button>
                  <button
                    class="device-filter"
                    :class="{ 'is-selected': filter === 'all' }"
                    :aria-pressed="filter === 'all'"
                    @click="filter = 'all'"
                  >
                    全部 {{ totalPrintersCount }}
                  </button>
                  <button
                    class="device-filter"
                    :class="{ 'is-selected': filter === 'attention' }"
                    :aria-pressed="filter === 'attention'"
                    @click="filter = 'attention'"
                  >
                    需处理 {{ attentionPrintersCount }}
                  </button>
                </div>
              </div>
            </header>

            <!-- Responsive Masonry Grid (Dynamic N-columns, zero vertical gaps) -->
            <div class="masonry-grid" data-node-id="7:453">
              <div
                v-for="(col, colIdx) in masonryColumns"
                :key="colIdx"
                class="masonry-column"
              >
                <PrinterCard
                  v-for="printer in col"
                  :key="printer.id"
                  :printer="printer"
                  :current-time="currentTime"
                  @select="onSelectPrinter"
                />
              </div>
            </div>
          </section>
        </template>
      </main>

      <!-- Mobile Bottom Navigation Bar (< 768px) -->
      <nav class="mobile-bottom-nav" aria-label="移动端导航">
        <button
          class="mobile-nav-entry"
          :class="{ 'is-active': page === 'overview' }"
          :aria-current="page === 'overview' ? 'page' : undefined"
          @click="page = 'overview'"
        >
          <img :src="navigationIcon" alt="" />
          <span>概况</span>
        </button>
        <button
          class="mobile-nav-entry"
          :class="{ 'is-active': page === 'print' }"
          :aria-current="page === 'print' ? 'page' : undefined"
          @click="page = 'print'"
        >
          <img :src="navigationIcon" alt="" />
          <span>申请打印</span>
        </button>
      </nav>
    </div>
  </div>
</template>
