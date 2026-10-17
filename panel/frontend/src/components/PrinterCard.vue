<script setup lang="ts">
import { computed } from 'vue';
import camera from '../assets/dashboard/8f1af.png';
import printer from '../assets/dashboard/7b5f4.svg';
import nozzle from '../assets/dashboard/fc21c.svg';
import bed from '../assets/dashboard/07c3c.svg';
import chamber from '../assets/dashboard/e4756.svg';
import layers from '../assets/dashboard/e37ac.svg';
import ring1 from '../assets/dashboard/66307.svg';
import ring2 from '../assets/dashboard/3e36f.svg';
import ring3 from '../assets/dashboard/2abd9.svg';
import ring4 from '../assets/dashboard/ea778.svg';
import active from '../assets/dashboard/b008f.svg';
import avatar from '../assets/dashboard/a118a.svg';
import waveStart from '../assets/dashboard/723b1.svg';
import wave from '../assets/dashboard/6cd82.svg';
import segmentStart from '../assets/dashboard/c2c1c.svg';
import segment from '../assets/dashboard/df020.svg';
import fullSegment from '../assets/dashboard/f40df.svg';
import error from '../assets/dashboard/70824.svg';
import lock from '../assets/dashboard/a099e.svg';

type Variant = 'printing' | 'error' | 'blocked' | 'clearing' | 'offline';
const props = defineProps<{ variant: Variant }>();
const designs = {
  printing: { name: 'X1C-01', status: '打印中', percent: '80%', time: '已用 1h 36m / 剩余 24m', node: '7:493' },
  error: { name: 'P1SC-05', status: '故障', percent: '80%', time: '已用 1h 36m / 剩余 24m', node: '55:1017' },
  blocked: { name: 'X2D-01', status: '问题', percent: '0%', time: '暂未打印 / 剩余 2h 45m', node: '55:2124' },
  clearing: { name: 'P2S-04', status: '问题', percent: '100%', time: '打印完成 / 已等待清台 35m', node: '55:1850' },
  offline: { name: 'P2S-03', status: '离线', percent: '0%', time: '暂未打印 / 剩余 2h 45m', node: '55:2303' },
};
const design = computed(() => designs[props.variant]);
const ams = [
  { label: 'A1', material: 'PLA', image: ring1 },
  { label: 'A2', material: 'PETG', image: ring2 },
  { label: 'A3', material: 'PLA', image: ring3 },
  { label: 'A4', material: 'PLA', image: ring4 },
];
</script>

