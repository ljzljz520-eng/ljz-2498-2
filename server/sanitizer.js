/**
 * 服务端 HTML 清理器
 * - 所有粘贴/外部 HTML 必须经此模块清理；浏览器内预览与导出使用「同一个清理结果」。
 * - 允许的标签/样式与链接协议在 platform-capabilities 中显式声明（公众号图文能力，非邮件规则）。
 * - 清理分两段：
 *   1) sanitize-html 按白名单做结构/属性/协议剥离（权威的安全边界）；
 *   2) 对「原始输入」做属性级扫描，产出差异报告（哪些属性/样式被移除、为什么）。
 */
import sanitizeHtml from 'sanitize-html';
import {
  ALLOWED_TAGS,
  ALLOWED_ATTRS,
  ALLOWED_URL_PROTOCOLS,
  ALLOWED_STYLES,
  styleCapability,
} from './platform-capabilities.js';

export function parseInlineStyles(styleAttr) {
  const decls = [];
  if (!styleAttr) return decls;
  for (const part of String(styleAttr).split(';')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const prop = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim();
    if (prop) decls.push({ prop, value });
  }
  return decls;
}

export function serializeStyles(decls) {
  return decls.map((d) => `${d.prop}: ${d.value}`).join('; ');
}

const DANGEROUS_STYLE_VALUE = /expression\s*\(/i;

/**
 * 对原始 HTML 做一次轻量标签扫描，仅用于收集「差异报告」（不参与安全决策）。
 * 能识别 <tag attr=".."> 形式，足以覆盖编辑器粘贴内容。
 */
function scanRawForReport(raw, report) {
  const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)>/g;
  let m;
  while ((m = tagRe.exec(raw))) {
    const tag = m[1].toLowerCase();
    const attrText = m[2] || '';
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let am;
    while ((am = attrRe.exec(attrText))) {
      const name = am[1].toLowerCase();
      const value = am[2] ?? am[3] ?? am[4] ?? '';
      if (name === 'style') {
        for (const d of parseInlineStyles(value)) {
          if (DANGEROUS_STYLE_VALUE.test(d.value) || /url\s*\(\s*['"]?\s*javascript:/i.test(d.value)) {
            report.hadScript = true;
            report.unsupportedStyles.push({ tag, prop: d.prop, reason: '检测到脚本型样式值，已移除' });
            continue;
          }
          if (!ALLOWED_STYLES.includes(d.prop)) {
            const cap = styleCapability(d.prop);
            report.unsupportedStyles.push({ tag, prop: d.prop, reason: cap.reason });
          }
        }
        continue;
      }
      if (/^on/i.test(name)) {
        report.hadScript = true;
        report.removedAttrs.push({ tag, attr: name, reason: '内联事件属性属于脚本，禁止' });
        continue;
      }
      if (!ALLOWED_ATTRS.includes(name)) {
        report.removedAttrs.push({ tag, attr: name, reason: '属性不在平台允许列表' });
      }
    }
  }
}

/**
 * 清理任意 HTML。返回受控 HTML 与差异报告。
 */
export function sanitizePipeline(dirty) {
  const raw = String(dirty || '');
  const report = {
    removedTags: [],
    removedAttrs: [],
    unsupportedStyles: [],
    blockedLinks: [],
    hadScript: false,
  };

  if (/<script[\s>]/i.test(raw) || /\s+on\w+\s*=/i.test(raw) || /javascript:/i.test(raw)) {
    report.hadScript = true;
  }
  scanRawForReport(raw, report);

  const clean = sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { '*': ALLOWED_ATTRS },
    allowedSchemes: ALLOWED_URL_PROTOCOLS,
    allowedSchemesByTag: {
      img: ['http', 'https'],
      source: ['https'],
    },
    // allowedStyles 结构：{ 选择器: { CSS属性: [匹配属性值的正则] } }
    // 未知属性（z-index/position 等）由 sanitize-html 丢弃；差异已在 scanRawForReport 记录。
    allowedStyles: { '*': Object.fromEntries(ALLOWED_STYLES.map((name) => [name, [/.*/]])) },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    transformTags: {
      script: () => {
        report.hadScript = true;
        report.removedTags.push({ tag: 'script', reason: '脚本标签不允许进入图文正文' });
        return { tagName: 'span', text: '', attribs: {} };
      },
      iframe: () => {
        report.removedTags.push({ tag: 'iframe', reason: 'iframe 不被公众号图文支持' });
        return { tagName: 'span', attribs: {} };
      },
      style: () => {
        report.removedTags.push({ tag: 'style', reason: '仅允许内联样式，<style> 块已移除' });
        return { tagName: 'span', text: '', attribs: {} };
      },
      object: () => {
        report.removedTags.push({ tag: 'object', reason: 'object/embed 插件不被支持' });
        return { tagName: 'span', attribs: {} };
      },
      embed: () => {
        report.removedTags.push({ tag: 'embed', reason: 'object/embed 插件不被支持' });
        return { tagName: 'span', attribs: {} };
      },
    },
  });

  // 危险链接报告：直接从原始输入枚举 href/src，去重后记录
  // （sanitize-html 在 exclusiveFilter 前已剥离危险协议，因此在这里统一采集）
  const seen = new Set();
  const urlAttrRe = /(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let um;
  while ((um = urlAttrRe.exec(raw))) {
    const u = um[1] ?? um[2] ?? um[3];
    if (!u || seen.has(u)) continue;
    const mm = u.match(/^\s*([a-z][a-z0-9+.-]*):/i);
    if (u.trim().startsWith('//')) {
      seen.add(u);
      report.blockedLinks.push({ tag: 'a', href: u, reason: '协议相对 URL 已禁止' });
      continue;
    }
    if (mm && !ALLOWED_URL_PROTOCOLS.includes(mm[1].toLowerCase())) {
      seen.add(u);
      report.blockedLinks.push({
        tag: 'a', href: u,
        reason: `链接协议 "${mm[1].toLowerCase()}:" 不在允许列表，链接已移除`,
      });
      report.hadScript = true;
    }
  }

  // 清理后二次过滤：即使属性在白名单内，值含 expression()/url(javascript:) 也要剔除该声明
  let hadDangerValue = false;
  const cleanOut = clean.replace(/style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, (full, q1, q2) => {
    const val = q1 ?? q2;
    const kept = [];
    for (const d of parseInlineStyles(val)) {
      if (DANGEROUS_STYLE_VALUE.test(d.value) || /url\s*\(\s*['"]?\s*javascript:/i.test(d.value)) {
        hadDangerValue = true;
        continue;
      }
      kept.push(`${d.prop}: ${d.value}`);
    }
    const q = q1 !== undefined ? '"' : "'";
    return kept.length ? `style=${q}${kept.join('; ')}${q}` : '';
  });
  if (hadDangerValue) report.hadScript = true;

  return { clean: cleanOut, report };
}

// 基础别名（兼容旧引用）
export const sanitizeContent = sanitizePipeline;
