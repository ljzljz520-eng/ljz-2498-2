/**
 * 服务端清理器（唯一清理实现）
 *
 * 原则：
 *  1) 浏览器粘贴预览与最终导出必须使用本模块产出的同一份 cleanedHtml，禁止两端各自清理。
 *  2) 标签 / 属性 / 协议白名单全部显式声明；未列出的内容默认拒绝。
 *  3) 规则面向公众号图文正文，不引入任何邮件客户端规则。
 */
import { parse } from 'node-html-parser';
import { config } from './config.js';
import { TAGS, parseStyle, classifyProperty, analyzeCapabilities } from './capabilities.js';

const ALLOWED_TAGS = new Set(TAGS.allowed);
const UNWRAP_TAGS = new Set(TAGS.unwrap);
const DROP_TAGS = new Set(TAGS.drop);

// 各标签允许保留的属性（显式白名单）
const ATTR_WHITELIST = {
  a: new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  font: new Set(['color', 'size']),
  td: new Set(['colspan', 'rowspan', 'style']),
  th: new Set(['colspan', 'rowspan', 'style']),
  table: new Set(['style', 'border', 'cellpadding', 'cellspacing', 'width']),
  colgroup: new Set(['span']),
  col: new Set(['span', 'style', 'width']),
};
const COMMON_STYLE_ONLY = new Set(['style']);
const GLOBAL_ALLOWED = new Set(['style']);

function allowedAttrsFor(tagName) {
  if (ATTR_WHITELIST[tagName]) return ATTR_WHITELIST[tagName];
  return GLOBAL_ALLOWED;
}

/**
 * 校验 URL 协议。返回 { ok, url, protocol, reason }
 *  - 允许：显式协议白名单；同源相对路径（/、./、../）；页内锚点（#）
 */
export function checkUrl(rawUrl, tagName, attrName) {
  const url = String(rawUrl || '').trim();
  if (!url) return { ok: false, url, protocol: null, reason: 'empty-url' };

  if (url.startsWith('#') || url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) {
    return { ok: true, url, protocol: 'relative' };
  }

  let protocol = null;
  try {
    const u = new URL(url);
    protocol = u.protocol;
  } catch {
    return { ok: false, url, protocol: null, reason: 'malformed-url' };
  }

  const table = config.allowedProtocols[tagName]?.[attrName] || config.allowedProtocols.default || ['http:', 'https:'];
  if (!table.includes(protocol)) {
    return { ok: false, url, protocol, reason: 'disallowed-protocol' };
  }
  return { ok: true, url, protocol };
}

/**
 * 过滤单个 style 字符串：只保留目标平台可承载的属性。
 * 返回 { html, kept:[{prop,value}], dropped:[{prop,value}] }
 */
export function filterStyle(styleText) {
  const kept = [];
  const dropped = [];
  for (const { prop, value } of parseStyle(styleText)) {
    const c = classifyProperty(prop);
    if (c.level === 'supported' || c.level === 'partial') {
      kept.push({ prop: c.key, value });
    } else {
      dropped.push({ prop: c.key, value });
    }
  }
  return {
    html: kept.map(({ prop, value }) => `${prop}: ${value}`).join('; '),
    kept,
    dropped,
  };
}

/**
 * 主清理入口
 * @param {string} dirtyHtml 原始 HTML（粘贴内容）
 * @returns {{cleanedHtml:string, report:object}}
 */
