import fs from 'node:fs';

// 全局配置：所有“允许/限制”均显式声明，不沿用邮件客户端（MSO 条件注释、表格布局等）规则。
export const config = {
  platform: {
    id: 'wechat-mp-article',
    name: '微信公众号 · 图文消息正文',
    capabilityVersion: '2026.10.01',
  },
  server: {
    port: Number(process.env.PORT || 5179),
  },
  paths: {
    dataDir: new URL('../../data/', import.meta.url).pathname,
    uploadsDir: new URL('../../data/uploads/', import.meta.url).pathname,
    exportsDir: new URL('../../data/exports/', import.meta.url).pathname,
    previewsDir: new URL('../../data/previews/', import.meta.url).pathname,
    dbFile: new URL('../../data/db.json', import.meta.url).pathname,
    distDir: new URL('../../dist/', import.meta.url).pathname,
  },
  limits: {
    // 公众号正文图片建议先入库为平台资源；超过该体积直接判错（可按账号能力调整）
    maxImageBytes: 1 * 1024 * 1024,
    recommendedContentWidth: 677,
    phoneWidth: 375,
    desktopWidth: 768,
    maxSnapshotsPerDraft: 20,
  },
  // 链接/资源协议白名单（显式）。未列出的协议一律移除并按风险记账。
  allowedProtocols: {
    a: { href: ['http:', 'https:', 'mailto:'] },
    img: { src: ['http:', 'https:'] },
    default: ['http:', 'https:'],
  },
};

export const ensureDirs = () => {
  for (const p of [
    config.paths.dataDir,
    config.paths.uploadsDir,
    config.paths.exportsDir,
    config.paths.previewsDir,
  ]) {
    fs.mkdirSync(p, { recursive: true });
  }
};
