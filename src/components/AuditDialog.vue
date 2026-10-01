<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal">
      <h3>审计事件（最近 100 条）</h3>
      <div class="mc">
        <div v-if="!events.length" class="muted">暂无</div>
        <div v-for="e in events" :key="e.id" class="audit-item">
          <span class="at">{{ e.at.replace('T',' ').slice(0,19) }}</span>
          <span><b>{{ e.actor }}</b> · {{ e.action }} <span v-if="e.target">→ {{ e.target }}</span></span>
          <span :style="e.result==='ok' ? 'color:var(--ok)' : e.result==='refused' ? 'color:var(--err)' : 'color:var(--warn)'">· {{ e.result }}</span>
        </div>
      </div>
      <div class="mf"><button class="btn" @click="$emit('close')">关闭</button></div>
    </div>
  </div>
</template>

<script setup>
defineProps({ events: Array });
defineEmits(['close']);
</script>
