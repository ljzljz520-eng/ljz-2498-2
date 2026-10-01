/**
 * 后台生成预览图（SVG 矢量，模拟 375px 手机断点视图）。
 * 无原生截图依赖；真实生产可替换为 Playwright 渲染同一受控 HTML。
 * 预览图不承诺与外部平台像素一致，仅用于核对排版与封面。
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDirs } from './config.js';
import { renderBody } from './modules.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/[\n\r]/g, ' ').slice(0, 120);

function stripTags(s) {
  return String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {object} draft 草稿
 * @param {object} ctx { resolveAsset, coverUrl }
 */
export function renderPreviewSvg(draft, ctx = {}) {
  const W = 375;
  const H = 667;
  const blocks = draft.tree || [];
  const lines = [];

  let y = 150;
  if (ctx.coverUrl) {
    lines.push(`<image href="${esc(ctx.coverUrl)}" x="0" y="0" width="${W}" height="140" preserveAspectRatio="xMidYMid slice"/>`);
    y = 158;
  } else {
    lines.push(`<rect x="0" y="0" width="${W}" height="140" fill="#e9ecef"/>`);
    lines.push(`<text x="${W / 2}" y="78" text-anchor="middle" font-size="13" fill="#9aa0a6">未设置封面</text>`);
  }

  lines.push(`<text x="16" y="${y}" font-size="17" font-weight="700" fill="#1a1a1a">${esc(draft.title || '未命名图文')}</text>`);
  y += 26;

  const maxY = H - 46;
  for (const node of blocks) {
    if (y > maxY) break;
    if (node.type === 'heading') {
      y += 18;
      lines.push(`<text x="16" y="${y}" font-size="${node.level === 1 ? 18 : 15}" font-weight="700" fill="#1a1a1a">${esc(node.text || '标题')}</text>`);
      y += 8;
    } else if (node.type === 'image') {
      const src = node.assetId && ctx.resolveAsset ? ctx.resolveAsset(node.assetId) : node.src;
      if (src) {
        lines.push(`<image href="${esc(src)}" x="16" y="${y}" width="${W - 32}" height="90" preserveAspectRatio="xMidYMid slice"/>`);
      } else {
        lines.push(`<rect x="16" y="${y}" width="${W - 32}" height="60" fill="#f1f3f5" stroke="#dee2e6" stroke-dasharray="4 3"/>`);
        lines.push(`<text x="${W / 2}" y="${y + 35}" text-anchor="middle" font-size="11" fill="#adb5bd">资源缺失/未授权</text>`);
      }
      y += 100;
    } else if (node.type === 'divider') {
      y += 12;
      lines.push(`<line x1="16" y1="${y}" x2="${W - 16}" y2="${y}" stroke="#e5e5e5"/>`);
      y += 12;
    } else {
      const text = stripTags(node.html || node.text || '') || (node.type === 'quote' ? '引用' : '正文');
      // 每行约 22 个中文字符
      const charsPerLine = 22;
      const rows = Math.min(3, Math.max(1, Math.ceil(text.length / charsPerLine)));
      for (let i = 0; i < rows && y <= maxY; i++) {
        const seg = text.slice(i * charsPerLine, (i + 1) * charsPerLine);
        lines.push(`<text x="16" y="${y + 12}" font-size="${node.type === 'quote' ? 13 : 14}" fill="${node.type === 'quote' ? '#576b95' : '#3f3f3f'}">${esc(seg)}</text>`);
        y += 22;
      }
      y += 8;
    }
  }

  const watermark = '预览台生成 · 非微信官方渲染 · 像素仅供参考';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  ${lines.join('\n  ')}
  <rect x="0" y="${H - 30}" width="${W}" height="30" fill="#f7f8fa"/>
  <text x="${W / 2}" y="${H - 11}" text-anchor="middle" font-size="10" fill="#9aa0a6">${esc(watermark)}</text>
</svg>`;
}

export function writePreviewSvg(draftId, draft, ctx) {
  ensureDirs();
  const svg = renderPreviewSvg(draft, ctx);
  const file = path.join(config.paths.previewsDir, `${draftId}.svg`);
  fs.writeFileSync(file, svg);
  return { file, svg };
}

// 供测试/静态说明：确认正文渲染在预览图流程中也无脚本
import { hasResidualScriptRisk } from './sanitizer.js';
export function bodyIsClean(draft, ctx) {
  return !hasResidualScriptRisk(renderBody(draft, ctx));
}
