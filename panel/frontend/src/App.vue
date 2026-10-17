<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import PrinterCard from './components/PrinterCard.vue';
import brandIcon from './assets/dashboard/1ef04.svg';
import navigationIcon from './assets/dashboard/76b4e.svg';
import notificationIcon from './assets/dashboard/dc112.svg';
import searchIcon from './assets/dashboard/386ce.svg';
import queueIcon from './assets/dashboard/be719.svg';
import printerIcon from './assets/dashboard/44e7c.svg';
import clearingIcon from './assets/dashboard/45be8.svg';
import selectedIcon from './assets/dashboard/103f4.svg';

const scale = ref(1);
const page = ref<'overview' | 'print'>('overview');
const query = ref('');
const filter = ref<'focus' | 'all' | 'attention'>('focus');
const artboardHeight = computed(() => page.value === 'overview' ? 1096 : 1080);
const deviceNames = {
  printing: 'X1C-01',
  error: 'P1SC-05',
  blocked: 'X2D-01',
  clearing: 'P2S-04',
  offline: 'P2S-03',
};
function isVisible(variant: keyof typeof deviceNames) {
  return (filter.value !== 'attention' || variant !== 'printing')
    && deviceNames[variant].toLowerCase().includes(query.value.trim().toLowerCase());
}
let resizeObserver: ResizeObserver | null = null;
let fitFrame = 0;
function fitArtboard() {
  scale.value = document.documentElement.clientWidth / 1680;
}
onMounted(() => {
  fitArtboard();
  resizeObserver = new ResizeObserver(() => {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(fitArtboard);
  });
  resizeObserver.observe(document.documentElement);
});
onUnmounted(() => {
  resizeObserver?.disconnect();
  cancelAnimationFrame(fitFrame);
});
</script>

<template>
  <div class="dashboard-viewport" :style="{ height: `${artboardHeight * scale}px` }">
    <div class="dashboard-artboard" :style="{ height: `${artboardHeight}px`, transform: `scale(${scale})` }" :data-node-id="page === 'overview' ? '7:356' : '70:581'">
      <aside class="sidebar" aria-label="主导航">
        <div class="brand" data-node-id="7:358">
          <img :src="brandIcon" alt="" width="35" height="32" />
          <p class="brand-name">PlateRelay</p>
          <p class="brand-caption">打印机管理中枢</p>
        </div>
        <nav class="navigation">
          <button class="nav-entry" :class="{ 'is-active': page === 'overview' }" :aria-current="page === 'overview' ? 'page' : undefined" @click="page = 'overview'">
            <span class="nav-state-layer"><img :src="navigationIcon" alt="" width="20" height="20" /><span>概览</span></span>
          </button>
          <button class="nav-entry" :class="{ 'is-active': page === 'print' }" :aria-current="page === 'print' ? 'page' : undefined" @click="page = 'print'">
            <span class="nav-state-layer"><img :src="navigationIcon" alt="" width="20" height="20" /><span>申请打印</span></span>
          </button>
        </nav>
      </aside>

      <main class="workspace">
        <header class="workspace-header" data-node-id="7:371">
          <h1>{{ page === 'overview' ? '概况' : '申请打印' }}</h1>
          <div class="workspace-tools">
            <span class="notification" role="img" aria-label="通知"><img :src="notificationIcon" alt="" width="24" height="24" /></span>
            <label class="device-search">
              <span class="search-leading"><img :src="searchIcon" alt="" width="24" height="24" /></span>
              <input v-model="query" aria-label="设备" placeholder="设备" type="search" />
            </label>
          </div>
        </header>

        <template v-if="page === 'overview'">
          <section class="metrics" aria-label="业务流转指标" data-node-id="7:377">
            <article class="metric" data-node-id="7:389">
              <div class="metric-heading"><h2>排队 / 等待中</h2><img :src="queueIcon" alt="" width="20" height="20" /></div>
              <div class="metric-value"><span class="metric-number">16</span><span class="metric-unit">项</span></div>
              <p class="metric-description">含 1 项紧急 · 1 项 AMS 阻断</p>
              <p class="metric-trend">↓ 较 1 小时前 −4</p>
            </article>
            <article class="metric" data-node-id="7:401">
              <div class="metric-heading"><h2>正在打印设备</h2><img :src="printerIcon" alt="" width="20" height="20" /></div>
              <div class="metric-value"><span class="metric-number">11</span><span class="metric-unit">/ 20 台</span></div>
              <p class="metric-description">当前利用率 60% · 1 台预热</p>
              <p class="metric-trend">↑ 较 1 小时前 +2 台</p>
            </article>
            <article class="metric" data-node-id="7:413">
              <div class="metric-heading"><h2>待清台机器</h2><img :src="clearingIcon" alt="" width="20" height="20" /></div>
              <div class="metric-value"><span class="metric-number">3</span><span class="metric-unit">台</span></div>
              <p class="metric-description is-warning">未入库确认前禁止派单</p>
              <p class="metric-trend">↑ 较 1 小时前 +1 台</p>
            </article>
          </section>

          <section class="equipment" aria-labelledby="equipment-title" data-node-id="7:444">
            <header class="equipment-header">
              <div class="equipment-heading">
                <h2 id="equipment-title">设备状态</h2>
                <p>20 台设备 · 11 打印中 / 1 预热 / 4 就绪（3 待清台、1 AMS 阻断）/ 1 空闲 / 1 故障 / 2 离线</p>
              </div>
              <div class="device-filters" aria-label="视图筛选">
                <button class="device-filter focus-filter" :class="{ 'is-selected': filter === 'focus' }" :aria-pressed="filter === 'focus'" @click="filter = 'focus'"><img :src="selectedIcon" alt="" width="18" height="18" /><span>重点设备 6</span></button>
                <button class="device-filter" :class="{ 'is-selected': filter === 'all' }" :aria-pressed="filter === 'all'" @click="filter = 'all'">全部 20</button>
                <button class="device-filter" :class="{ 'is-selected': filter === 'attention' }" :aria-pressed="filter === 'attention'" @click="filter = 'attention'">需处理 5</button>
              </div>
            </header>
            <div class="device-columns" data-node-id="7:453">
              <div class="device-column" data-node-id="7:454">
                <PrinterCard v-if="isVisible('printing')" variant="printing" />
                <PrinterCard v-if="isVisible('error')" variant="error" />
              </div>
              <div class="device-column" data-node-id="7:538">
                <PrinterCard v-if="isVisible('blocked')" variant="blocked" />
                <PrinterCard v-if="isVisible('offline')" variant="offline" />
              </div>
              <div class="device-column" data-node-id="7:625">
                <PrinterCard v-if="isVisible('clearing')" variant="clearing" />
              </div>
            </div>
          </section>
        </template>
      </main>
    </div>
  </div>
</template>