<template>
  <article class="printer-card" :class="variant" :data-node-id="design.node" :aria-label="`${design.name} · ${design.status}`">
    <header class="heading">
      <div class="name"><img :src="printer" alt="" /><h3>{{ design.name }}</h3></div>
      <span class="status">{{ design.status }}</span>
    </header>
    <div class="body">
      <div class="overview">
        <img class="camera" :src="camera" alt="" />
        <div class="readings">
          <div class="reading"><img :src="nozzle" alt="" /><span>215 / 220°C</span></div>
          <div v-if="variant === 'blocked'" class="reading"><img :src="nozzle" alt="" /><span>215 / 220°C</span></div>
          <div class="reading"><img :src="bed" alt="" /><span>62 / 60°C</span></div>
          <div class="reading"><img :src="chamber" alt="" /><span>38  / 40°C</span></div>
          <div class="reading"><img :src="layers" alt="" /><span>120 / 215 </span></div>
        </div>
        <div class="ams">
          <div v-for="(slot, index) in ams" :key="slot.label" class="ams-row">
            <span class="ring" :class="`ring-${index + 1}`"><img :src="slot.image" alt="" /></span>
            <span class="slot-label">{{ slot.label }}</span><span class="material">{{ slot.material }}</span>
            <img v-if="index === 0" class="active" :src="active" alt="" />
          </div>
        </div>
      </div>
      <div class="task">
        <div class="author"><img :src="avatar" alt="" /><span>Tom_Chicken</span></div>
        <div class="filename"><span>机械臂轴承.3mf.gcode</span><span class="percent">{{ design.percent }}</span></div>
        <div class="progress" :class="{ wavy: variant === 'printing' }">
          <template v-if="variant === 'printing'">
            <div class="waves"><span v-for="index in 8" :key="index" class="wave" :class="{ first: index === 1 }"><img :src="index === 1 ? waveStart : wave" alt="" /></span></div>
            <span class="track wave-track"><i /></span>
          </template>
          <template v-else-if="variant === 'error'">
            <div class="partial"><span class="segment-start"><img :src="segmentStart" alt="" /></span><span class="segment"><img :src="segment" alt="" /></span></div><span class="track partial-track"><i /></span>
          </template>
          <span v-else-if="variant === 'clearing'" class="full-segment"><img :src="fullSegment" alt="" /></span>
          <span v-else class="track empty-track"><i /></span>
        </div>
        <p class="time">{{ design.time }}</p>
      </div>
    </div>
    <div v-if="variant === 'offline'" class="last-online"><p>最后在线时间</p><p>​</p><p> 2026-09-26 22:48:59</p></div>
    <div v-if="variant === 'error' || variant === 'blocked' || variant === 'clearing'" class="safety">
      <img :src="variant === 'error' ? error : lock" alt="" />
      <span>{{ variant === 'error' ? 'A2 断料 · 请暂停后补料并复核' : variant === 'blocked' ? 'AMS 匹配耗材失败' : '热床未清空' }}</span>
    </div>
  </article>
</template>

