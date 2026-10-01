/**
 * 结构化模块树
 *  - 保存的是“模块树 + 服务端清理版正文”，而不是任意 HTML。
 *  - schemaVersion 支持版本迁移；旧草稿可从快照恢复（只读复刻 + 版本标记）。
 *
 * 版本史：
 *  v1: { type:'block', kind, html, cover?:{url}, meta:{title} }
 *  v2: 类型收窄为 heading/text/image/html/quote/divider；封面升级为 {assetId,url}
 *  v3: 封面与正文分离（draft.cover）；统一 block.type；新增模块 label
 */
import { sanitize, hasResidualScriptRisk } from './sanitizer.js';

export const CURRENT_SCHEMA = 3;

export const BLOCK_TYPES = ['heading', 'text', 'image', 'quote', 'divider', 'html'];

const uid = () => 'm_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

/** v1 -> v2 */
function migrateV1toV2(tree) {
  const map = { header: 'heading', paragraph: 'text', picture: 'image', raw: 'html' };
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out = { ...node };
      if (out.type === 'block' && out.kind) {
        out.type = map[out.kind] || (BLOCK_TYPES.includes(out.kind) ? out.kind : 'html');
        delete out.kind;
      }
      if (out.cover && typeof out.cover === 'string') {
        out.cover = { assetId: null, url: out.cover, version: 0 };
      }
      for (const k of Object.keys(out)) {
        if (typeof out[k] === 'object') out[k] = walk(out[k]);
      }
      return out;
    }
    return node;
  };
  return walk(tree);
}

/** v2 -> v3：封面提到 draft 级；块字段统一 */
function migrateV2toV3(tree) {
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out = { ...node };
      if (out.cover) {
        out._extractedCover = out.cover; // 由调用方取出
        delete out.cover;
      }
      for (const k of Object.keys(out)) {
        if (typeof out[k] === 'object' && k !== '_extractedCover') out[k] = walk(out[k]);
      }
      if (!out.label && (out.text || out.html)) {
        const src = out.text || out.html || '';
        out.label = src.replace(/<[^>]+>/g, '').slice(0, 12);
      }
      return out;
    }
    return node;
  };
  return walk(tree);
}

/**
 * 迁移模块树到当前版本。
 * @returns {{tree:Array, version:number, steps:Array, extractedCover:object|null}}
 */
export function migrateTree(tree, fromVersion) {
  let version = Number(fromVersion) || 1;
  const steps = [];
  let work = JSON.parse(JSON.stringify(tree || []));

  if (version < 2) {
    work = migrateV1toV2(work);
    steps.push({ from: version, to: 2, at: new Date().toISOString(), note: '类型收窄（header/picture/raw → heading/image/html），封面结构化' });
    version = 2;
  }
  if (version < 3) {
    work = migrateV2toV3(work);
    steps.push({ from: version, to: 3, at: new Date().toISOString(), note: '封面与正文分离，模块增加 label' });
    version = 3;
  }

  let extractedCover = null;
  const findCover = (nodes) => {
    for (const n of nodes) {
      if (Array.isArray(n)) { findCover(n); continue; }
      if (n && typeof n === 'object') {
        if (n._extractedCover && !extractedCover) extractedCover = n._extractedCover;
        delete n._extractedCover;
        for (const k of Object.keys(n)) if (typeof n[k] === 'object') findCover([n[k]]);
      }
    }
  };
  findCover(work);

  return { tree: work, version, steps, extractedCover };
}

/**
 * 归一化外部提交的模块树到 v3：保证 id/type 合法、html 模块内容已清理。
 * 若整树带 schemaVersion<3，先走迁移。
 */
export function normalizeTree(input, opts = {}) {
  const sourceVersion = input?.schemaVersion || input?.version || opts.assumeVersion || CURRENT_SCHEMA;
  let nodes = input?.tree ?? input?.modules ?? input;
  const migration = { steps: [], migrated: false };

  if (sourceVersion < CURRENT_SCHEMA) {
    const r = migrateTree(nodes, sourceVersion);
    nodes = r.tree;
    migration.steps = r.steps;
    migration.migrated = true;
    migration.extractedCover = r.extractedCover;
  }

  const sanitizeHtml = (html) => {
    const r = sanitize(html ?? '');
    return { html: r.cleanedHtml, capabilities: r.capabilities, report: r.report };
  };

  const capRollup = [];
  const pushCaps = (c) => {
    if (!c) return;
    for (const d of c.diffs || []) {
      if (!capRollup.some((x) => x.kind === d.kind && x.property === d.property && x.tag === d.tag && x.message === d.message)) {
        capRollup.push(d);
      }
    }
  };

  let extractedCover = migration.extractedCover || null;
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk).filter(Boolean);
    if (!node || typeof node !== 'object') return null;
    const type = BLOCK_TYPES.includes(node.type) ? node.type : 'html';
    const out = {
      id: node.id || uid(),
      type,
      label: node.label || '',
      align: node.align || '',
    };

    if (type === 'heading') {
      out.level = [1, 2, 3].includes(Number(node.level)) ? Number(node.level) : 2;
      out.text = String(node.text ?? '').replace(/<[^>]+>/g, '');
      if (!out.label) out.label = out.text.slice(0, 12) || '标题';
    } else if (type === 'text') {
      const r = sanitizeHtml(node.html ?? node.text ?? '');
      out.html = r.html;
      pushCaps(r.capabilities);
      if (!out.label) out.label = (node.text || r.html).replace(/<[^>]+>/g, '').slice(0, 12) || '正文';
    } else if (type === 'image') {
      out.assetId = node.assetId || null;
      // v1/v2 图片字段曾叫 url，向前兼容
      out.src = node.src || node.url || '';
      out.alt = node.alt || '';
      out.width = Number(node.width) || null;
      out.darkIcon = !!node.darkIcon; // 由前端/导入显式标记的深色小图标
      if (!out.label) out.label = out.alt || '图片';
    } else if (type === 'quote') {
      const r = sanitizeHtml(node.html ?? node.text ?? '');
      out.html = r.html;
      pushCaps(r.capabilities);
      if (!out.label) out.label = '引用';
    } else if (type === 'divider') {
      if (!out.label) out.label = '分隔线';
    } else {
      const r = sanitizeHtml(node.html ?? '');
      out.html = r.html;
      pushCaps(r.capabilities);
      if (!out.label) out.label = 'HTML 模块';
    }

    if (node._extractedCover && !extractedCover) extractedCover = node._extractedCover;
    if (Array.isArray(node.children) && node.children.length) {
      out.children = walk(node.children);
    }
    return out;
  };

  const tree = walk(nodes);
  migration.extractedCover = extractedCover;
  return {
    tree,
    schemaVersion: CURRENT_SCHEMA,
    migration,
    capabilityDiffs: capRollup,
  };
}

