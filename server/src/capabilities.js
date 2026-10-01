/**
 * 目标图文平台能力配置 —— 微信公众号图文消息正文（编辑后渲染环境）
 *
 * 重要边界：
 *  - 这里描述的是“公众号图文正文”的渲染能力，不是邮件客户端（Outlook/Gmail 等）。
 *    因此不出现 mso- 条件注释、表格布局 hack、VML 回退等邮件规则。
 *  - 该配置用于：① 能力说明；② 粘贴/正文的样式差异提示；③ 导出前校验。
 *  - 能力按平台文档与常见渲染表现归纳为 supported / partial / unsupported；
 *    partial 不阻断，但必须明确提示“表现可能不一致”。
 */

export const PLATFORM = {
  id: 'wechat-mp-article',
  name: '微信公众号 · 图文消息正文',
  version: '2026.10.01',
  notes: [
    '正文以内联 style 为主；<style> 内的选择器样式在编辑器保存后可能被丢弃，预览台会将其下线并提示。',
    '外部图片需先成为平台可访问资源；未入库资源在导出校验中提示。',
    '交互脚本（<script>、事件属性、javascript: 链接）不被正文承载，一律清理。',
  ],
};

// 公众号图文正文可较稳定呈现的内联样式属性（kebab-case）
const SUPPORTED = new Set([
  'color', 'background-color', 'background',
  'font-size', 'font-weight', 'font-style', 'font-family',
  'line-height', 'letter-spacing', 'text-align', 'text-decoration',
  'text-indent', 'text-transform', 'vertical-align',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border', 'border-width', 'border-style', 'border-color',
  'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-radius',
  'width', 'height', 'max-width', 'min-height',
  'display', 'box-sizing',
  'opacity', 'overflow',
]);

// 部分支持：可保留但需提示差异（值/机型/容器依赖）
const PARTIAL = {
  position: '脱离文档流定位在不同阅读容器中可能错位，建议用边距/换行替代',
  top: '与 position 配合使用，容器表现可能不一致',
  left: '与 position 配合使用，容器表现可能不一致',
  right: '与 position 配合使用，容器表现可能不一致',
  bottom: '与 position 配合使用，容器表现可能不一致',
  'z-index': '层叠层级在部分阅读容器不生效',
  float: '浮动在窄屏与不同终端容易错位',
  flex: 'flex 布局在部分旧版 WebView 表现不一致，建议简化为块级布局',
  'flex-direction': 'flex 布局在部分旧版 WebView 表现不一致',
  'justify-content': 'flex 布局在部分旧版 WebView 表现不一致',
  'align-items': 'flex 布局在部分旧版 WebView 表现不一致',
  gap: '间距在部分旧版 WebView 不生效',
  'box-shadow': '阴影在部分阅读容器被裁剪或忽略',
  'text-shadow': '文字阴影在部分终端不生效',
  transform: '变换在部分阅读容器不生效或影响排版',
  filter: '滤镜在部分终端不生效',
  gradient: '渐变需写在 background 中，部分终端兼容性一般',
  cursor: '正文为只读阅读态，光标样式无意义',
  'user-select': '文本选择行为由阅读容器控制',
  'white-space': '换行策略在不同终端可能被覆盖',
  'word-break': '长文本断词在部分终端表现不一致',
};

// 明确不支持（清理时直接剥离，不进入正式预览/导出）
const UNSUPPORTED = new Set([
  'position-fixed', // 以声明值形式存在的概念项
  'animation', 'animation-name', 'animation-duration', 'animation-delay',
  'animation-timing-function', 'animation-iteration-count',
  'transition', 'transition-property', 'transition-duration',
  'transition-timing-function', 'transition-delay',
]);

// 标签能力
export const TAGS = {
  // 允许保留语义的标签
  allowed: [
    'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup', 'small',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'span', 'div', 'section', 'article', 'header', 'footer', 'blockquote',
    'ul', 'ol', 'li',
    'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'figure', 'figcaption',
    'hr', 'font', 'center',
    'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g', 'defs', 'use',
  ],
  // 不允许承载：解包保留子内容
  unwrap: [
    'html', 'body', 'head', 'main', 'aside', 'nav', 'time', 'abbr', 'address',
    'label', 'fieldset', 'legend', 'button', 'form', 'span',
  ],
  // 直接连内容移除
  drop: ['script', 'style', 'link', 'meta', 'iframe', 'object', 'embed', 'video', 'audio', 'input', 'textarea', 'select', 'noscript', 'template'],
  // 结构相关标签的说明（用于差异提示）
  notes: {
    table: '表格在公众号正文中保留，但建议固定宽度 ≤ 677px，避免窄屏横向溢出',
    svg: '内联 SVG 可作为矢量图标保留；深色填充图标放在深色封面上可能不可见（导出前校验会提示）',
    img: '图片需可被平台访问；外部链接图片建议先入库为授权资源',
  },
};

