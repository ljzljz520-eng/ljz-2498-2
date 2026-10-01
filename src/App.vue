<template>
  <div class="app">
    <header class="topbar">
      <span class="brand"><span class="dot">●</span> 公众号图文预览台</span>
      <span class="pill" style="background:rgba(255,255,255,.12);color:#eee">平台：微信公众号图文</span>
      <button class="btn tiny" @click="showCaps = true">平台能力配置</button>
      <span class="spacer"></span>
      <label class="actor">当前编辑
        <select v-model="actor" @change="toast({type:'info',text:`已切换为 ${actor}`})">
          <option>editor-a</option>
          <option>editor-b</option>
          <option>admin</option>
        </select>
      </label>
      <button class="btn tiny" @click="openAudit">审计</button>
    </header>

    <div class="disclaimer">
      <span>⚠️</span>
      <span><b>能力边界：</b>预览台面向公众号图文正文（非邮件客户端规则）；样式差异会明确提示；预览<b>不承诺与外部平台像素完全一致</b>，不替用户向外部账号发布；正式预览/导出仅使用服务端清理版内容。</span>
    </div>

    <div class="main">
      <!-- 左列：草稿列表 + 粘贴 + 模块树 + 快照 -->
      <div class="col">
        <div class="col-head">
          草稿与模块
          <span style="flex:1"></span>
          <button class="btn tiny" :disabled="!draft || draft.readonly" @click="save(false)">保存（建快照）</button>
        </div>
        <div class="col-body">
          <div class="section">
            <div v-for="d in drafts" :key="d.id" class="draft-item" :class="{active: draft?.id===d.id}" @click="selectDraft(d.id)">
              <h4>{{ d.title }}</h4>
              <div class="meta">
                <span class="badge" :class="d.schemaVersion===3?'v3':'v1'">schema v{{ d.schemaVersion }}</span>
                <span v-if="d.status==='restored-readonly'" class="badge readonly">只读恢复</span>
                <span v-else-if="d.status==='legacy'" class="badge v1">待迁移</span>
                <span>{{ d.updatedBy }} · {{ d.updatedAt?.slice(0,10) }}</span>
              </div>
            </div>
          </div>

          <PastePanel v-if="draft" :actor="actor" @ingested="onIngested" @toast="toast" />

          <ModuleTree v-if="draft" :draft="draft" :assets="assets" @change="scheduleRender" @toast="toast" />

          <SnapshotPanel
            v-if="draft"
            :draft="draft"
            :snapshots="draft.snapshots || []"
            @migrate="doMigrate"
            @restore="doRestore"
          />
        </div>
      </div>

      <!-- 中列：预览 -->
      <div class="col" style="background:#dfe2e7">
        <div class="col-head" style="background:#fff">
          受控预览（手机/桌面断点）
          <span style="flex:1"></span>
          <button class="btn tiny" @click="genPreviewImage" :disabled="!draft">后台生成预览图</button>
          <button class="btn tiny primary" :disabled="!canExport" @click="exportOpen">导出确认…</button>
        </div>
        <PreviewFrame
          v-model:device="device"
          :body-html="bodyHtml"
          :title="draft?.title || ''"
          :cover-url="draftCoverUrl"
          :residual-script="residualScript"
        />
      </div>

      <!-- 右列：封面 + 校验 + 资源 -->
      <div class="col right">
        <div class="col-head">封面 / 校验 / 资源</div>
        <div class="col-body">
          <CoverPanel
            v-if="draft"
            :draft="draft"
            :covers="covers"
            :assets="assets"
            :actor="actor"
            @swapped="onCoverSwapped"
            @reload="reloadCurrent"
            @toast="toast"
          />
          <div v-if="draft" class="section">
            <button class="btn tiny" @click="simulateConcurrentSwap">🧪 模拟另一编辑并发换封面</button>
          </div>
          <IssuePanel
            v-if="draft"
            ref="issueRef"
            :draft-id="draft.id"
            @validated="onValidated"
          />
          <AssetPanel ref="assetRef" :actor="actor" @changed="onAssetsChanged" @toast="toast" />
        </div>
      </div>
    </div>

    <transition><div v-if="toastMsg" class="toast" :class="toastMsg.type">{{ toastMsg.text }}</div></transition>

    <ExportDialog
      v-if="exporting"
      :draft="draft"
      :result="exportResult"
      :refused="exportRefused"
      :working="exportWorking"
      @close="exporting=false"
      @confirm="doExport"
    />
    <CapabilityDialog v-if="showCaps" :caps="caps" @close="showCaps=false" />
    <AuditDialog v-if="showAudit" :events="auditEvents" @close="showAudit=false" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from './api.js';