// ---------- 受控 HTML 渲染（浏览器预览 iframe 与导出共用此函数） ----------

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderNode(node, ctx) {
  const alignStyle = node.align ? `text-align:${node.align};` : '';
  switch (node.type) {
    case 'heading': {
      const sizes = { 1: '22px', 2: '18px', 3: '16px' };
      const tag = `h${node.level}`;
      return `<${tag} style="margin:18px 0 10px;font-size:${sizes[node.level]};font-weight:700;line-height:1.4;${alignStyle}">${esc(node.text)}</${tag}>`;
    }
    case 'text':
      return `<p style="margin:0 0 14px;line-height:1.75;font-size:16px;color:#3f3f3f;${alignStyle}">${node.html}</p>`;
    case 'quote':
      return `<blockquote style="margin:0 0 14px;padding:10px 14px;border-left:3px solid #07c160;background:#f7f8fa;color:#576b95;font-size:15px;line-height:1.7">${node.html}</blockquote>`;
    case 'divider':
      return '<hr style="border:none;border-top:1px solid #e5e5e5;margin:18px 0;">';
    case 'image': {
      const src = node.assetId && ctx.resolveAsset ? ctx.resolveAsset(node.assetId) : node.src;
      if (!src) {
        return `<p data-missing-asset="${esc(node.assetId || '')}" style="margin:0 0 14px;padding:24px;text-align:center;background:#fafafa;border:1px dashed #d0d0d0;color:#999;font-size:13px">图片资源缺失或未授权（${esc(node.alt || node.assetId || 'image')}）</p>`;
      }
      const w = node.width ? ` width="${node.width}"` : '';
      const cls = node.darkIcon ? ' class="mp-dark-icon"' : '';
      return `<p style="margin:0 0 14px;text-align:${node.align || 'center'};"><img${cls} src="${esc(src)}" alt="${esc(node.alt || '')}"${w} style="max-width:100%;height:auto;border-radius:4px;"></p>`;
    }
    case 'html':
      // html 字段在 normalizeTree 中已经过服务端清理；这里原样受控插入
      return `<div data-module="html" style="margin:0 0 14px;${alignStyle}">${node.html || ''}</div>`;
    default:
      return '';
  }
}

function renderNodes(nodes, ctx) {
  return (nodes || []).map((n) => renderNode(n, ctx)).join('\n');
}

/**
 * 渲染正文 HTML（不含整页骨架），供预览 iframe 与导出共用。
 */
export function renderBody(draft, { resolveAsset = null } = {}) {
  return renderNodes(draft.tree || draft.modules || [], { resolveAsset });
}

/**
 * 渲染受控完整 HTML 文档（导出文件）。
 * 该文档不含任何 <script>；正文宽度以公众号建议宽度 677 为基准。
 */
export function renderControlledDocument(draft, ctx = {}) {
  const body = renderBody(draft, ctx);
  if (hasResidualScriptRisk(body)) {
    // 双保险：任何脚本残留都阻止输出正式文档
    throw new Error('REFUSE_EXPORT: 渲染结果包含未清理脚本');
  }
  const cover = ctx.coverHtml || '';
  const title = esc(draft.title || '未命名图文');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{margin:0;background:#f2f3f5;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;}
  .mp-article{max-width:677px;margin:0 auto;background:#fff;padding:24px 20px 60px;box-sizing:border-box;}
  .mp-title{font-size:22px;font-weight:700;line-height:1.4;margin:8px 0 16px;}
  .mp-meta{font-size:13px;color:#999;margin-bottom:18px;}
  img{max-width:100%;height:auto;}
  @media (max-width:677px){ .mp-article{padding:20px 16px 48px;} }
</style>
</head>
<body>
<article class="mp-article">
${cover}
<h1 class="mp-title">${title}</h1>
<div class="mp-meta">预览台受控导出版 · ${new Date().toISOString()} · 非正式发布</div>
${body}
</article>
</body>
</html>`;
}