export function sanitize(dirtyHtml) {
  const report = {
    removedScripts: 0,
    removedStyleBlocks: 0,
    removedTags: [],
    unwrappedTags: [],
    removedEventAttrs: [],
    removedAttributes: 0,
    strippedStyleProps: [],
    dangerousLinks: [],
    externalLinks: [],
    imageRefs: [],
    styleBlocks: 0,
    inlineStyles: [],
  };

  let source = String(dirtyHtml ?? '');
  // HTML 注释不承载（可能夹带条件注释等邮件残留），统一移除
  source = source.replace(/<!--[\s\S]*?-->/g, '');

  const root = parse(`<div id="__sanitize_root__">${source}</div>`);
  const container = root.querySelector('#__sanitize_root__');

  const collect = (node) => {
    const results = [];
    for (const el of node.querySelectorAll('*')) results.push(el);
    return results;
  };

  for (const el of collect(container)) {
    const tag = el.tagName?.toLowerCase();
    if (!tag) continue;

    // 1) 标签级处理
    if (DROP_TAGS.has(tag)) {
      if (tag === 'script') report.removedScripts += 1;
      if (tag === 'style') report.removedStyleBlocks += 1;
      if (!report.removedTags.includes(tag)) report.removedTags.push(tag);
      el.remove();
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      // 未知/不承载容器标签：解包保留子内容，并记录差异
      if (!report.unwrappedTags.includes(tag)) report.unwrappedTags.push(tag);
      try {
        el.replaceWith(...el.childNodes);
      } catch {
        el.remove();
      }
      continue;
    }

    // 2) 属性级处理
    let removed = false;
    const attrs = { ...el.attributes };
    const allowedAttrs = allowedAttrsFor(tag);
    for (const attrName of Object.keys(attrs)) {
      const lower = attrName.toLowerCase();
      const value = attrs[attrName];

      // 事件属性 = 脚本入口，必须按风险记账
      if (lower.startsWith('on')) {
        report.removedEventAttrs.push({ tag, attr: lower });
        el.removeAttribute(attrName);
        continue;
      }

      if (!allowedAttrs.has(lower)) {
        // 显式记录少数高关注属性，其余静默计入移除数量
        report.removedAttributes += 1;
        el.removeAttribute(attrName);
        continue;
      }

      // href / src 协议校验
      if (lower === 'href' || lower === 'src') {
        const check = checkUrl(value, tag, lower);
        if (!check.ok) {
          const item = { tag, attr: lower, url: value, protocol: check.protocol, reason: check.reason };
          report.dangerousLinks.push(item);
          if (tag === 'a') {
            // 危险链接：去掉协议属性并解链，但保留锚文本，避免误导航
            el.removeAttribute('href');
            el.removeAttribute('target');
          } else {
            // 图片等资源：直接移除元素，防止坏资源/数据外泄
            el.remove();
            removed = true;
          }
        }
        if (check.protocol === 'http:' || check.protocol === 'https:') {
          const bucket = tag === 'img' ? report.imageRefs : report.externalLinks;
          if (!bucket.some((x) => x.url === check.url)) bucket.push({ url: check.url, protocol: check.protocol });
        }
      }
    }

    if (removed) continue;

    // 3) 样式过滤（仅对白名单标签的 style 生效）
    if (el.getAttribute('style') != null) {
      const filtered = filterStyle(el.getAttribute('style'));
      for (const d of filtered.dropped) {
        if (!report.strippedStyleProps.some((x) => x.prop === d.prop && x.value === d.value)) {
          report.strippedStyleProps.push({ prop: d.prop, value: d.value });
        }
      }
      for (const k of filtered.kept) {
        if (!report.inlineStyles.some((x) => x.prop === k.prop && x.value === k.value)) {
          report.inlineStyles.push({ prop: k.prop, value: k.value });
        }
      }
      if (filtered.html) el.setAttribute('style', filtered.html);
      else el.removeAttribute('style');
    }

    // 4) 链接安全属性规范化
    if (tag === 'a' && el.getAttribute('href')) {
      const target = (el.getAttribute('target') || '').toLowerCase();
      if (target === '_blank') {
        el.setAttribute('rel', 'noopener noreferrer');
      } else if (target && target !== '_self') {
        el.removeAttribute('target');
      }
    }
  }

  const cleanedHtml = container.innerHTML;

  // 5) 输出后防御性扫描：正式预览/导出不得含未清理脚本
  const defenses = defensiveScan(cleanedHtml);

  // 6) 差异分析（样式提示，面向公众号平台，不承诺像素一致）
  const capabilities = analyzeCapabilities({
    inlineStyles: report.inlineStyles,
    strippedStyles: report.strippedStyleProps,
    styleTags: report.removedStyleBlocks,
    droppedTags: report.removedTags,
  });

  return { cleanedHtml, report: { ...report, defenses }, capabilities };
}

/** 清理结果的最终防御性扫描：任何脚本入口残留都必须被发现 */
export function defensiveScan(html) {
  const findings = [];
  const text = String(html);
  const patterns = [
    { name: 'script-tag', re: /<\s*script/i },
    { name: 'event-handler', re: /\son\w+\s*=/i },
    { name: 'javascript-uri', re: /(?:href|src)\s*=\s*["']?\s*javascript:/i },
    { name: 'data-uri', re: /(?:href|src)\s*=\s*["']?\s*data:/i },
    { name: 'vbscript-uri', re: /vbscript:/i },
    { name: 'style-expression', re: /expression\s*\(/i },
    { name: 'iframe', re: /<\s*iframe/i },
  ];
  for (const p of patterns) {
    if (p.re.test(text)) findings.push(p.name);
  }
  return findings;
}

export const hasResidualScriptRisk = (html) => defensiveScan(html).length > 0;
