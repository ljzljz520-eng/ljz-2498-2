/**
 * 素材资源服务：上传（大小/类型校验、亮度提取）、授权状态管理。
 */
import { v4 as uuid } from 'uuid';
import { mkdirSync, writeFileSync } from 'node:fs';
import { getDb } from './db.js';
import { readPngMeta } from './image-meta.js';
import { MEDIA_LIMITS } from './platform-capabilities.js';

const now = () => new Date().toISOString();

export class AssetError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/**
 * @param {Buffer} buffer
 * @param {{filename:string,mimeType:string,kind:string,editorId?:string}} meta
 * @param {string} assetRoot
 */
export function uploadAsset(buffer, { filename, mimeType, kind = 'image', editorId = 'anon' }, assetRoot = 'data/assets') {
  if (!buffer || !buffer.length) throw new AssetError('空文件');
  if (!MEDIA_LIMITS.allowedImageTypes.includes(mimeType)) {
    throw new AssetError(`不支持的素材类型 ${mimeType}，允许：${MEDIA_LIMITS.allowedImageTypes.join(', ')}`);
  }
  // 注意：超大不禁止入库（草稿阶段允许），但会在导出校验中作为 error 阻断——便于「图过大」验收
  const db = getDb();
  const id = 'ast_' + uuid().slice(0, 10);
  mkdirSync(assetRoot, { recursive: true });
  const storagePath = `${assetRoot}/${id}.${(mimeType.split('/')[1] || 'bin').replace('jpeg', 'jpg')}`;
  writeFileSync(storagePath, buffer);

  let meta2 = { width: null, height: null, avgLuminance: null };
  if (mimeType === 'image/png') {
    try { meta2 = readPngMeta(buffer) || meta2; } catch { /* 解析失败保留空值 */ }
  }

  db.prepare(`INSERT INTO assets
    (id,kind,filename,mime_type,bytes,width,height,avg_luminance,authorized,auth_note,storage_path,uploaded_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,'1',NULL,?,?,?)`)
    .run(id, kind, filename, mimeType, buffer.length, meta2.width, meta2.height, meta2.avgLuminance,
         storagePath, editorId, now());
  return getAsset(id);
}

export function getAsset(id) {
  return getDb().prepare('SELECT * FROM assets WHERE id=?').get(id) || null;
}

export function listAssets(kind) {
  return kind
    ? getDb().prepare('SELECT * FROM assets WHERE kind=? ORDER BY created_at DESC').all(kind)
    : getDb().prepare('SELECT * FROM assets ORDER BY created_at DESC').all();
}

/**
 * 资源授权变化：撤回 / 重新授权。
 * 撤回后所有引用该资源的文档在导出校验中得到 error（验收：资源授权变化）。
 */
export function setAuthorization(id, authorized, note = '') {
  const db = getDb();
  const asset = getAsset(id);
  if (!asset) throw new AssetError('资源不存在', 404);
  db.prepare('UPDATE assets SET authorized=?, auth_note=? WHERE id=?')
    .run(authorized ? 1 : 0, note || null, id);
  return getAsset(id);
}

export class NotFound {}
