<template>
  <div class="section">
    <h5>封面候选（含版本与并发保护）</h5>
    <p class="muted" style="font-size:11px;margin:0 0 8px">
      当前封面版本：<b>v{{ draft.cover?.version ?? 0 }}</b>
      <span v-if="conflict" class="danger-text"> · 检测到并发换封面冲突</span>
    </p>
    <div class="cover-grid">
      <div
        v-for="c in covers" :key="c.id"
        class="cover-opt"
        :class="{ sel: draft.cover?.coverId === c.id }"
        @click="choose(c)"
      >
        <span class="rev">库 v{{ c.version }}</span>
        <img :src="coverUrl(c.assetId)" alt="封面">
        <div class="cap">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ c.name }}</span>
          <span :class="assetStatus(c.assetId)==='authorized' ? 'st st-authorized' : 'st st-revoked'">
            {{ assetStatus(c.assetId) }}
          </span>
        </div>
      </div>
    </div>
    <div v-if="conflict" class="issue error" style="margin-top:8px">
      <span class="ico">⛔</span>
      <div>
        <div>{{ conflict }}</div>
        <button class="btn tiny" style="margin-top:6px" @click="$emit('reload')">重新拉取最新版本后再换</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const props = defineProps({
  draft: Object, covers: Array, assets: Array, actor: String,
});
const emit = defineEmits(['swapped', 'toast']);
const conflict = ref('');

function assetStatus(id) {
  return props.assets.find((a) => a.id === id)?.status || 'missing';
}
function coverUrl(id) {
  return `/api/assets/${id}/raw`;
}
async function choose(c) {
  conflict.value = '';
  if (props.draft.readonly) return emit('toast', { type: 'err', text: '只读副本不能换封面' });
  const expected = props.draft.cover?.version ?? 0;
  const r = await fetch(`/api/drafts/${props.draft.id}/cover`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ coverId: c.id, expectedVersion: expected, actor: props.actor }),
  });
  const b = await r.json();
  if (r.ok) {
    emit('swapped', b.cover);
    emit('toast', { type: 'ok', text: `封面已更新到 v${b.cover.version}` });
  } else if (r.status === 409) {
    conflict.value = b.message;
    emit('toast', { type: 'err', text: '并发冲突：封面刚被另一位编辑更新' });
  } else {
    emit('toast', { type: 'err', text: b.message || '换封面失败' });
  }
}
</script>
