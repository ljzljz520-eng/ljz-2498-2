<template>
  <div>
    <h3 class="sec">上传素材（封面 / 正文图 / 图标）</h3>
    <div class="field">
      <label>类型</label>
      <select v-model="form.kind">
        <option value="image">正文图片</option>
        <option value="cover">封面图</option>
        <option value="icon">图标（参与暗色可见性校验）</option>
      </select>
    </div>
    <div class="field"><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" @change="onFile"></div>
    <button class="btn" :disabled="!file" @click="upload">上传</button>
    <span v-if="tooBig" class="badge bad" style="margin-left:8px">超过 2MB，可上传但导出校验将阻断</span>

    <h3 class="sec">素材库与授权状态（模拟资源授权变化）</h3>
    <div v-for="a in assets" :key="a.id" class="list-item">
      <div class="row" style="justify-content:space-between">
        <strong>{{ a.filename }}</strong>
        <span :class="['badge', a.authorized ? 'ok' : 'bad']">{{ a.authorized ? '已授权' : '授权已撤回' }}</span>
      </div>
      <div class="muted">
        {{ a.kind }} · {{ a.mime_type }} · {{ (a.bytes/1024/1024).toFixed(2) }}MB
        <template v-if="a.width"> · {{ a.width }}×{{ a.height }} · 亮度 {{ a.avg_luminance?.toFixed(2) ?? '—' }}</template>
      </div>
      <div class="muted" v-if="a.auth_note">授权说明：{{ a.auth_note }}</div>
      <div class="row" style="margin-top:6px">
        <button class="btn small danger" v-if="a.authorized" @click="setAuth(a, false)">撤回授权（模拟版权方变更）</button>
        <button class="btn small secondary" v-else @click="setAuth(a, true)">重新授权</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { api } from '../api.js';

const props = defineProps({ assets: Array });
const emit = defineEmits(['changed']);
const form = reactive({ kind: 'image' });
const file = ref(null);
const tooBig = ref(false);

function onFile(e) {
  file.value = e.target.files[0];
  tooBig.value = file.value && file.value.size > 2 * 1024 * 1024;
}
async function upload() {
  const buf = await file.value.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const i of bytes) bin += String.fromCharCode(i);
  const base64 = btoa(bin);
  await api.uploadAsset({ filename: file.value.name, mimeType: file.value.type, kind: form.kind, base64 });
  file.value = null;
  emit('changed');
}
async function setAuth(a, authorized) {
  const note = authorized ? '' : '授权已过期/版权方撤回（' + new Date().toLocaleString() + '）';
  await api.setAuth(a.id, authorized, note);
  emit('changed');
}
</script>
