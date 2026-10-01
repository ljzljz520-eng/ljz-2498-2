/**
 * 导出前内容校验。只有校验流程完成且没有 error，前端才进入“导出确认”。
 * 校验不替用户发布任何内容到外部账号。
 */
import { config } from './config.js';
import { renderBody } from './modules.js';
import { hasResidualScriptRisk } from './sanitizer.js';

const walkAll = (nodes, fn) => {
  for (const n of nodes || []) {
    fn(n);
    if (n.children) walkAll(n.children, fn);
  }
};

/** 计算 #rrggbb / rgb() 颜色的相对亮度（0~1） */
export function luminance(color) {
  const m = String(color || '').match(/#([0-9a-f]{6})/i) || String(color || '').match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (!m) return null;
  let r, g, b;
  if (m[0].startsWith('#')) {
    r = parseInt(m[1].slice(0, 2), 16); g = parseInt(m[1].slice(2, 4), 16); b = parseInt(m[1].slice(4, 6), 16);
  } else {
    [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

const darkBgKeywords = /(black|#000|#111|#1a1|#222|#1[0-9a-f]{2}|#2[0-2][0-9a-f])/i;
export function styleLikelyDark(style = '') {
  const bg = /background(?:-color)?\s*:\s*([^;"']+)/i.exec(style);
  if (!bg) return false;
  const val = bg[1];
  if (darkBgKeywords.test(val)) return true;
  const lum = luminance(val);
  return lum != null && lum < 0.18;
}

/**
 * @param {object} draft 归一化后的草稿
 * @param {object} deps { assets:Map, coverAsset, expectedCoverVersion }
 */
export function validateDraft(draft, deps = {}) {
  const issues = [];
  const add = (code, level, message, extra = {}) => issues.push({ code, level, message, ...extra });
  const assetMap = deps.assets || new Map();
  const tree = draft.tree || [];

  // 0) 空内容 / 标题
  if (!String(draft.title || '').trim()) add('title-empty', 'error', '标题不能为空');
  const textLen = renderBody(draft, { resolveAsset: (id) => assetMap.get(id)?.url }).replace(/<[^>]+>/g, '').trim().length;
  if (textLen === 0) add('body-empty', 'error', '正文为空，请先粘贴或添加模块');

  // 1) 封面
  const cover = draft.cover || null;
  if (!cover || (!cover.assetId && !cover.url)) {
    add('cover-missing', 'error', '缺少封面，导出前必须选择一个封面候选');
  } else {
    if (cover.assetId) {
      const ca = assetMap.get(cover.assetId);
      if (!ca) add('cover-asset-missing', 'error', '封面引用的资源不存在');
      else if (ca.status !== 'authorized') add('cover-asset-unauthorized', 'error', `封面资源授权状态为「${ca.status}」，授权已变化，请重新选择封面`);
    }
    if (deps.expectedCoverVersion != null && Number(cover.version) !== Number(deps.expectedCoverVersion)) {
      add('cover-conflict', 'error', `封面已被另一位编辑更新（当前版本 v${cover.version}，你基于 v${deps.expectedCoverVersion}），请刷新后重试`);
    }
  }

  // 2) 模块级检查
  walkAll(tree, (node) => {
    if (node.type === 'image') {
      // 2.1 资源授权
      if (node.assetId) {
        const a = assetMap.get(node.assetId);
        if (!a) {
          add('asset-missing', 'error', `图片「${node.label}」引用的资源不存在`, { moduleId: node.id, assetId: node.assetId });
        } else if (a.status !== 'authorized') {
          add('asset-unauthorized', 'error', `图片「${node.label}」的资源授权已变化（${a.status}），请替换或重新授权`, { moduleId: node.id, assetId: node.assetId });
        } else {
          // 2.2 图过大
          if (a.size > config.limits.maxImageBytes) {
            add('image-too-large', 'error', `图片「${node.label}」体积 ${(a.size / 1024).toFixed(0)}KB 超过 ${(config.limits.maxImageBytes / 1024).toFixed(0)}KB 限制`, { moduleId: node.id, assetId: node.assetId });
          }
          if (a.width && a.width > config.limits.recommendedContentWidth) {
            add('image-overwidth', 'warning', `图片「${node.label}」宽度 ${a.width}px 超过正文建议宽度 ${config.limits.recommendedContentWidth}px，可能被等比压缩`, { moduleId: node.id });
          }
        }
      } else if (node.src) {
        add('external-image', 'warning', `图片「${node.label}」仍是外部链接，建议入库为授权资源，避免平台侧无法访问`, { moduleId: node.id, url: node.src });
      } else {
        add('image-empty', 'error', `图片「${node.label}」没有可用来源`, { moduleId: node.id });
      }

      // 2.3 暗色图标不可见：显式标记的深色图标，或推断其落在深色背景容器中
      const inDark = node._parentDark === true;
      if (node.darkIcon || inDark) {
        add('dark-icon-invisible', 'error', `图标「${node.label}」为深色填充，在深色背景上不可见，请换浅色图标或加底色`, { moduleId: node.id });
      }
    }

    // 富文本模块内联背景里塞深色 svg 的启发式：标记 darkIcon 已在 image 类型覆盖
  });

  // 2.4 从 html 模块中检测被内联的深色 svg/img 暗色背景风险（轻量启发式）
  const bodyForScan = renderBody(draft, { resolveAsset: (id) => assetMap.get(id)?.url });
  const darkSvg = /<svg[^>]*>[\s\S]*?(?:fill|stroke)\s*=\s*["'](?:#(?:0|1|2)[0-9a-f]{2}|black)["'][\s\S]*?<\/svg>/i.test(bodyForScan)
    && /background(?:-color)?\s*:\s*[^;"']*(?:#0|#1|#2|black)/i.test(bodyForScan);
  if (darkSvg) add('dark-icon-invisible', 'warning', '检测到深色 SVG 位于深色背景区域附近，请人工确认图标可见性');

  // 3) 危险链接（清理报告在保存时已处理；这里对最终正文再扫描一次协议）
  const linkRe = /(?:href|src)\s*=\s*["']\s*(javascript|vbscript|data):/gi;
  let m;
  while ((m = linkRe.exec(bodyForScan))) {
    add('dangerous-link', 'error', `最终正文存在危险协议 ${m[1]}:，已阻止导出，请回到清理步骤处理`);
  }

  // 4) 正式内容不得含未清理脚本
  if (hasResidualScriptRisk(bodyForScan)) {
    add('residual-script', 'error', '正式正文检测到未清理脚本入口，已阻止导出');
  }

  // 5) 平台样式差异（来自粘贴/保存时汇总）
  for (const d of draft.capabilityDiffs || []) {
    if (d.kind === 'style-tag') {
      add('capability-style-tag', 'error', d.message);
    } else {
      add(d.kind || 'capability', d.level === 'error' ? 'error' : 'warning', d.message, { property: d.property, tag: d.tag });
    }
  }

  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  return {
    ok: errors.length === 0,
    issues,
    errorCount: errors.length,
    warningCount: warnings.length,
    checkedAt: new Date().toISOString(),
    platform: config.platform,
    notice: '校验为内容自查，不代表外部平台渲染结果，亦不会替你向公众号账号发布。',
  };
}
