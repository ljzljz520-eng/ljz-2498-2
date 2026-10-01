<template>
  <div class="app">
    <div class="topbar">
      <h1>公众号图文全栈预览台</h1>
      <span class="meta">目标平台：{{ capabilities?.platform?.label }} · 编辑者：{{ editorId }}</span>
      <span class="badge muted" style="margin-left:auto">受控近似预览，不承诺与外部平台像素一致</span>
    </div>

    <div class="layout">
      <div class="sidebar">
        <div class="tabs">
          <button v-for="t in tabs" :key="t.id" :class="{ active: tab === t.id }" @click="tab = t.id">{{ t.label }}</button>
        </div>
        <div class="tab-body">
          <template v-if="!doc">
            <button class="btn" @click="newDoc">新建图文</button>
          </template>
          <template v-else>
            <ModuleEditor v-if="tab==='edit'" ref="editorRef" :doc="doc" :assets="assets" @saved="onSaved"></ModuleEditor>
            <AssetsPanel v-else-if="tab==='assets'" :assets="assets" @changed="loadAssets"></AssetsPanel>
            <CoversPanel v-else-if="tab==='cover'" ref="coverRef" :doc="doc" :assets="assets" @changed="reloadDoc"></CoversPanel>
            <VersionPanel v-else-if="tab==='version'" ref="versionRef" :doc="doc"
                          @recovered="onRecovered" @restored="reloadDoc"></VersionPanel>
          </template>
        </div>
        <div v-if="doc" style="padding:10px 14px;border-top:1px solid #e5e7eb;background:#f9fafb" class="row">
          <button class="btn warn" @click="runPreflight">内容校验 → 导出确认</button>
          <span class="muted" v-if="preflight">
            <span class="badge" :class="preflight.ok ? 'ok' : 'bad'">{{ preflight.ok ? '校验通过' : '存在阻断' }}</span>
            {{ preflight.errors.length }} 错误 / {{ preflight.warnings.length }} 警告
          </span>
        </div>
      </div>

      <PreviewStage :doc="doc" :capabilities="capabilities" :refresh-key="previewKey"></PreviewStage>
    </div>

    <ExportModal v-if="showExport" :doc-id="doc.id" :validation="preflight" @close="showExport = false"></ExportModal>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api, editorId } from './api.js';
import ModuleEditor from './components/ModuleEditor.vue';
import AssetsPanel from './components/AssetsPanel.vue';
import CoversPanel from './components/CoversPanel.vue';
import VersionPanel from './components/VersionPanel.vue';
import PreviewStage from './components/PreviewStage.vue';
import ExportModal from './components/ExportModal.vue';

const tabs = [
  { id: 'edit', label: '正文模块' },
  { id: 'cover', label: '封面/并发' },
  { id: 'assets', label: '素材授权' },
  { id: 'version', label: '版本/恢复' },
];
const tab = ref('edit');
const doc = ref(null);
const assets = ref([]);
const capabilities = ref(null);
const previewKey = ref(0);
const preflight = ref(null);
const showExport = ref(false);
const coverRef = ref(null);
const versionRef = ref(null);

async function newDoc() {
  doc.value = await api.createDocument('未命名图文 ' + new Date().toLocaleTimeString());
}
async function reloadDoc() {
  doc.value = await api.getDocument(doc.value.id);
  await loadAssets();
  previewKey.value++;
  coverRef.value?.refresh?.();
}
async function loadAssets() { assets.value = await api.listAssets(); }
function onSaved() {
  reloadDoc();
}
async function onRecovered(newDoc) {
  doc.value = newDoc;
  tab.value = 'edit';
  previewKey.value++;
}
async function runPreflight() {
  await reloadDoc();
  const r = await api.preflight(doc.value.id);
  // 展开到顶层便于弹窗使用
  preflight.value = { ...r.validation, docId: doc.value.id };
  showExport.value = true;
}

onMounted(async () => {
  capabilities.value = await api.capabilities();
  await loadAssets();
  await newDoc();
});
</script>
