<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal">
      <h3>导出确认 · 受控 HTML 与预览图</h3>
      <div class="mc">
        <div v-if="!result">
          <div class="issue warning" style="margin-bottom:10px">
            <span class="ico">ℹ️</span>
            <span>系统只在本地生成受控文件，<b>不会替你向微信公众号或任何外部账号发布</b>。</span>
          </div>
          <table class="kvs">
            <tr><td>草稿</td><td>{{ draft.title }}</td></tr>
            <tr><td>模块数量</td><td>{{ draft.tree.length }}</td></tr>
            <tr><td>封面版本</td><td>v{{ draft.cover?.version ?? 0 }}</td></tr>
            <tr><td>schema</td><td>v{{ draft.schemaVersion }}</td></tr>
            <tr><td>脚本入口</td><td><span class="st st-authorized">已服务端清理（防御扫描通过）</span></td></tr>
            <tr><td>校验结果</td><td><span class="st st-authorized">通过</span>（以导出时服务端再次校验为准）</td></tr>
          </table>
          <p class="muted" style="font-size:11px;margin-top:10px">
            导出文件与当前浏览器预览使用同一份清理版模块树渲染；若导出瞬间资源授权变化或封面被改，服务端会再次拦截。
          </p>
        </div>

        <div v-else>
          <div class="issue" style="background:#eaf7f0;border-color:#9bd9b2;color:#1a7f37">
            <span class="ico">✅</span><span>导出成功（本地受控文件，未发布到外部账号）</span>
          </div>
          <table class="kvs">
            <tr><td>HTML 文件</td><td><a :href="result.export.htmlUrl" target="_blank">{{ result.export.htmlName }}</a>（{{ result.export.htmlSize }} 字节）</td></tr>
            <tr><td>预览图</td><td><a :href="result.export.previewUrl" target="_blank">手机断点 375×667 SVG</a></td></tr>
            <tr><td>导出时间</td><td>{{ result.export.exportedAt }}</td></tr>
            <tr><td>外部发布</td><td>{{ result.export.externalPublishing ? '是' : '否（本系统不发布）' }}</td></tr>
          </table>
        </div>

        <div v-if="refused" class="issue error" style="margin-top:10px">
          <span class="ico">⛔</span>
          <div>
            <b>导出被服务端拒绝：</b>{{ refused.message }}
            <div style="margin-top:6px">
              <span v-for="(it,i) in refused.validation.issues.filter(x=>x.level==='error')" :key="i" style="display:block">· {{ it.message }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="mf">
        <button class="btn" @click="$emit('close')">{{ result || refused ? '关闭' : '取消' }}</button>
        <button v-if="!result" class="btn primary" :disabled="working" @click="$emit('confirm')">{{ working ? '服务端复核中…' : '确认导出（仅本地）' }}</button>
        <a v-else class="btn primary" :href="result.export.htmlUrl" target="_blank">打开受控 HTML</a>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({ draft: Object, result: Object, refused: Object, working: Boolean });
defineEmits(['close', 'confirm']);
</script>
