<template>
  <div>
    <div class="field">
      <label>图文标题</label>
      <input type="text" v-model="doc.title" placeholder="标题" @change="save">
    </div>

    <h3 class="sec">结构化模块树（正文以模块存储，非任意 HTML）</h3>

    <div v-for="(m, idx) in doc.modules" :key="m.id" class="module-card">
      <div class="mod-head">
        <span class="mod-type">#{{ idx + 1 }} {{ typeLabel(m.type) }}</span>
        <span class="row">
          <button class="btn small secondary" @click="move(idx, -1)" :disabled="idx===0">上移</button>
          <button class="btn small secondary" @click="move(idx, 1)" :disabled="idx===doc.modules.length-1">下移</button>
          <button class="btn small danger" @click="remove(idx)">删除</button>
        </span>
      </div>

      <template v-if="m.type==='heading'">
        <div class="field"><label>级别</label>
          <select v-model.number="m.props.level" @change="save"><option :value="1">H1</option><option :value="2">H2</option><option :value="3">H3</option><option :value="4">H4</option></select></div>
        <div class="field"><label>文字</label><input type="text" v-model="m.props.text" @change="save"></div>
      </template>

      <template v-else-if="m.type==='paragraph' || m.type==='quote'">
        <div class="field"><textarea v-model="m.props.text" @change="save"></textarea></div>
      </template>

      <template v-else-if="m.type==='list'">
        <div class="field"><label><input type="checkbox" v-model="m.props.ordered" @change="save"> 有序列表</label></div>
        <div class="field" v-for="(_,i) in m.props.items" :key="i">
          <input type="text" v-model="m.props.items[i]" @change="save">
        </div>
        <button class="btn small secondary" @click="m.props.items.push(''); save()">+ 列表项</button>
      </template>

      <template v-else-if="m.type==='image'">
        <div class="field"><label>引用素材（assetId）</label>
          <select v-model="m.props.assetId" @change="save">
            <option value="">— 请选择 —</option>
            <option v-for="a in imageAssets" :key="a.id" :value="a.id">{{ a.filename }}（{{ a.kind }}）</option>
          </select></div>
        <div class="field" v-if="isIcon(m.props.assetId)">
          <label>所在区块背景色（用于暗色图标可见性校验）</label>
          <input type="text" v-model="m.props.containerBg" placeholder="#111111 或 rgb(20,20,20)" @change="save">
        </div>
      </template>

      <template v-else-if="m.type==='html-block'">
        <div class="field">
          <label>富文本内容（已由服务端清理，浏览器预览与导出共用此版本）</label>
          <div v-html="m.props.html" style="border:1px dashed #d1d5db;padding:8px;border-radius:6px;min-height:40px;font-size:13px"></div>
          <div class="muted" v-if="m.props.sanitizedAt">上次清理：{{ m.props.sanitizedAt }}</div>
        </div>
        <details>
          <summary class="muted">查看清理后 HTML</summary>
          <pre class="diff-report">{{ m.props.html }}</pre>
        </details>
      </template>

      <template v-else-if="m.type==='divider'"><div class="muted">分割线</div></template>
    </div>

    <div class="row" style="margin: 8px 0 14px;">
      <select v-model="newType">
        <option value="heading">标题</option>
        <option value="paragraph">段落</option>
        <option value="quote">引用</option>
        <option value="list">列表</option>
        <option value="image">图片（素材引用）</option>
        <option value="divider">分割线</option>
        <option value="html-block">富文本（粘贴，经服务端清理）</option>
      </select>
      <button class="btn small" @click="addModule">添加模块</button>
    </div>

    <h3 class="sec">粘贴外部内容 → 服务端清理 → 成为 html-block 模块</h3>
    <div class="field">
      <textarea v-model="pasteHtml" placeholder='粘贴任意外部 HTML，例如：<p style="position:fixed">x</p><a href="javascript:alert(1)">点我</a><script>steal()</script>'></textarea>
    </div>
    <button class="btn" @click="pasteAndClean">提交服务端清理并插入</button>

    <div v-if="pasteReport" style="margin-top:10px">
      <div class="issue error" v-if="pasteReport.hadScript">检测到脚本内容（&lt;script&gt;/事件属性/危险协议），已移除，不会进入正式预览与导出。</div>
      <div v-for="(s,i) in pasteReport.unsupportedStyles" :key="'s'+i" class="issue warning">{{ s.reason }}（标签 {{ s.tag }} / {{ s.prop }}）</div>
      <div v-for="(t,i) in pasteReport.removedTags" :key="'t'+i" class="issue info">{{ t.reason }}（&lt;{{ t.tag }}&gt;）</div>
      <div v-for="(l,i) in pasteReport.blockedLinks" :key="'l'+i" class="issue error">{{ l.reason }}：{{ l.href }}</div>
      <div v-for="(a,i) in pasteReport.removedAttrs" :key="'a'+i" class="issue info">{{ a.tag }} 上属性 {{ a.attr }} 被移除：{{ a.reason }}</div>
      <div v-if="!pasteReport.unsupportedStyles.length && !pasteReport.removedTags.length && !pasteReport.blockedLinks.length && !pasteReport.hadScript && !pasteReport.removedAttrs.length"
           class="issue info">清理完成，无差异项。</div>
    </div>

    <div style="margin-top:14px" class="row">
      <button class="btn" @click="save">保存模块树（生成候选版本）</button>
      <span v-if="lastSaved" class="muted">已保存 v{{ lastSaved.version }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { api } from '../api.js';

const props = defineProps({ doc: Object, assets: Array, saved: Function });
const emit = defineEmits(['saved']);
const newType = ref('paragraph');
const pasteHtml = ref('');
const pasteReport = ref(null);
const lastSaved = ref(null);

const imageAssets = computed(() => props.assets.filter((a) => ['image', 'cover', 'icon'].includes(a.kind)));
const isIcon = (id) => props.assets.find((a) => a.id === id)?.kind === 'icon';

const typeLabel = (t) => ({
  heading: '标题', paragraph: '段落', quote: '引用', list: '列表', image: '图片',
  divider: '分割', 'html-block': '富文本(已清理)', video: '视频',
}[t] || t);

function defaultProps(type) {
  return ({
    heading: { text: '新标题', level: 2, align: 'left' },
    paragraph: { text: '新段落' },
    quote: { text: '引用内容' },
    list: { ordered: false, items: ['列表项'] },
    image: { assetId: '', containerBg: '' },
    divider: {},
    'html-block': { html: '' },
  })[type];
}

function addModule() {
  props.doc.modules.push({ id: 'mod_' + Math.random().toString(36).slice(2, 12), type: newType.value, props: defaultProps(newType.value), schemaVersion: 2 });
}
function remove(i) { props.doc.modules.splice(i, 1); }
function move(i, d) {
  const arr = props.doc.modules;
  const j = i + d;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

async function pasteAndClean() {
  if (!pasteHtml.value.trim()) return;
  const { clean, report } = await api.sanitize(pasteHtml.value); // 只信任服务端结果
  props.doc.modules.push({
    id: 'mod_' + Math.random().toString(36).slice(2, 12),
    type: 'html-block',
    props: { html: clean, source: 'paste', sanitizedAt: new Date().toISOString() },
    schemaVersion: 2,
  });
  pasteReport.value = report;
  pasteHtml.value = '';
  await save();
}

async function save() {
  const result = await api.saveDocument(props.doc.id, {
    title: props.doc.title,
    schemaVersion: props.doc.schemaVersion,
    coverId: props.doc.coverId,
    modules: props.doc.modules,
  });
  lastSaved.value = { version: result.version };
  pasteReport.value = mergeReports(result.sanitizeReports);
  emit('saved', result);
}
defineExpose({ save });

function mergeReports(reports) {
  if (!reports || !reports.length) return pasteReport.value;
  return {
    hadScript: reports.some((r) => r.hadScript),
    unsupportedStyles: reports.flatMap((r) => r.unsupportedStyles),
    removedTags: reports.flatMap((r) => r.removedTags),
    blockedLinks: reports.flatMap((r) => r.blockedLinks),
    removedAttrs: reports.flatMap((r) => r.removedAttrs),
  };
}
</script>
