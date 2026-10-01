<template>
  <div class="section">
    <h5>结构化模块树 <span class="pill">schema v{{ draft.schemaVersion }}</span></h5>
    <p v-if="draft.readonly" class="issue error"><span class="ico">🔒</span>该草稿是旧版本恢复的只读副本，不可编辑。</p>

    <div v-for="(m, idx) in draft.tree" :key="m.id" class="module-card">
      <div class="mh">
        <span class="t">{{ idx + 1 }}. {{ typeLabel(m.type) }}</span>
        <span class="tag">{{ m.label }}</span>
        <span style="flex:1"></span>
        <button class="btn tiny" :disabled="draft.readonly || idx===0" @click="move(idx,-1)">↑</button>
        <button class="btn tiny" :disabled="draft.readonly || idx===draft.tree.length-1" @click="move(idx,1)">↓</button>
        <button class="btn tiny danger" :disabled="draft.readonly" @click="remove(idx)">删</button>
      </div>
      <div class="mb">
        <template v-if="m.type==='heading'">
          <div class="row">
            <select v-model="m.level" :disabled="draft.readonly">
              <option :value="1">H1</option><option :value="2">H2</option><option :value="3">H3</option>
            </select>
            <input v-model="m.text" :disabled="draft.readonly" placeholder="标题文本" style="flex:1">
          </div>
        </template>

        <template v-else-if="m.type==='image'">
          <select :value="m.assetId || ''" :disabled="draft.readonly" @change="pickAsset(m,$event)">
            <option value="">— 外部链接（需入库）—</option>
            <option v-for="a in assets" :key="a.id" :value="a.id">
              {{ a.sourceName || a.filename }} [{{ a.status }}{{ a.kind === 'cover' ? '/封面' : a.kind === 'icon' ? '/图标' : '' }}]
            </option>
          </select>
          <input v-model="m.src" :disabled="draft.readonly || !!m.assetId" placeholder="或外部图片 URL（http/https）" style="width:100%;margin-top:6px">
          <div class="row" style="margin-top:6px">
            <label class="row" style="gap:4px;font-size:12px">
              <input type="checkbox" v-model="m.darkIcon" :disabled="draft.readonly"> 深色小图标（需警惕深色背景）
            </label>
          </div>
        </template>

        <template v-else>
          <textarea v-model="m.html" :disabled="draft.readonly" :placeholder="'内联 HTML（保存时服务端再次清理）'"></textarea>
          <p v-if="m.type==='divider'" class="muted" style="margin:4px 0 0;font-size:11px">分隔线无内容</p>
        </template>
      </div>
    </div>

    <div class="row" style="margin-top:6px">
      <button class="btn" :disabled="draft.readonly" @click="add('heading')">+ 标题</button>
      <button class="btn" :disabled="draft.readonly" @click="add('text')">+ 正文</button>
      <button class="btn" :disabled="draft.readonly" @click="add('image')">+ 图片</button>
      <button class="btn" :disabled="draft.readonly" @click="add('quote')">+ 引用</button>
      <button class="btn" :disabled="draft.readonly" @click="add('divider')">+ 分隔线</button>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  draft: { type: Object, required: true },
  assets: { type: Array, default: () => [] },
});
const emit = defineEmits(['change', 'toast']);

const uid = () => 'm_' + Math.random().toString(36).slice(2, 9);
const typeLabel = (t) => ({ heading: '标题', text: '正文', image: '图片', quote: '引用', divider: '分隔线', html: 'HTML' }[t] || t);

const blank = {
  heading: () => ({ id: uid(), type: 'heading', label: '标题', align: '', level: 2, text: '新标题' }),
  text: () => ({ id: uid(), type: 'text', label: '正文', align: '', html: '<p>新段落</p>' }),
  image: () => ({ id: uid(), type: 'image', label: '图片', align: '', assetId: null, src: '', alt: '', width: null }),
  quote: () => ({ id: uid(), type: 'quote', label: '引用', align: '', html: '<p>引用内容</p>' }),
  divider: () => ({ id: uid(), type: 'divider', label: '分隔线', align: '' }),
  html: () => ({ id: uid(), type: 'html', label: 'HTML 模块', align: '', html: '<section>自定义模块</section>' }),
};
function add(type) {
  props.draft.tree.push(blank[type]());
  emit('change');
}
function move(i, d) {
  const t = props.draft.tree;
  const j = i + d;
  [t[i], t[j]] = [t[j], t[i]];
  emit('change');
}
function remove(i) {
  props.draft.tree.splice(i, 1);
  emit('change');
}
function pickAsset(m, e) {
  const id = e.target.value;
  m.assetId = id || null;
  if (id) {
    const a = props.assets.find((x) => x.id === id);
    if (a) {
      m.label = a.sourceName || a.filename;
      m.alt = a.sourceName || a.filename;
      m.width = a.width;
      if (a.kind === 'icon') m.darkIcon = !!a.dominantDark;
    }
  }
  emit('change');
}
</script>
