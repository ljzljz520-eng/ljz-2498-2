<template>
  <div>
    <div class="disclaimer">
      正文保存为结构化模块树，每次保存生成一个候选版本；可回滚到任意版本（含 v1 旧草稿迁移版），
      回滚本身也作为新版本保留，历史不丢失。
    </div>

    <h3 class="sec">旧草稿恢复（v1 任意 HTML → v2 模块树）</h3>
    <div class="field"><label>旧草稿标题</label><input type="text" v-model="legacy.title"></div>
    <div class="field"><label>旧草稿正文 HTML（迁移前会再经一次服务端清理）</label>
      <textarea v-model="legacy.html" placeholder='<p style="position:fixed;animation:x 1s">旧图文…</p>'></textarea></div>
    <button class="btn" @click="recover">恢复为结构化草稿</button>

    <h3 class="sec">候选版本</h3>
    <div v-for="v in versions" :key="v.version" class="list-item">
      <div class="row" style="justify-content:space-between">
        <strong>v{{ v.version }}</strong>
        <span class="badge muted">schema v{{ v.schema_version }}</span>
      </div>
      <div class="muted">{{ v.label }} · {{ v.created_by }} · {{ v.created_at }}</div>
      <button class="btn small secondary" style="margin-top:6px" @click="restore(v.version)">恢复此版本</button>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, watch } from 'vue';
import { api } from '../api.js';

const props = defineProps({ doc: Object });
const emit = defineEmits(['recovered', 'restored']);
const versions = ref([]);
const legacy = reactive({ title: '从旧系统导入', html: '' });

async function load() {
  if (props.doc?.id) versions.value = await api.versions(props.doc.id);
}
watch(() => props.doc?.id, load, { immediate: true });

async function restore(version) {
  await api.restoreVersion(props.doc.id, version);
  emit('restored');
}
async function recover() {
  const result = await api.recoverLegacy(legacy.title, legacy.html);
  legacy.html = '';
  emit('recovered', result.doc);
}
defineExpose({ load });
</script>
