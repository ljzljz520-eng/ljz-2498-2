<template>
  <div class="section">
    <h5>③ 导出前校验（全部通过才可导出）</h5>
    <button class="btn primary" style="width:100%" :disabled="loading || !draft" @click="run">
      {{ loading ? '校验中…' : '运行内容校验' }}
    </button>

    <div v-if="result" style="margin-top:10px">
      <div :class="'issue ' + (result.ok ? 'warning' : 'error')">
        <span class="ico">{{ result.ok ? '✅' : '⛔' }}</span>
        <span>
          <b v-if="result.ok">校验通过（{{ result.warningCount }} 条提示不阻断）</b>
          <b v-else>校验未通过：{{ result.errorCount }} 个错误必须处理</b>
        </span>
      </div>
      <div v-for="(it,i) in result.issues" :key="i" :class="'issue ' + it.level">
        <span class="ico">{{ it.level === 'error' ? '⛔' : '⚠' }}</span>
        <div>
          <div>{{ it.message }}</div>
          <div class="mono muted" style="font-size:10px;margin-top:2px">{{ it.code }}<span v-if="it.assetId"> · {{ it.assetId }}</span></div>
        </div>
      </div>
      <p class="muted" style="font-size:11px;margin-top:6px">{{ result.notice }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { api } from '../api.js';
const props = defineProps({ draftId: String });
defineEmits(['validated']);
const loading = ref(false);
const result = ref(null);

async function run() {
  loading.value = true;
  try {
    const r = await api.validate(props.draftId);
    if (r.ok) {
      result.value = r.body;
      emit('validated', r.body);
    } else {
      result.value = r.body;
      emit('validated', r.body);
    }
  } finally {
    loading.value = false;
  }
}
defineExpose({ run });
</script>
