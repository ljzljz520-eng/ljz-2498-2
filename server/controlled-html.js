/**
 * 受控 HTML 渲染器 —— 后台由结构化模块树生成唯一的正式 HTML。
 *
 * 安全保证：
 *  - html-block 模块的 html 字段必须是服务端 sanitizePipeline 的产物（API 层保证）；
 *    渲染器对其再做断言（assertFormalHtmlSafe），任何脚本残留直接抛错。
 *  - 结构化模块的文本统一经 escapeHtml 转义，链接协议白名单校验。
 *  - 输出中不生成任何 <script>、事件属性、javascript: 链接。
 */
import { SCHEMA_VERSION, MODULE_TYPES } from './module-tree.js';
import { ALLOWED_URL_PROTOCOLS, PLATFORM } from './platform-capabilities.js';
import { assertFormalHtmlSafe } from './validator.js';

export function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeUrl(href) {
  const m = String(href || '').match(/^\s*([a-z][a-z0-9+.-]*):/i);
  if (!href) return '';
  if (!m || ALLOWED_URL_PROTOCOLS.includes(m[1].toLowerCase())) {
    return href.trim().startsWith('//') ? '' : href;
  }
  return ''; // 非白名单协议不输出
}

function inlineStyle(styleObj = {}) {
  const allowed = Object.entries(styleObj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
  return allowed ? ` style="${escapeHtml(allowed)}"` : '';
}

export function renderModule(mod, assetUrlFor = (id) => `/assets/${id}`) {
  const tag = (id) => ` data-mp-module="${escapeHtml(id)}" data-mp-version="${SCHEMA_VERSION}"`;
  const p = mod.props || {};
  switch (mod.type) {
    case MODULE_TYPES.HEADING: {
      const level = [1, 2, 3, 4].includes(Number(p.level)) ? Number(p.level) : 2;
      const style = inlineStyle({ 'font-size': p.fontSize, 'text-align': p.align, color: p.color });
      return `<h${level}${tag(mod.id)}${style}>${escapeHtml(p.text || '')}</h${level}>`;
    }
    case MODULE_TYPES.PARAGRAPH:
      return `<p${tag(mod.id)}${inlineStyle({ 'text-align': p.align, color: p.color, 'line-height': p.lineHeight })}>${escapeHtml(p.text || '')}</p>`;
    case MODULE_TYPES.QUOTE:
      return `<blockquote${tag(mod.id)}${inlineStyle({ 'border-left': '3px solid #ddd', padding: '0 1em', color: '#666' })}>${escapeHtml(p.text || '')}</blockquote>`;
    case MODULE_TYPES.LIST: {
      const items = (p.items || []).map((t) => `<li>${escapeHtml(t)}</li>`).join('');
      const L = p.ordered ? 'ol' : 'ul';
      return `<${L}${tag(mod.id)}>${items}</${L}>`;
    }
    case MODULE_TYPES.DIVIDER:
      return `<hr${tag(mod.id)}>`;
    case MODULE_TYPES.IMAGE: {
      const src = assetUrlFor(p.assetId);
      if (!src) throw new Error(`图片模块 ${mod.id} 缺少可用资源地址`);
      const wrapperStyle = inlineStyle({
        'background-color': p.containerBg,
        padding: p.containerBg ? '8px' : '',
        'text-align': 'center',
      });
      return `<section${tag(mod.id)}${wrapperStyle}>` +
        `<img src="${escapeHtml(src)}" alt="${escapeHtml(p.alt || '')}" width="${p.width ? escapeHtml(String(p.width)) : ''}" style="max-width:100%;height:auto;border-radius:${p.radius || '0'}"></section>`;
    }
    case MODULE_TYPES.VIDEO: {
      const src = safeUrl(p.src) || (p.assetId ? assetUrlFor(p.assetId) : '');
      if (!src) return '';
      return `<video${tag(mod.id)} controls="controls"${p.poster ? ` poster="${escapeHtml(assetUrlFor(p.poster))}"` : ''} style="max-width:100%"><source src="${escapeHtml(src)}"></video>`;
    }
    case MODULE_TYPES.HTML_BLOCK: {
      // 必须为服务端清理产物
      assertFormalHtmlSafe(p.html || '');
      return `<section${tag(mod.id)} data-mp-source="sanitized-paste">${p.html}</section>`;
    }
    default:
      return '';
  }
}

/**
 * 生成受控正文片段（手机/桌面共用同一片段，差异仅在外层容器 CSS）。
 */
export function renderBody(doc, assetUrlFor) {
  return (doc.modules || []).map((m) => renderModule(m, assetUrlFor)).join('\n');
}

/**
 * 生成完整正式 HTML：内联最小样式、无脚本、无外部 CSS 依赖。
 * viewport: 'phone' | 'desktop'，只影响容器宽度提示，不改写正文内容。
 */
export function renderControlledHtml(doc, { viewport = 'phone', cover, assetUrlFor } = {}) {
  const body = renderBody(doc, assetUrlFor);
  assertFormalHtmlSafe(body);
  const maxWidth = viewport === 'desktop' ? '677px' : '100%';
  const coverHtml = cover
    ? `<img class="mp-cover" src="${escapeHtml(assetUrlFor ? assetUrlFor(cover.id) : `/assets/${cover.id}`)}" alt="" style="width:100%;display:block">`
    : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(doc.title || '')}</title>
</head>
<body style="margin:0;background:#f7f7f7;">
<div class="mp-page" style="max-width:${maxWidth};margin:0 auto;background:#fff;padding:16px;">
${coverHtml}
<h1 class="mp-title" style="font-size:22px;line-height:1.4;margin:16px 0 8px;">${escapeHtml(doc.title || '')}</h1>
<div class="mp-body" data-mp-schema="${SCHEMA_VERSION}">
${body}
</div>
<p class="mp-note" style="color:#999;font-size:12px;margin-top:24px;">${escapeHtml(PLATFORM.disclaimer)}</p>
</div>
</body>
</html>`;
}
