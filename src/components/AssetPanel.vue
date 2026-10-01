<template>
  <div class="section">
    <h5>资源库 / 封面 · 授权管理</h5>
    <div v-for="a in assets" :key="a.id" class="asset-row">
      <img :src="`/api/assets/${a.id}/raw?t=${tick}`" alt="资源">
      <div class="info">
        <div class="nm">{{ a.sourceName || a.filename }}</div>
        <div class="muted" style="font-size:10px">
          {{ a.kind }} · {{ a.width || '?' }}×{{ a.height || '?' }} · {{ kb(a.size) }}
        </div>
        <div :class="'st st-' + a.status">{{ statusText(a.status) }}</div>
      </div>
      <button v-if="a.status==='authorized'" class="btn tiny danger" @click="setStatus(a,'revoked')">撤销授权</button>
      <button v-else class="btn tiny" @click="setStatus(a,'authorized')">重新授权</button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { api } from '../api.js';
const props = defineProps({ actor: String });
const emit = defineEmits(['changed', 'toast']);
const assets = ref([]);
const tick = ref(0);

async function load() {
  const r = await api.assets();
  if (r.ok) assets.value = r.body;
}
load();
defineExpose({ load });

async function setStatus(a, status) {
  const r = await api.setAssetStatus(a.id, status, props.actor);
  if (r.ok) {
    tick.value++;
    await load();
    emit('changed');
    emit('toast', { type: status === 'revoked' ? 'err' : 'ok', text: `资源「${a.sourceName}」授权${status === 'revoked' ? '已撤销' : '已恢复'}` });
  }
}
function kb(n) { return n > 1024 ? (n / 1024).toFixed(0) + 'KB' : n + 'B'; }
function statusText(s) { return { authorized: '已授权', revoked: '已撤销', expired: '已过期' }[s] || s; }
</script>
