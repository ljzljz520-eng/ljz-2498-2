<template>
  <div>
    <div class="disclaimer">
      两位编辑同时换封面：后提交者若基于过期版本会被服务端拒绝（乐观并发），
      且同一时刻仅一位编辑持有封面锁。当前编辑：<b>{{ editorId }}</b>
    </div>

    <h3 class="sec">当前封面</h3>
    <div v-if="currentCover" class="list-item">
      <strong>{{ currentCover.filename }}</strong>
      <div class="muted">{{ currentCover.mime_type }} · {{ (currentCover.bytes/1024/1024).toFixed(2) }}MB</div>
    </div>
    <div v-else class="muted">未设置封面</div>
    <div class="muted">文档当前版本：v{{ doc.currentVersion }}（换封面时作为 expectedVersion 提交）</div>

    <h3 class="sec">封面锁</h3>
    <div class="row">
      <button class="btn small" @click="lock">获取封面锁</button>
      <button class="btn small secondary" @click="unlock">释放</button>
      <span v-if="lockMsg" class="muted">{{ lockMsg }}</span>
    </div>
    <div v-if="lockError" class="issue error">{{ lockError }}</div>

    <h3 class="sec">添加封面候选</h3>
    <div class="field">
      <select v-model="selectedAsset">
        <option value="">— 选择封面素材 —</option>
        <option v-for="a in coverAssets" :key="a.id" :value="a.id">{{ a.filename }}</option>
      </select>
    </div>
    <button class="btn small" @click="addCandidate">加入候选</button>

    <h3 class="sec">候选版本池（选定 = 换封面）</h3>
    <div v-for="c in candidates" :key="c.id" class="list-item">
      <div class="row" style="justify-content:space-between">
        <span>{{ c.filename }} <span class="badge muted">{{ c.label || '候选' }}</span></span>
        <span :class="['badge', c.selected ? 'ok' : 'muted']">{{ c.selected ? '当前使用' : '候选' }}</span>
      </div>
      <div class="muted" :style="!c.authorized && 'color:#991b1b'">{{ c.authorized ? '已授权' : '授权已撤回：' + c.auth_note }}</div>
      <button class="btn small" style="margin-top:6px" :disabled="c.selected" @click="choose(c)">选定为封面</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { api, editorId } from '../api.js';

const props = defineProps({ doc: Object, assets: Array });
const emit = defineEmits(['changed']);
const selectedAsset = ref('');
const candidates = ref([]);
const lockMsg = ref('');
const lockError = ref('');

const coverAssets = computed(() => props.assets.filter((a) => a.kind === 'cover'));
const currentCover = computed(() => props.assets.find((a) => a.id === props.doc.coverId));

async function refresh() { candidates.value = await api.coverCandidates(props.doc.id); }
refresh();

async function lock() {
  lockError.value = '';
  try {
    const r = await api.coverLock(props.doc.id);
    lockMsg.value = `已获取锁（${r.acquiredAt}）`;
  } catch (e) {
    lockError.value = e.message + (e.details?.heldBy ? `，持有者：${e.details.heldBy}` : '');
    lockMsg.value = '';
  }
}
async function unlock() {
  await api.coverUnlock(props.doc.id);
  lockMsg.value = '已释放';
}
async function addCandidate() {
  if (!selectedAsset.value) return;
  await api.addCoverCandidate(props.doc.id, selectedAsset.value, '候选 ' + new Date().toLocaleTimeString());
  selectedAsset.value = '';
  await refresh();
}
async function choose(c) {
  lockError.value = '';
  try {
    // expectedVersion 必须是最新读到的版本；另一编辑若已保存/换封面，这里会 409
    const latest = await api.getDocument(props.doc.id);
    await api.selectCover(props.doc.id, c.asset_id, latest.currentVersion, c.id);
    lockMsg.value = '封面已更新';
    emit('changed');
  } catch (e) {
    lockError.value = e.status === 409
      ? `换封面冲突：${e.message}` + (e.details?.heldBy ? `（锁持有者 ${e.details.heldBy}）` : '')
      : e.message;
  }
}
defineExpose({ refresh });
</script>
