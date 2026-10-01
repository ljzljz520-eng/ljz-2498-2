<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal">
      <h2 style="margin-top:0;font-size:17px">导出确认</h2>

      <template v-if="!result">
        <div class="disclaimer" style="margin-bottom:10px">
          所有校验规则已执行完成。仅当无阻断问题（error）时才可确认导出；
          警告项需逐一勾选知悉。系统只生成受控 HTML 与双断点预览图，<b>不会替你向公众号账号发布</b>。
        </div>

        <h3 class="sec">阻断问题（{{ validation.errors.length }}）</h3>
        <div v-for="(e,i) in validation.errors" :key="'e'+i" class="issue error">
          [{{ e.code }}] {{ e.message }}
        </div>
        <div v-if="!validation.errors.length" class="issue" style="background:#f0fdf4;border:1px solid #bbf7d0;color:#166534">
          无阻断问题，校验完成，可进入导出。
        </div>

        <h3 class="sec">差异与警告（{{ validation.warnings.length }}）—— 需逐项知悉</h3>
        <label v-for="(w,i) in validation.warnings" :key="'w'+i" class="issue warning" style="display:block">
          <input type="checkbox" :checked="acks.has(i)" @change="toggle(i)" style="margin-right:6px">
          [{{ w.code }}] {{ w.message }}
        </label>
        <div v-if="!validation.warnings.length" class="muted">无警告项</div>

        <h3 class="sec">提示信息（{{ validation.infos.length }}）</h3>
        <div v-for="(x,i) in validation.infos" :key="'i'+i" class="issue info">[{{ x.code }}] {{ x.message }}</div>

        <div class="disclaimer" style="margin-top:10px">{{ validation.disclaimer }}</div>
        <div class="muted">已执行检查：{{ validation.checks.join('、') }}</div>

        <div class="row" style="margin-top:14px;justify-content:flex-end">
          <button class="btn secondary" @click="$emit('close')">取消</button>
          <button class="btn" :disabled="!validation.ok || acks.size !== validation.warnings.length" @click="confirm">
            确认导出（仅本地生成受控 HTML 与预览图）
          </button>
        </div>
      </template>

      <template v-else>
        <div class="issue" style="background:#f0fdf4;border:1px solid #bbf7d0;color:#166534">
          导出任务 {{ result.jobId }} 已生成（状态：{{ result.status }}）。
        </div>
        <div class="muted">手机渲染：{{ result.renderers.phone }} ｜ 桌面渲染：{{ result.renderers.desktop }}</div>
        <div class="badge bad" style="margin:8px 0">publishedExternally = false —— 未向任何外部账号发布</div>
        <button class="btn small secondary" @click="loadImages">查看受控 HTML 与预览图</button>

        <div v-if="jobDetail">
          <h3 class="sec">正式受控 HTML 脚本扫描</h3>
          <pre class="diff-report" style="max-height:80px">{{ scriptCheck }}</pre>
          <h3 class="sec">手机预览图（375 宽）</h3>
          <img class="thumb" :src="'data:image/svg+xml;base64,'+jobDetail.phonePngBase64" v-if="jobDetail.renderer.phone.includes('svg')">
          <img class="thumb" :src="'data:image/png;base64,'+jobDetail.phonePngBase64" v-else>
          <h3 class="sec">桌面预览图（1080 宽）</h3>
          <img class="thumb" :src="'data:image/svg+xml;base64,'+jobDetail.desktopPngBase64" v-if="jobDetail.renderer.desktop.includes('svg')">
          <img class="thumb" :src="'data:image/png;base64,'+jobDetail.desktopPngBase64" v-else>
        </div>
        <div class="row" style="margin-top:14px;justify-content:flex-end">
          <button class="btn" @click="$emit('close')">完成</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { api } from '../api.js';

const props = defineProps({ docId: String, validation: Object });
defineEmits(['close']);
const acks = ref(new Set());
const result = ref(null);
const jobDetail = ref(null);

function toggle(i) {
  const s = new Set(acks.value);
  s.has(i) ? s.delete(i) : s.add(i);
  acks.value = s;
}
async function confirm() {
  // warningAck 传代码集合，服务端校验数量与 warnings 一致
  result.value = await api.doExport(props.docId,
    [...acks.value].map((i) => props.validation.warnings[i]?.code || String(i)));
}
async function loadImages() {
  jobDetail.value = await api.getExport(result.value.jobId);
}
const scriptCheck = computed(() => {
  if (!jobDetail.value) return '';
  const html = jobDetail.value.controlledHtml;
  const findings = [];
  if (/<script[\s>]/i.test(html)) findings.push('<script>');
  if (/\son[a-z]+\s*=/i.test(html)) findings.push('on*=');
  if (/javascript:/i.test(html)) findings.push('javascript:');
  return findings.length ? '发现脚本残留：' + findings.join(', ') : '脚本扫描通过：无 <script>、无 on*=、无 javascript: 协议';
});
</script>