const KEBAB = (prop) => prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

export function classifyProperty(prop) {
  const key = KEBAB(String(prop).trim().toLowerCase());
  if (UNSUPPORTED.has(key)) return { level: 'unsupported', key, message: '该样式在公众号图文正文中不支持' };
  if (Object.prototype.hasOwnProperty.call(PARTIAL, key)) {
    return { level: 'partial', key, message: PARTIAL[key] };
  }
  if (SUPPORTED.has(key)) return { level: 'supported', key };
  return { level: 'unknown', key, message: '非公众号正文常用样式属性，未在能力白名单内，清理时会被剥离' };
}

/**
 * 解析 style 声明字符串
 * @returns {Array<{prop:string,value:string,raw:string}>}
 */
export function parseStyle(styleText = '') {
  const decls = [];
  for (const part of String(styleText).split(';')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const prop = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!prop || !value) continue;
    decls.push({ prop: KEBAB(prop.toLowerCase()), value, raw: part });
  }
  return decls;
}

/**
 * 汇总一段原始 HTML 中与目标平台相关的样式差异。
 * 用于粘贴时提示，以及导出前校验。
 */
export function analyzeCapabilities({ inlineStyles = [], strippedStyles = [], styleTags = 0, droppedTags = [] } = {}) {
  const diffs = [];
  const seen = new Set();
  const push = (d) => {
    const sig = d.kind + '|' + (d.property || d.tag || '');
    if (!seen.has(sig)) {
      seen.add(sig);
      diffs.push(d);
    }
  };

  if (styleTags > 0) {
    push({
      kind: 'style-tag',
      level: 'error',
      message: `检测到 ${styleTags} 个 <style> 块：公众号正文不保证保留选择器样式，已在清理版中移除，请改用内联 style`,
    });
  }

  for (const { prop, value } of strippedStyles) {
    const c = classifyProperty(prop);
    if (c.level === 'unsupported' || c.level === 'unknown') {
      push({
        kind: 'css-unsupported',
        property: c.key,
        value,
        level: 'warning',
        message: c.level === 'unsupported'
          ? `样式 ${c.key}: ${c.message}（已在清理版中移除）`
          : `${c.message}（已在清理版中移除）`,
      });
    }
  }

  for (const { prop, value } of inlineStyles) {
    const c = classifyProperty(prop);
    if (c.level === 'partial') {
      push({ kind: 'css-partial', property: c.key, value, level: 'warning', message: `样式 ${c.key}: ${c.message}` });
    } else if (c.level === 'unknown') {
      push({ kind: 'css-unsupported', property: c.key, value, level: 'warning', message: c.message });
    } else if (c.level === 'unsupported') {
      push({ kind: 'css-unsupported', property: c.key, value, level: 'warning', message: c.message });
    }

    // 值层面差异
    if (c.key === 'position' && /fixed|sticky/i.test(value)) {
      push({
        kind: 'css-value',
        property: 'position',
        value,
        level: 'warning',
        message: `position:${value} 在公众号阅读容器中不生效，已按普通定位处理`,
      });
    }
    if (c.key === 'background' && /url\s*\(/i.test(value)) {
      push({
        kind: 'css-value',
        property: 'background',
        value,
        level: 'warning',
        message: '背景图在公众号正文中兼容性一般，建议改用 <img> 承载',
      });
    }
  }

  for (const tag of droppedTags) {
    push({
      kind: 'tag-dropped',
      property: null,
      tag,
      value: null,
      level: 'warning',
      message: `标签 <${tag}> 不能在公众号图文正文中承载，已${tag === 'script' ? '连同脚本内容移除' : '移除（保留其子文本）'}`,
    });
  }

  return {
    platform: { id: PLATFORM.id, name: PLATFORM.name, version: PLATFORM.version },
    diffs,
    errorCount: diffs.filter((d) => d.level === 'error').length,
    warningCount: diffs.filter((d) => d.level === 'warning').length,
  };
}

export const capabilityDescriptor = {
  platform: PLATFORM,
  supported: [...SUPPORTED],
  partial: Object.fromEntries(Object.entries(PARTIAL).map(([k, v]) => [k, v])),
  unsupported: [...UNSUPPORTED],
  tags: TAGS,
  disclaimer:
    '预览用于内容自查与排版核对，不承诺与微信外部平台渲染像素完全一致；最终以公众号后台真机预览为准。',
};
