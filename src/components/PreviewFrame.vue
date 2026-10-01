<template>
  <div class="preview-wrap">
    <div class="device-toggle">
      <button class="btn" :class="{active: device==='phone'}" @click="$emit('update:device','phone')">手机 375px</button>
      <button class="btn" :class="{active: device==='desktop'}" @click="$emit('update:device','desktop')">桌面 ≥768px</button>
      <span class="pill" style="margin-left:6px">平台：微信公众号图文 · 预览断点（预览台自身能力，非平台规则）</span>
    </div>

    <div :class="device==='phone' ? 'frame-phone' : 'frame-desktop'">
      <div v-if="device==='phone'" class="statusbar">WeChat Reader · 375px</div>
      <div v-else class="browserbar"><i></i><i></i><i></i><span class="muted" style="font-size:11px;margin-left:6px">mp.weixin.qq.com · 桌面断点 ≥768px</span></div>
      <iframe
        title="受控正文预览"
        sandbox="allow-same-origin"
        :srcdoc="doc"
        @load="onLoad"
      ></iframe>
    </div>
    <p class="muted" style="font-size:11px;margin-top:10px;text-align:center;max-width:560px">
      预览为服务端清理版内容，与导出文件同源；不承诺与微信外部平台像素完全一致，最终以公众号后台真机预览为准。
    </p>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  bodyHtml: { type: String, default: '' },
  title: { type: String, default: '' },
  coverUrl: { type: String, default: '' },
  device: { type: String, default: 'phone' },
  residualScript: { type: Boolean, default: false },
});
defineEmits(['update:device']);

const doc = computed(() => {
  const cover = props.coverUrl
    ? `<div style="margin-bottom:16px"><img src="${props.coverUrl}" alt="cover" style="width:100%;display:block;border-radius:6px"></div>`
    : `<div style="margin-bottom:16px;height:120px;border:1px dashed #ccc;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:13px">未设置封面</div>`;
  const banner = props.residualScript
    ? '<div style="background:#fdecea;color:#7a1d17;padding:8px 12px;font-size:12px;border-radius:6px;margin-bottom:12px">⚠ 检测到未清理脚本入口，已阻止预览</div>'
    : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;color:#1f2329;}
  .mp{padding:18px 16px 40px;}
  @media (min-width:768px){ .mp{max-width:677px;margin:0 auto;padding:26px 20px 60px;} }
  h1{font-size:21px;line-height:1.4;margin:0 0 6px;}
  .meta{font-size:12px;color:#999;margin-bottom:16px;}
  img{max-width:100%;height:auto;}
  p{word-break:break-word;}
</style></head>
<body><div class="mp">${banner}${cover}<h1>${escapeHtml(props.title || '未命名图文')}</h1>
<div class="meta">图文预览 · 服务端清理版 · 非正式发布</div>
${props.bodyHtml}</div></body></html>`;
});

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function onLoad() { /* iframe 内不运行任何脚本：正文已在服务端清理，且 sandbox 未授予 allow-scripts */ }
</script>