import PreviewFrame from './components/PreviewFrame.vue';
import PastePanel from './components/PastePanel.vue';
import ModuleTree from './components/ModuleTree.vue';
import IssuePanel from './components/IssuePanel.vue';
import CoverPanel from './components/CoverPanel.vue';
import AssetPanel from './components/AssetPanel.vue';
import SnapshotPanel from './components/SnapshotPanel.vue';
import ExportDialog from './components/ExportDialog.vue';
import CapabilityDialog from './components/CapabilityDialog.vue';
import AuditDialog from './components/AuditDialog.vue';

const actor = ref('editor-a');
const drafts = ref([]);
const draft = ref(null);
const covers = ref([]);
const assets = ref([]);
const caps = ref({});
const device = ref('phone');
const bodyHtml = ref('');
const residualScript = ref(false);
const validation = ref(null);
const issueRef = ref(null);
const assetRef = ref(null);

const exporting = ref(false);
const exportResult = ref(null);
const exportRefused = ref(null);
const exportWorking = ref(false);
const showCaps = ref(false);
const showAudit = ref(false);
const auditEvents = ref([]);
const toastMsg = ref(null);
let toastTimer = null;
let renderTimer = null;

const canExport = computed(() => !!validation.value?.ok);
const draftCoverUrl = computed(() => draft.value?.cover?.assetId ? `/api/assets/${draft.value.cover.assetId}/raw` : '');

function toast(t) {
  toastMsg.value = t;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastMsg.value = null), 3200);
}

async function loadDrafts() {
  const r = await api.drafts();
  if (r.ok) drafts.value = r.body;
}
async function loadCovers() {
  const r = await api.covers();
  if (r.ok) covers.value = r.body;
}
async function loadAssets() {
  const r = await api.assets();
  if (r.ok) assets.value = r.body;
}
async function loadCaps() {
  const r = await api.capabilities();
  if (r.ok) caps.value = r.body;
}

async function selectDraft(id) {
  const r = await api.draft(id);
  if (!r.ok) return toast({ type: 'err', text: '加载草稿失败' });
  draft.value = r.body;
  validation.value = null;
  scheduleRender();
}
async function reloadCurrent() {
  if (draft.value) await selectDraft(draft.value.id);
  await loadCovers();
  await loadAssets();
}

// 预览：始终把当前工作树交给服务端渲染（浏览器不自行清理），与导出同源
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderNow, 350);
}
async function renderNow() {
  if (!draft.value) return;
  if (draft.value.schemaVersion < 3) {
    bodyHtml.value = '<p style="color:#b26a00">旧版本草稿，请先迁移到 v3 后预览。</p>';
    return;
  }
  const r2 = await fetch(`/api/drafts/${draft.value.id}/render`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ draft: { tree: draft.value.tree } }),
  }).then((x) => x.json());
  bodyHtml.value = r2.body;
  residualScript.value = r2.residualScript;
}

function onIngested(result) {
  draft.value.tree.push(...result.modules.map((m) => ({ ...m })));
  // 粘贴带来的差异提示并入草稿
  const exist = draft.value.capabilityDiffs || [];
  for (const d of result.capabilities.diffs) {
    if (!exist.some((x) => x.kind === d.kind && x.message === d.message)) exist.push(d);
  }
  draft.value.capabilityDiffs = exist;
  validation.value = null;
  scheduleRender();
  toast({ type: 'ok', text: `已追加 ${result.modules.length} 个清理后的模块（危险内容已在服务端拦截）` });
}

