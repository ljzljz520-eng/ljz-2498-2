<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal">
      <h3>目标平台能力配置 · {{ caps.platform?.name }}</h3>
      <div class="mc">
        <div class="issue" style="background:#eef4ff;border-color:#c2d4ff;color:#1d4fd6">
          <span class="ico">🎯</span>
          <div>
            <b>这是「公众号图文正文」的能力配置，不是邮件客户端规则</b>：
            不包含 mso- 条件注释、表格布局 hack、VML 回退；能力版本 {{ caps.platform?.version }}。
          </div>
        </div>
        <p class="muted" style="font-size:12px">{{ caps.disclaimer }}</p>

        <h5 style="margin:10px 0 6px">平台说明</h5>
        <ul style="margin:0 0 8px 18px;font-size:12px;line-height:1.7">
          <li v-for="(n,i) in caps.platform?.notes" :key="i">{{ n }}</li>
        </ul>

        <h5 style="margin:10px 0 6px">较稳定支持的内联样式（{{ caps.supported?.length }}）</h5>
        <div class="cap-box">
          <code v-for="(p,i) in caps.supported" :key="i" style="display:inline-block;margin:2px">{{ p }}</code>
        </div>

        <h5 style="margin:10px 0 6px">部分支持 / 需提示差异</h5>
        <div class="cap-box">
          <div v-for="(msg, p) in caps.partial" :key="p" style="margin-bottom:6px">
            <code>{{ p }}</code> — <span class="muted">{{ msg }}</span>
          </div>
        </div>

        <h5 style="margin:10px 0 6px">标签承载</h5>
        <div class="cap-box" style="font-size:12px;line-height:1.8">
          <div>可保留：<span class="mono muted">{{ caps.tags?.allowed.join(', ') }}</span></div>
          <div style="margin-top:6px">直接移除：<span class="mono" style="color:var(--err)">{{ caps.tags?.drop.join(', ') }}</span></div>
        </div>
      </div>
      <div class="mf"><button class="btn primary" @click="$emit('close')">我知道了</button></div>
    </div>
  </div>
</template>

<script setup>
defineProps({ caps: Object });
defineEmits(['close']);
</script>
