/**
 * 种子数据：演示与验收所需的封面/资源/候选版本/草稿。
 * 仅在 db.json 不存在时初始化。
 */
import { db, mutate, writeAssetFile, audit } from './store.js';

const svgDocument = (w, h, inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;

function coverSvg(bg, accent, title) {
  return svgDocument(677, 300, `
  <rect width="677" height="300" fill="${bg}"/>
  <circle cx="560" cy="70" r="120" fill="${accent}" opacity="0.25"/>
  <circle cx="120" cy="260" r="90" fill="${accent}" opacity="0.18"/>
  <text x="48" y="150" font-size="34" font-weight="700" fill="#1a1a1a" font-family="sans-serif">${title}</text>
  <text x="48" y="196" font-size="16" fill="#666" font-family="sans-serif">MPA Preview Studio · 受控封面</text>`);
}

const darkIconSvg = svgDocument(64, 64, `
  <rect width="64" height="64" rx="12" fill="#101317"/>
  <path d="M20 40 L32 20 L44 40 Z" fill="#111111"/>
  <circle cx="32" cy="44" r="6" fill="#0d0d0d"/>`);

const lightIconSvg = svgDocument(64, 64, `
  <rect width="64" height="64" rx="12" fill="#101317"/>
  <path d="M20 40 L32 20 L44 40 Z" fill="#ffffff"/>
  <circle cx="32" cy="44" r="6" fill="#f2f2f2"/>`);

const contentImgSvg = svgDocument(677, 260, `
  <rect width="677" height="260" fill="#eaf7f0"/>
  <rect x="28" y="28" width="621" height="204" rx="10" fill="#ffffff" stroke="#cfe8da"/>
  <text x="338" y="140" text-anchor="middle" font-size="22" fill="#07a35a" font-family="sans-serif">正文配图（已授权，677px）</text>`);

const revokedImgSvg = svgDocument(677, 220, `
  <rect width="677" height="220" fill="#f3f3f3"/>
  <text x="338" y="115" text-anchor="middle" font-size="20" fill="#999" font-family="sans-serif">历史配图（授权已过期）</text>`);

export async function seedIfEmpty() {
  if (Object.keys(db().assets).length) return false;
  // 先写资源文件
  const pendingAssets = [];
  const saveAsset = (id, a, buffer) => {
    pendingAssets.push([id, { id, createdAt: new Date().toISOString(), ...a }, Buffer.from(buffer, 'utf8')]);
  };

  // ---- 资源 ----
  const aCover1 = 'asset_0001';
  saveAsset(aCover1, {
    filename: 'cover-spring.svg', kind: 'cover', contentType: 'image/svg+xml',
    width: 677, height: 300, dominantDark: false,
    size: Buffer.byteLength(coverSvg('#eaf7f0', '#07c160', '春季新品')),
    status: 'authorized', sourceName: '春季封面.svg',
  }, coverSvg('#eaf7f0', '#07c160', '春季新品'));

  const aCover2 = 'asset_0002';
  saveAsset(aCover2, {
    filename: 'cover-event.svg', kind: 'cover', contentType: 'image/svg+xml',
    width: 677, height: 300, dominantDark: false,
    size: Buffer.byteLength(coverSvg('#eef3ff', '#3b6cf6', '读者见面会')),
    status: 'authorized', sourceName: '活动封面.svg',
  }, coverSvg('#eef3ff', '#3b6cf6', '读者见面会'));

  const aContent = 'asset_0003';
  saveAsset(aContent, {
    filename: 'inline-figure.svg', kind: 'image', contentType: 'image/svg+xml',
    width: 677, height: 260, dominantDark: false,
    size: Buffer.byteLength(contentImgSvg), status: 'authorized', sourceName: '正文配图.svg',
  }, contentImgSvg);

  const aDarkIcon = 'asset_0004';
  saveAsset(aDarkIcon, {
    filename: 'arrow-dark.svg', kind: 'icon', contentType: 'image/svg+xml',
    width: 64, height: 64, dominantDark: true,
    size: Buffer.byteLength(darkIconSvg), status: 'authorized', sourceName: '深色箭头.svg',
  }, darkIconSvg);

  const aLightIcon = 'asset_0005';
  saveAsset(aLightIcon, {
    filename: 'arrow-light.svg', kind: 'icon', contentType: 'image/svg+xml',
    width: 64, height: 64, dominantDark: false,
    size: Buffer.byteLength(lightIconSvg), status: 'authorized', sourceName: '浅色箭头.svg',
  }, lightIconSvg);

  const aRevoked = 'asset_0006';
  saveAsset(aRevoked, {
    filename: 'old-figure.svg', kind: 'image', contentType: 'image/svg+xml',
    width: 677, height: 220, dominantDark: false,
    size: Buffer.byteLength(revokedImgSvg), status: 'revoked', revokedAt: '2026-09-20T08:00:00.000Z',
    sourceName: '历史配图.svg',
  }, revokedImgSvg);

  // 超大图：真实生成 >1MB 的文件，保证“图过大”判断可信
  const bigPad = 'x'.repeat(1200 * 1024);
  const bigSvg = svgDocument(1200, 520, `<metadata>${bigPad}</metadata><rect width="1200" height="520" fill="#fff7e6"/><text x="600" y="260" text-anchor="middle" font-size="28" fill="#d48806" font-family="sans-serif">超大海报（1200px, &gt;1MB）</text>`);
  const aBig = 'asset_0007';
  saveAsset(aBig, {
    filename: 'huge-poster.svg', kind: 'image', contentType: 'image/svg+xml',
    width: 1200, height: 520, dominantDark: false,
    size: Buffer.byteLength(bigSvg), status: 'authorized', sourceName: '超大高清海报.svg',
  }, bigSvg);

  // 资源文件落盘，然后进入原子写事务
  for (const [id, rec, buf] of pendingAssets) writeAssetFile(id, buf);
  await mutate((d) => {
    for (const [id, rec] of pendingAssets) d.assets[id] = rec;

  // ---- 封面候选库（含版本号，模拟并发换封面） ----
  d.covers['cover_0001'] = {
    id: 'cover_0001', name: '春季主推封面', assetId: aCover1,
    version: 2, updatedBy: 'editor-a', updatedAt: '2026-09-28T02:00:00.000Z',
    history: [
      { version: 1, assetId: aCover2, updatedBy: 'editor-b', at: '2026-09-27T06:00:00.000Z' },
      { version: 2, assetId: aCover1, updatedBy: 'editor-a', at: '2026-09-28T02:00:00.000Z' },
    ],
  };
  d.covers['cover_0002'] = {
    id: 'cover_0002', name: '备用封面（含过期资源）', assetId: aRevoked,
    version: 1, updatedBy: 'editor-a', updatedAt: '2026-09-15T02:00:00.000Z',
    history: [{ version: 1, assetId: aRevoked, updatedBy: 'editor-a', at: '2026-09-15T02:00:00.000Z' }],
  };

  // ---- 草稿 ----
  // 1) 可导出的健康稿（含一条样式 warning）
  d.drafts['drf_ready'] = {
    id: 'drf_ready',
    title: '四月新品合辑',
    status: 'editing',
    schemaVersion: 3,
    cover: { coverId: 'cover_0001', assetId: aCover1, version: 2 },
    tree: [
      { id: 'r1', type: 'heading', label: '开篇', align: '', level: 2, text: '四月新品合辑' },
      { id: 'r2', type: 'text', label: '导语', align: '', html: '本期我们整理了四件值得关注的新品，点击 <a href="https://mp.weixin.qq.com/sample" target="_blank" rel="noopener noreferrer">阅读原文专题</a> 查看更多。' },
      { id: 'r3', type: 'image', label: '正文配图', align: '', assetId: aContent, src: '', alt: '新品配图', width: 677 },
      { id: 'r4', type: 'quote', label: '编辑点评', align: '', html: '整体节奏更轻快，配色沿用春季绿色系。' },
      { id: 'r5', type: 'html', label: '浮动卡片', align: '', html: '<section style="float:left;margin-right:10px;padding:8px 12px;background:#f6fffa;border-radius:6px;">速览卡片</section>' },
      { id: 'r6', type: 'divider', label: '分隔线', align: '' },
    ],
    capabilityDiffs: [
      { kind: 'css-partial', property: 'float', level: 'warning', message: '样式 float: 浮动在窄屏与不同终端容易错位' },
    ],
    snapshots: [],
    createdAt: '2026-09-29T03:00:00.000Z',
    updatedAt: '2026-09-29T03:00:00.000Z',
    updatedBy: 'editor-a',
  };

  // 2) 问题稿：覆盖验收项（图过大 / 暗色图标 / 授权变化 / 外部图 / 样式差异）
  d.drafts['drf_issues'] = {
    id: 'drf_issues',
    title: '活动长图盘点（有问题待修复）',
    status: 'editing',
    schemaVersion: 3,
    cover: { coverId: 'cover_0001', assetId: aCover1, version: 2 },
    tree: [
      { id: 'i1', type: 'heading', label: '开篇', align: '', level: 2, text: '活动长图盘点' },
      { id: 'i2', type: 'image', label: '超大高清海报', align: '', assetId: aBig, src: '', alt: '超大海报', width: 1200 },
      { id: 'i3', type: 'image', label: '深色箭头', align: 'center', assetId: aDarkIcon, src: '', alt: '深色箭头', width: 64, darkIcon: true },
      { id: 'i4', type: 'image', label: '历史配图', align: '', assetId: aRevoked, src: '', alt: '历史配图', width: 677 },
      { id: 'i5', type: 'image', label: '外链截图', align: '', assetId: null, src: 'https://example.com/screenshot.png', alt: '外链截图', width: null },
      {
        id: 'i6', type: 'html', label: '动画横幅', align: '',
        html: '<p style="padding:10px;background:#101317;color:#fff;border-radius:6px;">限时活动，下拉查看 ↓</p>',
      },
    ],
    capabilityDiffs: [
      { kind: 'css-unsupported', property: 'animation', level: 'warning', message: '样式 animation: 正文不承载动画（粘贴时已移除）' },
    ],
    snapshots: [
      {
        id: 'snap_seed_1', label: '首版', savedAt: '2026-09-28T09:00:00.000Z', actor: 'editor-a', schemaVersion: 3,
        title: '活动长图盘点（有问题待修复）',
        cover: { coverId: 'cover_0001', assetId: aCover1, version: 1 },
        tree: [
          { id: 'i1', type: 'heading', label: '开篇', align: '', level: 2, text: '活动盘点（初版）' },
          { id: 'i5', type: 'image', label: '外链截图', align: '', assetId: null, src: 'https://example.com/screenshot.png', alt: '外链截图', width: null },
        ],
        capabilityDiffs: [],
      },
    ],
    createdAt: '2026-09-28T09:00:00.000Z',
    updatedAt: '2026-09-30T01:00:00.000Z',
    updatedBy: 'editor-b',
  };

  // 3) 旧版草稿（v1），演示版本迁移与旧草稿恢复
  d.drafts['drf_legacy'] = {
    id: 'drf_legacy',
    title: '2025 年终特刊（旧版草稿）',
    status: 'legacy',
    schemaVersion: 1,
    cover: null,
    tree: [
      { id: 'l1', type: 'block', kind: 'header', text: '年终特刊', meta: { title: '年终特刊' } },
      { id: 'l2', type: 'block', kind: 'paragraph', html: '这是旧编辑器保存的段落，含<b>加粗</b>与<script>track()</script>埋点。' },
      { id: 'l3', type: 'block', kind: 'picture', url: 'https://example.com/old-cover.png', cover: 'https://example.com/old-cover.png', note: '旧版图片字段为 url，封面以字符串保存' },
      { id: 'l4', type: 'block', kind: 'raw', html: '<p style="animation:flash 1s;z-index:9">旧动画模块</p>' },
    ],
    capabilityDiffs: [],
    snapshots: [],
    createdAt: '2025-12-20T08:00:00.000Z',
    updatedAt: '2025-12-20T08:00:00.000Z',
    updatedBy: 'system-migrate',
  };


  });
  await audit({ actor: 'system', action: 'seed.init', target: 'all', detail: { assets: 7, drafts: 3, covers: 2 } });
  return true;
}