async function save(reload = true) {
  const r = await api.saveDraft(draft.value.id, {
    title: draft.value.title,
    tree: draft.value.tree,
    cover: draft.value.cover,
    capabilityDiffs: draft.value.capabilityDiffs,
  }, actor.value);
  if (!r.ok) return toast({ type: 'err', text: r.body?.message || '保存失败' });
  draft.value = r.body.draft;
  validation.value = null;
  await loadDrafts();
  toast({ type: 'ok', text: `已保存并生成快照 ${r.body.snapshot.label}` });
  scheduleRender();
}

async function doMigrate() {
  const r = await api.migrate(draft.value.id, actor.value);
  if (!r.ok) return toast({ type: 'err', text: '迁移失败' });
  toast({ type: 'ok', text: `已生成 v3 迁移副本（${r.body.migrationSteps.length} 步）` });
  await loadDrafts();
  await selectDraft(r.body.id);
}

async function doRestore(snap) {
  const r = await api.restore(draft.value.id, snap.id, actor.value);
  if (!r.ok) return toast({ type: 'err', text: '恢复失败' });
  toast({ type: 'ok', text: '已恢复为只读副本' });
  await loadDrafts();
  await selectDraft(r.body.id);
}

function onCoverSwapped(cover) {
  draft.value.cover = cover;
  validation.value = null;
  loadCovers();
}

async function simulateConcurrentSwap() {
  // 用另一个编辑身份、以最新版本成功换封面，制造当前编辑本地版本过期
  const other = actor.value === 'editor-a' ? 'editor-b' : 'editor-a';
  const cur = draft.value.cover;
  const candidate = covers.value.find((c) => c.id !== cur?.coverId) || covers.value[0];
  const expected = cur?.version ?? 0;
  const assetOk = (id) => {
    const a = assets.value.find((x) => x.id === id);
    return a && a.status === 'authorized';
  };
  // 若当前选中的候选资源未授权，换一个已授权的封面，再退而求其次
  let target = assetOk(candidate.assetId)
    ? candidate
    : covers.value.find((c) => assetOk(c.assetId));
  if (!target) {
    toast({ type: 'err', text: '没有已授权的封面候选，无法模拟并发换封面' });
    return;
  }
  const r = await fetch(`/api/drafts/${draft.value.id}/cover`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ coverId: target.id, expectedVersion: expected, actor: other }),
  });
  if (r.ok) {
    toast({ type: 'info', text: `${other} 已抢先换封面（v${expected + 1}）；你现在换会触发 409 冲突` });
    await loadCovers();
    // 故意不刷新当前 draft，模拟“你仍基于旧版本编辑”
  } else {
    const b = await r.json();
    toast({ type: 'err', text: '模拟冲突：' + b.message });
  }
}

async function onAssetsChanged() {
  await loadAssets();
  validation.value = null;
  scheduleRender();
}

function onValidated(v) {
  validation.value = v;
}

function exportOpen() {
  exportResult.value = null;
  exportRefused.value = null;
  exporting.value = true;
}
async function doExport() {
  exportWorking.value = true;
  try {
    const r = await api.exportDraft(draft.value.id, actor.value);
    if (r.ok) exportResult.value = r.body;
    else exportRefused.value = r.body;
  } finally {
    exportWorking.value = false;
  }
}
async function genPreviewImage() {
  const r = await api.previewImage(draft.value.id, actor.value);
  if (r.ok) {
    window.open(r.body.previewUrl, '_blank');
    toast({ type: 'ok', text: '后台已生成 375px 手机断点预览图' });
  }
}

async function openAudit() {
  const r = await api.audit();
  if (r.ok) { auditEvents.value = r.body; showAudit.value = true; }
}

onMounted(async () => {
  await Promise.all([loadDrafts(), loadCovers(), loadAssets(), loadCaps()]);
  if (drafts.value.length) await selectDraft(drafts.value[0].id);
});
</script>