<style scoped>
.printer-card { position: relative; flex: none; width: 464px; height: 303px; overflow: hidden; border-radius: 12px; background: #211f26; color: #e6e0e9; font-family: Roboto, sans-serif; font-variation-settings: 'wdth' 100; }
.printer-card.printing { height: 307px; }
.printer-card.error { height: 345px; }
.printer-card.blocked, .printer-card.clearing { height: 359px; }
.heading { position: absolute; top: 20px; left: 20px; width: 424px; height: 32px; display: flex; align-items: center; justify-content: space-between; overflow: hidden; }
.name { display: flex; align-items: center; gap: 8px; }
.name img { width: 20px; height: 20px; }
h3 { margin: 0; font-size: 16px; font-weight: 600; line-height: 24px; letter-spacing: .15px; }
.status { display: flex; flex: none; justify-content: center; width: 61px; height: 32px; align-items: center; padding: 6px 16px; border-radius: 8px; background: #3e2d20; color: #f6ba78; font-size: 14px; font-weight: 500; line-height: 20px; letter-spacing: .1px; }
.printing .status { width: 75px; background: #213a2d; color: #92d5ab; }
.error .status { background: rgba(255,56,60,.14); color: #ff383c; }
.offline .status { background: #2b2930; color: #cac4d0; }
.body { position: absolute; left: 20px; top: 66px; width: 430px; height: 217px; }
.overview { display: flex; align-items: center; width: 424px; height: 123px; }
.camera { display: block; flex: none; width: 220px; height: 123px; object-fit: cover; border-radius: 8px; margin-right: 16px; }
.readings { width: 98px; height: 123px; flex: none; display: flex; flex-direction: column; justify-content: center; gap: 6px; overflow: hidden; }
.reading { display: flex; flex: none; align-items: center; gap: 6px; width: 98px; height: 20px; white-space: pre; font-size: 14px; font-weight: 400; line-height: 20px; letter-spacing: .25px; }
.reading img { display: block; width: 14px; height: 14px; flex: none; }
.ams { display: flex; flex: none; flex-direction: column; justify-content: center; gap: 6px; width: 90px; height: 123px; padding: 0 4px; overflow: hidden; }
.ams-row { display: flex; flex: none; align-items: center; gap: 4px; height: 20px; width: 82px; padding: 0 2px; overflow: hidden; color: white; font-size: 11px; font-weight: 500; line-height: 16px; letter-spacing: .5px; }
.ring { position: relative; flex: none; width: 14px; height: 14px; }
.ring img { position: absolute; display: block; max-width: none; }
.ring-1 img { left: 0; top: .35%; width: 13.9514px; height: 13.9514px; }
.ring-2 img { left: 0; top: 12.08%; width: 13.9514px; height: 12.3086px; }
.ring-3 img { left: 74.51%; top: 50%; width: 3.51952px; height: 5.30865px; }
.ring-4 img { left: 23.1%; top: 50%; width: 10.7175px; height: 7px; }
.slot-label { width: 15px; flex: none; }
.material { width: 32px; flex: none; }
.active { width: 4px; height: 4px; flex: none; }
.task { position: absolute; top: 137px; left: 0; width: 430px; overflow: hidden; }
.author { display: flex; align-items: center; gap: 6px; height: 24px; width: 120px; overflow: hidden; color: white; font-size: 14px; font-weight: 500; line-height: 20px; letter-spacing: .1px; white-space: nowrap; }
.author img { width: 20px; height: 20px; flex: none; }
.filename { display: flex; justify-content: space-between; align-items: center; height: 20px; margin-top: 4px; font-size: 14px; font-weight: 500; line-height: 20px; letter-spacing: .1px; white-space: nowrap; }
.percent { color: #d0bcff; }
.progress { position: relative; width: 430px; height: 12px; margin-top: 4px; }
.waves { position: absolute; top: 0; left: 2px; display: flex; width: 320px; height: 12px; }
.wave { position: relative; width: 40px; height: 12px; flex: none; }
.wave img { position: absolute; left: -2.57%; width: 43.0293px; height: 12px; max-width: none; }
.wave.first { transform: rotate(180deg); }
.track { position: absolute; top: 4px; height: 4px; border-radius: 2px; background: #4a4458; }
.track i { position: absolute; right: 0; top: 0; height: 4px; width: 4px; border-radius: 26px; background: #d0bcff; }
.wave-track { left: 328px; right: 0; }
.partial { position: absolute; top: 0; left: 2px; width: 337.3496px; height: 12px; display: flex; }
.segment-start { position: relative; flex: none; width: 40px; height: 12px; }
.segment-start img { position: absolute; left: -5%; width: 44px; height: 12px; max-width: none; }
.segment { position: relative; flex: 1; height: 12px; }
.segment img { position: absolute; left: -.67%; width: 301px; height: 12px; max-width: none; }
.partial-track { left: 345.3496px; right: 0; }
.empty-track { left: 0; right: 0; }
.full-segment { position: absolute; left: 2px; right: 2px; height: 12px; }
.full-segment img { position: absolute; left: -.47%; width: 430px; height: 12px; max-width: none; }
.time { margin: 0; color: #cac4d0; font-size: 12px; font-weight: 400; line-height: 16px; letter-spacing: .4px; white-space: nowrap; }
.printing .time { margin-top: 4px; }
.safety { position: absolute; top: 297px; left: 20px; width: 424px; height: 42px; display: flex; align-items: center; gap: 10px; padding-left: 12px; border-radius: 8px; background: #3e2d20; color: #f6ba78; font-family: 'Microsoft YaHei', sans-serif; font-size: 14px; line-height: 16px; letter-spacing: .4px; white-space: nowrap; }
.safety img { width: 18px; height: 18px; flex: none; }
.error .safety { top: 303px; left: 0; width: 464px; background: #8c1d18; color: #f2b8b5; font-weight: 700; }
.offline .body { filter: blur(4px); }
.last-online { position: absolute; top: 137px; left: 106px; width: 252px; color: #938f99; text-align: center; font-family: 'Microsoft YaHei', sans-serif; font-size: 24px; font-weight: 400; line-height: 16px; letter-spacing: .4px; white-space: pre-wrap; }
.last-online p { margin: 0; line-height: 16px; }
</style>
