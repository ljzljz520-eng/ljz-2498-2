<template>
  <div class="stage">
    <div class="bp-bar">
      <button :class="{ active: viewport === 'phone' }" @click="setVp('phone')">手机 375</button>
      <button :class="{ active: viewport === 'desktop' }" @click="setVp('desktop')">桌面 1080（正文列 ≈677px）</button>
      <span class="bp-note">{{ bpNote }}</span>
      <span class="badge muted" style="margin-left:auto">受控近似预览 · 非平台像素还原</span>
    </div>
    <div class="canvas-wrap">
      <div :class="viewport === 'phone' ? 'canvas-phone' : 'canvas-desktop'">
        <iframe title="controlled-preview" sandbox="" :srcdoc="html"></iframe>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue';
import { api } from '../api.js';

const props = defineProps({ doc: Object, capabilities: Object, refreshKey: Number });
const viewport = ref('phone');
const html = ref('');

const bpNote = () => {
  const bp = props.capabilities?.breakpoints?.find((b) => b.id === viewport.value);
  return bp?.dprNote || '';
};

async function load() {
  if (!props.doc?.id) { html.value = ''; return; }
  const out = await api.preview(props.doc.id, viewport.value);
  html.value = out.html;
}
function setVp(v) { viewport.value = v; }
watch(viewport, load);
watch(() => [props.doc?.id, props.doc?.currentVersion, props.refreshKey], load);
onMounted(load);
</script>
