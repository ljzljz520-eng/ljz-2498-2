/**
 * 导出：在服务端用“同一清理版模块树”生成受控 HTML 与预览图。
 * 仅落盘到本地数据目录供下载/查看，绝不向微信或任何外部账号发起发布请求。
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDirs } from './config.js';
import { renderControlledDocument } from './modules.js';
import { writePreviewSvg } from './preview.js';

export function assetResolver(assetMap) {
  return (assetId) => {
    const a = assetMap.get(assetId);
    if (!a || a.status !== 'authorized') return null;
    return `/api/assets/${assetId}/raw`;
  };
}

export function buildExport(draft, { assetMap, coverAsset }) {
  ensureDirs();
  const resolveAsset = assetResolver(assetMap);
  const coverUrl = coverAsset ? `/api/assets/${coverAsset.id}/raw` : '';
  const coverHtml = coverUrl
    ? `<div style="margin:0 -0 18px;"><img src="${coverUrl}" alt="封面" style="width:100%;display:block;border-radius:6px;"></div>`
    : '';

  const html = renderControlledDocument(draft, { resolveAsset, coverHtml });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const htmlName = `${draft.id}-${stamp}.html`;
  const htmlPath = path.join(config.paths.exportsDir, htmlName);
  fs.writeFileSync(htmlPath, html, 'utf8');

  const prev = writePreviewSvg(draft.id, draft, { resolveAsset, coverUrl });

  return {
    htmlFile: htmlPath,
    htmlName,
    htmlUrl: `/api/exports/${encodeURIComponent(htmlName)}`,
    htmlSize: Buffer.byteLength(html),
    previewUrl: `/api/previews/${draft.id}.svg?t=${Date.now()}`,
    exportedAt: new Date().toISOString(),
    coverUrl,
    externalPublishing: false, // 显式：本系统不执行外部发布
  };
}
