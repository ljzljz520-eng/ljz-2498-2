<template>
  <div class="section">
    <h5>历史快照 · 旧草稿恢复 · 版本迁移</h5>

    <div v-if="draft.schemaVersion < 3" class="issue warning">
      <span class="ico">🧭</span>
      <div>
        当前草稿为 <b>schema v{{ draft.schemaVersion }}</b>，需要迁移到 v3 才能编辑。
        <div style="margin-top:6px"><button class="btn primary tiny" @click="$emit('migrate')">迁移为 v3 副本</button></div>
      </div>
    </div>

    <div v-if="!snapshots.length" class="muted" style="font-size:12px">暂无快照（每次保存自动创建，最多保留 20 条）</div>
    <div v-for="s in snapshots" :key="s.id" class="snap-item">
      <div><b>{{ s.label }}</b></div>
      <div class="muted">{{ fmt(s.savedAt) }} · {{ s.actor }} · v{{ s.schemaVersion }} · {{ s.tree.length }} 模块</div>
      <button class="btn tiny" style="margin-top:4px" @click="$emit('restore', s)">恢复为只读副本</button>
    </div>
  </div>
</template>

<script setup>
defineProps({ draft: Object, snapshots: { type: Array, default: () => [] } });
defineEmits(['migrate', 'restore']);
function fmt(t) { return new Date(t).toLocaleString('zh-CN'); }
</script>
