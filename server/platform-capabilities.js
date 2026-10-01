/**
 * 目标图文平台能力配置 —— 微信公众号图文（mp.weixin.qq.com 文章页/草稿箱能力）
 *
 * 重要边界：
 * 1. 这是「微信公众号图文编辑器/文章页」的能力，不是邮件客户端（Outlook/Gmail）规则，
 *    不沿用邮件的表格布局、mso- 条件注释、<style> 全量剥离等邮件规则。
 * 2. 能力来自平台编辑器实际行为的白名单抽象；平台可能随时调整，
 *    因此预览台只做「受控近似预览」，差异以 issue 形式提示，绝不承诺像素一致。
 */

export const PLATFORM = {
  id: 'wechat-mp-article',
  label: '微信公众号图文',
  version: '2026.10',
  // 预览免责声明：任何对外文案不得删除/弱化
  disclaimer:
    '本预览为依据平台公开能力配置生成的受控近似渲染，不代表微信公众号实际渲染结果；' +
    '字号、行距、图片裁剪与暗色模式等在不同微信版本/机型上可能存在差异，不承诺像素级一致。',
};

/**
 * 允许进入受控 HTML 的标签白名单。
 * 注意与邮件场景的区别：允许 <section>/<span> 嵌套布局、style 属性、
 * data-* 自定义属性（编辑器自身模块标记），不允许 <html>/<head>/<body>/<form>/<input> 等。
 */
export const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'span', 'div', 'section',
  'h1', 'h2', 'h3', 'h4',
  'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup',
  'a', 'img', 'blockquote', 'ul', 'ol', 'li',
  'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'video', 'source', // 公众号支持视频组件，但 src 受平台资源白名单约束
  'code', 'pre', 'mark',
];

/** 允许的标签属性白名单（全局 + 标签级） */
export const ALLOWED_ATTRS = [
  'style', 'class', 'id',
  'data-mp-module', 'data-mp-version', // 结构化模块树标记，受控生成
  'src', 'alt', 'title', 'width', 'height',
  'href', 'target', 'rel',
  'colspan', 'rowspan',
  'controls', 'poster',
];

/**
 * 链接协议白名单。明确禁止 javascript: / data:text/html / vbscript: / file: 等。
 * http/https 放行（仍由 link 校验模块做危险链接识别）。
 */
export const ALLOWED_URL_PROTOCOLS = ['http', 'https', 'mailto', 'tel'];
export const DENIED_URL_PROTOCOLS = ['javascript', 'vbscript', 'file', 'data'];

/**
 * style 属性中允许的 CSS 属性白名单（公众号编辑器可保留的内联样式）。
 * 明确不支持的属性见 UNSUPPORTED_STYLES，用于「差异提示」而不是静默丢弃。
 */
export const ALLOWED_STYLES = [
  'color', 'background-color', 'background',
  'font-size', 'font-weight', 'font-style', 'font-family',
  'line-height', 'letter-spacing', 'text-align', 'text-decoration',
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'border', 'border-radius', 'border-width', 'border-style', 'border-color',
  'width', 'max-width', 'height',
  'display', 'vertical-align',
  'text-indent', 'word-break', 'white-space',
];

/**
 * 平台不支持 / 会被剥离或行为不一致的样式 —— 清理时命中要给用户「差异提示」。
 * reason 用于向用户解释，不假装能渲染。
 */
export const UNSUPPORTED_STYLES = {
  position: '公众号图文不支持绝对/固定定位（position），编辑器会剥离，预览中已忽略',
  'z-index': '图文正文无层叠上下文，z-index 不生效',
  float: '浮动布局在公众号中不可靠，建议改用 section 块级布局',
  'box-shadow': '公众号会过滤阴影（box-shadow），实际不显示',
  'text-shadow': '公众号会过滤文字阴影（text-shadow），实际不显示',
  'grid-template-columns': 'CSS Grid 不被公众号图文支持',
  'grid-column': 'CSS Grid 不被公众号图文支持',
  flex: '公众号对 Flex 支持不完整，多端表现不一致，预览不做承诺',
  'flex-grow': '公众号对 Flex 支持不完整',
  animation: '不允许 CSS 动画，平台会过滤',
  transition: '不允许 transition，平台会过滤',
  transform: 'transform 在公众号中会被过滤或表现不一致',
  opacity: '透明度在部分微信版本被忽略',
  position_fixed: null,
};

/** 平台断点能力（用于 Vue 端受控预览，非邮件 600px 那套规则） */
export const BREAKPOINTS = [
  {
    id: 'phone',
    label: '手机',
    width: 375,
    height: 667,
    dprNote: '微信正文按屏幕宽度流式排版，图片按屏宽缩放',
  },
  {
    id: 'desktop',
    label: '桌面（微信 PC / 网页打开）',
    width: 1080,
    height: 800,
    dprNote: '公众号文章正文最大约 677px 内容列，居中显示',
  },
];

/** 图片限制（正文图/封面图） */
export const MEDIA_LIMITS = {
  maxImageBytes: 2 * 1024 * 1024, // 2MB，超出会触发「图过大」验收项
  allowedImageTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
  coverRecommended: { width: 900, height: 383, ratio: '2.35:1' },
};

/**
 * 视频来源白名单：仅平台自身资源（由素材库托管），外部地址不可用。
 */
export const VIDEO_SRC_HOST_ALLOWLIST = [
  'mpvideo.qpic.cn',
  'finder.video.qq.com',
];

/** 校验问题级别 */
export const SEVERITY = Object.freeze({
  ERROR: 'error',       // 阻断导出确认
  WARNING: 'warning',   // 需用户显式知晓（可在说明风险后继续）
  INFO: 'info',
});

/**
 * 判定单个 CSS 属性是否被平台支持。
 * @returns {{supported: boolean, reason?: string}}
 */
export function styleCapability(prop) {
  const normalized = String(prop).trim().toLowerCase();
  if (ALLOWED_STYLES.includes(normalized)) return { supported: true };
  if (UNSUPPORTED_STYLES[normalized]) {
    return { supported: false, reason: UNSUPPORTED_STYLES[normalized] };
  }
  return { supported: false, reason: `公众号图文不保证支持样式 "${normalized}"，已从受控版本中移除` };
}
