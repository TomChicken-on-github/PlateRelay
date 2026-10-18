<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

const canvas = ref<HTMLCanvasElement | null>(null);
let observer: ResizeObserver | undefined;
let motion: MediaQueryList | undefined;
let frame = 0;

function draw(time: number) {
  const element = canvas.value;
  const context = element?.getContext('2d');
  if (!element || !context) return;

  const width = element.getBoundingClientRect().width;
  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.max(1, Math.round(width * ratio));
  const pixelHeight = Math.round(12 * ratio);
  if (element.width !== pixelWidth || element.height !== pixelHeight) {
    element.width = pixelWidth;
    element.height = pixelHeight;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, 12);
  if (width > 4) {
    const phase = motion?.matches ? 0 : time * 0.001;
    context.beginPath();
    for (let x = 2; x <= width - 2; x += 3) {
      const y = 6 - 3.8 * Math.sin((x / 40 - phase) * 2 * Math.PI);
      if (x === 2) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.lineTo(width - 2, 6 - 3.8 * Math.sin(((width - 2) / 40 - phase) * 2 * Math.PI));
    context.strokeStyle = '#d0bcff';
    context.lineWidth = 3.5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();
  }
  if (!motion?.matches) frame = requestAnimationFrame(draw);
}

function onMotionChange() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(draw);
}

onMounted(() => {
  motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  motion.addEventListener('change', onMotionChange);
  observer = new ResizeObserver(() => {
    if (motion?.matches) draw(0);
  });
  observer.observe(canvas.value!);
  frame = requestAnimationFrame(draw);
});

onUnmounted(() => {
  cancelAnimationFrame(frame);
  observer?.disconnect();
  motion?.removeEventListener('change', onMotionChange);
});
</script>

<template>
  <canvas ref="canvas" class="wave-canvas" aria-hidden="true" />
</template>

<style scoped>
.wave-canvas {
  display: block;
  width: 100%;
  height: 12px;
}
</style>
