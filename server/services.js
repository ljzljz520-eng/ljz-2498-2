/**
 * 业务服务层：封装文档保存、候选版本、封面并发控制与导出流程。
 */
import { v4 as uuid } from 'uuid';
import { getDb } from './db.js';
import { SCHEMA_VERSION, migrate, assertModuleTree } from './module-tree.js';
import { sanitizePipeline } from './sanitizer.js';
import { validateDocument } from './validator.js';
import { renderControlledHtml, renderBody } from './controlled-html.js';
import { BREAKPOINTS, PLATFORM } from './platform-capabilities.js';
import { capturePreview } from './screenshot.js';
import { readFileSync } from 'node:fs';

const now = () => new Date().toISOString();
const LOCK_TTL_MS = 60_000;

function rowToDoc(row) {
  return {
    id: row.id,
    title: row.title,
    schemaVersion: row.schema_version,
    coverId: row.cover_id,
    currentVersion: row.current_version,
    updatedAt: row.updated_at,
    ...JSON.parse(row.content_json),
  };
}

export function createDocument({ title = '未命名图文', editorId = 'anon' }) {
  const db = getDb();
  const id = 'doc_' + uuid().slice(0, 10);
  const doc = {
    id,
    schemaVersion: SCHEMA_VERSION,
    title,
    coverId: null,
    modules: [],
  };
  const ts = now();
  db.prepare(`INSERT INTO documents (id,title,schema_version,content_json,current_version,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?)`)
    .run(id, title, SCHEMA_VERSION, JSON.stringify(stripMeta(doc)), 1, ts, ts);
  db.prepare(`INSERT INTO document_versions (document_id,version,label,schema_version,content_json,created_by,created_at)
              VALUES (?,?,?,?,?,?,?)`)
    .run(id, 1, '初始版本', SCHEMA_VERSION, JSON.stringify(stripMeta(doc)), editorId, ts);
  return getDocument(id);
}

function stripMeta(doc) {
  const { id, ...rest } = doc;
  return rest;
}

export function getDocument(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM documents WHERE id=?').get(id);
  if (!row) return null;
  const stored = JSON.parse(row.content_json);
  // 读取时统一迁移（旧草稿恢复路径也走这里）
  const migrated = migrate({ ...stored, schemaVersion: row.schema_version });
  return { id: row.id, title: row.title, coverId: row.cover_id, currentVersion: row.current_version, ...migrated, updatedAt: row.updated_at };
}

export function listVersions(id) {
  const db = getDb();
  return db.prepare('SELECT version,label,schema_version,created_by,created_at FROM document_versions WHERE document_id=? ORDER BY version DESC').all(id);
}

export function getVersion(id, version) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM document_versions WHERE document_id=? AND version=?').get(id, version);
  if (!row) return null;
  const stored = JSON.parse(row.content_json);
  return { version: row.version, label: row.label, sanitizeReport: row.sanitize_report_json ? JSON.parse(row.sanitize_report_json) : null,
           doc: migrate({ ...stored, schemaVersion: row.schema_version }) };
}

/**
 * 保存正文（结构化模块树）。
 * @param {object} incoming 客户端提交的模块树
 * @param {{editorId:string, label?:string}} meta
 * @returns {{doc:object, version:number, sanitizeReports:Array}}
 */
export function saveDocument(id, incoming, { editorId, label } = {}) {
  const db = getDb();
  const existing = getDocument(id);
  if (!existing) throw new NotFoundError('文档不存在');

  // 迁移客户端可能持有的旧结构；然后规范化
  const migrated = migrate({ ...incoming, schemaVersion: incoming.schemaVersion || existing.schemaVersion });
  assertModuleTree(migrated);

  // 所有 html-block 必须重新过服务端清理：浏览器预览/导出共用这一份结果
  const sanitizeReports = [];
  for (const m of migrated.modules) {
    if (m.type === 'html-block' && m.props?.html != null) {
      const { clean, report } = sanitizePipeline(m.props.html);
      m.props.html = clean;
      m.props.sanitizedAt = now();
      report.moduleId = m.id;
      sanitizeReports.push(report);
    }
  }

  const ts = now();
  const nextVersion = existing.currentVersion + 1;
  const content = stripMeta({ ...migrated, id });
  const tx = db.transaction(() => {
    db.prepare(`UPDATE documents SET title=?,schema_version=?,content_json=?,cover_id=?,current_version=?,updated_at=? WHERE id=?`)
      .run(migrated.title || existing.title, SCHEMA_VERSION, JSON.stringify(content),
           migrated.coverId ?? existing.coverId, nextVersion, ts, id);
    db.prepare(`INSERT INTO document_versions (document_id,version,label,schema_version,content_json,sanitize_report_json,created_by,created_at)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, nextVersion, label || `版本 ${nextVersion}`, SCHEMA_VERSION,
           JSON.stringify(content), JSON.stringify(sanitizeReports), editorId || 'anon', ts);
  });
  tx();
  return { doc: getDocument(id), version: nextVersion, sanitizeReports };
}

/** 恢复/回滚到任意候选版本（旧草稿恢复）：作为新版本写入，不破坏历史 */
export function restoreVersion(id, version, { editorId } = {}) {
  const old = getVersion(id, version);
  if (!old) throw new NotFoundError('候选版本不存在');
  return saveDocument(id, old.doc, { editorId, label: `恢复自 v${version}` });
}

/* ---------------- 封面：候选 + 乐观锁/编辑锁（两个编辑同时换封面） ---------------- */

export class ConflictError extends Error {
  constructor(message, details) { super(message); this.status = 409; this.details = details; }
}
export class NotFoundError extends Error {
  constructor(message) { super(message); this.status = 404; }
}

/** 获取封面编辑锁（持锁者才能提交换封面） */
export function acquireCoverLock(id, editorId) {
  const db = getDb();
  const ts = now();
  const existing = db.prepare('SELECT * FROM cover_locks WHERE document_id=?').get(id);
  if (existing) {
    const expired = new Date(existing.expires_at).getTime() < Date.now();
    if (!expired && existing.editor_id !== editorId) {
      throw new ConflictError('另一位编辑正在更换封面，请稍后再试', {
        heldBy: existing.editor_id, acquiredAt: existing.acquired_at,
      });
    }
  }
  db.prepare(`INSERT INTO cover_locks (document_id,editor_id,acquired_at,expires_at)
              VALUES (?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET editor_id=excluded.editor_id,
              acquired_at=excluded.acquired_at,expires_at=excluded.expires_at`)
    .run(id, editorId, ts, new Date(Date.now() + LOCK_TTL_MS).toISOString());
  return { locked: true, editorId, acquiredAt: ts };
}

export function releaseCoverLock(id, editorId) {
  const db = getDb();
  db.prepare('DELETE FROM cover_locks WHERE document_id=? AND editor_id=?').run(id, editorId);
  return { locked: false };
}

/** 添加封面候选（不改变当前封面） */
export function addCoverCandidate(id, assetId, { editorId, label } = {}) {
  const db = getDb();
  const ts = now();
  const info = db.prepare(`INSERT INTO covers (document_id,asset_id,label,selected,created_by,created_at)
                           VALUES (?,?,?,0,?,?)`).run(id, assetId, label || null, editorId, ts);
  return db.prepare('SELECT * FROM covers WHERE id=?').get(info.lastInsertRowid);
}

export function listCoverCandidates(id) {
  const db = getDb();
  return db.prepare(`SELECT c.*, a.filename,a.bytes,a.authorized,a.auth_note,a.mime_type
                     FROM covers c JOIN assets a ON a.id=c.asset_id
                     WHERE c.document_id=? ORDER BY c.id DESC`).all(id);
}

/**
 * 选定封面（换封面）。并发控制双重保障：
 *  1. 必须持有封面编辑锁（或锁已过期）；
 *  2. expectedVersion 必须等于文档当前版本（乐观并发：另一编辑先提交则冲突）。
 */
export function selectCover(id, assetId, { editorId, expectedVersion, candidateId } = {}) {
  const db = getDb();
  const doc = getDocument(id);
  if (!doc) throw new NotFoundError('文档不存在');

  const lock = db.prepare('SELECT * FROM cover_locks WHERE document_id=?').get(id);
  if (lock) {
    const expired = new Date(lock.expires_at).getTime() < Date.now();
    if (!expired && lock.editor_id !== editorId) {
      throw new ConflictError('封面正被另一位编辑锁定，换封面被拒绝', { heldBy: lock.editor_id });
    }
  }

  if (Number(expectedVersion) !== Number(doc.currentVersion)) {
    throw new ConflictError(
      `文档已被他人更新（当前 v${doc.currentVersion}，你基于 v${expectedVersion}），请刷新后再换封面`,
      { currentVersion: doc.currentVersion, expectedVersion: Number(expectedVersion) },
    );
  }

  const asset = db.prepare('SELECT * FROM assets WHERE id=?').get(assetId);
  if (!asset) throw new NotFoundError('封面资源不存在');
  if (!asset.authorized) throw new ConflictError(`封面资源授权已变化：${asset.auth_note || '未授权'}`);

  const ts = now();
  const tx = db.transaction(() => {
    db.prepare('UPDATE covers SET selected=0 WHERE document_id=?').run(id);
    if (candidateId) {
      db.prepare('UPDATE covers SET selected=1 WHERE id=? AND document_id=?').run(candidateId, id);
    } else {
      db.prepare(`INSERT INTO covers (document_id,asset_id,label,selected,expected_version,created_by,created_at)
                  VALUES (?,?,?,1,?,?,?)`).run(id, assetId, '直接选定', doc.currentVersion, editorId, ts);
    }
    // cover_id 同时写入列与 content_json 快照，保证读取一致；换封面也产生新版本号，
    // 作为另一编辑乐观并发检测的依据
    const snapshot = JSON.parse(db.prepare('SELECT content_json FROM documents WHERE id=?').get(id).content_json);
    snapshot.coverId = assetId;
    const nextVersion = doc.currentVersion + 1;
    db.prepare('UPDATE documents SET cover_id=?, content_json=?, current_version=?, updated_at=? WHERE id=?')
      .run(assetId, JSON.stringify(snapshot), nextVersion, ts, id);
    db.prepare(`INSERT INTO document_versions (document_id,version,label,schema_version,content_json,created_by,created_at)
                VALUES (?,?,?,?,?,?,?)`)
      .run(id, nextVersion, '更换封面', SCHEMA_VERSION, JSON.stringify(snapshot), editorId, ts);
    db.prepare('DELETE FROM cover_locks WHERE document_id=?').run(id);
  });
  tx();
  return getDocument(id);
}

/* ---------------- 导出：校验通过 → 确认 → 后台生成受控 HTML 与预览图 ---------------- */

export function assetsMapFor(doc) {
  const db = getDb();
  const ids = new Set();
  if (doc.coverId) ids.add(doc.coverId);
  for (const m of doc.modules || []) {
    if ((m.type === 'image' || m.type === 'video') && m.props?.assetId) ids.add(m.props.assetId);
  }
  const map = new Map();
  for (const id of ids) {
    const a = db.prepare('SELECT * FROM assets WHERE id=?').get(id);
    if (a) map.set(id, a);
  }
  return map;
}

/**
 * 导出前校验。校验规则必须全部执行完成（validateDocument 保证），
 * 返回结果给前端确认页；ok=false 时不允许创建导出任务。
 */
export function preflight(id) {
  const doc = getDocument(id);
  if (!doc) throw new NotFoundError('文档不存在');
  const versionRow = getDb()
    .prepare('SELECT sanitize_report_json FROM document_versions WHERE document_id=? AND version=?')
    .get(id, doc.currentVersion);
  const reports = versionRow?.sanitize_report_json ? JSON.parse(versionRow.sanitize_report_json) : [];
  const mergedReport = {
    unsupportedStyles: reports.flatMap((r) => r.unsupportedStyles || []),
    removedTags: reports.flatMap((r) => r.removedTags || []),
    blockedLinks: reports.flatMap((r) => r.blockedLinks || []),
  };
  const result = validateDocument(doc, assetsMapFor(doc), mergedReport);
  return { doc, validation: { ...result, platform: PLATFORM.id, disclaimer: PLATFORM.disclaimer } };
}

/**
 * 确认导出：只有 preflight 无 error 才能调用。
 * warningAck 为用户对全部警告的显式确认列表。
 * 本系统只生成受控 HTML 与预览图，不向任何外部账号执行发布。
 */
export async function confirmExport(id, { editorId = 'anon', warningAck = [] } = {}) {
  const db = getDb();
  const { doc, validation } = preflight(id);
  if (!validation.ok) {
    const err = new Error('存在阻断性校验问题，不能进入导出确认');
    err.status = 422; err.details = validation.errors;
    throw err;
  }
  if (validation.warnings.length && new Set(warningAck).size !== validation.warnings.length) {
    const err = new Error('存在需知悉的差异/警告，未全部确认');
    err.status = 409; err.details = validation.warnings;
    throw err;
  }

  const jobId = 'job_' + uuid().slice(0, 10);
  const assetUrlFor = (assetId) => `asset://${assetId}`; // 受控 HTML 内占位，截图前替换
  const htmlFor = (vp) => {
    const cover = doc.coverId ? { id: doc.coverId } : null;
    return renderControlledHtml(doc, { viewport: vp, cover, assetUrlFor });
  };

  // 后台生成两个断点的受控 HTML（同一份模块树 -> 同一清理版内容）
  const phoneHtml = htmlFor('phone');
  const desktopHtml = htmlFor('desktop');

  // 资源 URL 替换为本地可读地址后截图
  const resolveHtml = (html) => {
    let out = html;
    for (const m of doc.modules) {
      if ((m.type === 'image' || m.type === 'video') && m.props?.assetId) {
        const a = db.prepare('SELECT * FROM assets WHERE id=?').get(m.props.assetId);
        if (a?.storage_path) {
          const data = readFileSync(a.storage_path).toString('base64');
          out = out.replaceAll(`asset://${m.props.assetId}`, `data:${a.mime_type};base64,${data}`);
        }
      }
    }
    if (doc.coverId) {
      const a = db.prepare('SELECT * FROM assets WHERE id=?').get(doc.coverId);
      if (a?.storage_path) {
        const data = readFileSync(a.storage_path).toString('base64');
        out = out.replaceAll(`asset://${doc.coverId}`, `data:${a.mime_type};base64,${data}`);
      }
    }
    return out;
  };

  const [phoneShot, desktopShot] = await Promise.all([
    capturePreview(resolveHtml(phoneHtml), doc, BREAKPOINTS[0]),
    capturePreview(resolveHtml(desktopHtml), doc, BREAKPOINTS[1]),
  ]);

  const ts = now();
  // 预览图统一存为 {renderer, dataBase64} JSON；PNG/SVG 均文本化，读取侧无需区分
  const pack = (shot) => JSON.stringify({ renderer: shot.renderer, dataBase64: shot.png.toString('base64') });
  db.prepare(`INSERT INTO export_jobs
    (id,document_id,document_version,status,validation_json,controlled_html,phone_png,desktop_png,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(jobId, id, doc.currentVersion, 'generated',
         JSON.stringify(validation), phoneHtml,
         pack(phoneShot), pack(desktopShot), editorId, ts);

  return {
    jobId,
    status: 'generated',
    publishedExternally: false, // 明确：不替用户向外部账号发布
    renderers: { phone: phoneShot.renderer, desktop: desktopShot.renderer },
    disclaimer: PLATFORM.disclaimer,
    controlledHtml: phoneHtml,
  };
}

/** 导出任务列表/详情（预览图以 base64 提供下载查看） */
export function getExportJob(jobId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM export_jobs WHERE id=?').get(jobId);
  if (!row) return null;
  const phone = JSON.parse(row.phone_png);
  const desktop = JSON.parse(row.desktop_png);
  return {
    jobId: row.id, documentId: row.document_id, documentVersion: row.document_version,
    status: row.status, publishedExternally: !!row.published_externally,
    validation: JSON.parse(row.validation_json),
    controlledHtml: row.controlled_html,
    phonePngBase64: phone.dataBase64,
    desktopPngBase64: desktop.dataBase64,
    renderer: { phone: phone.renderer, desktop: desktop.renderer },
    createdAt: row.created_at,
  };
}

/** 纯函数导出：供前端实时预览拿受控 HTML（同样断言无脚本） */
export function previewHtml(id, viewport = 'phone') {
  const doc = getDocument(id);
  if (!doc) throw new NotFoundError('文档不存在');
  const cover = doc.coverId ? { id: doc.coverId } : null;
  return {
    html: renderControlledHtml(doc, { viewport, cover, assetUrlFor: (assetId) => `/api/assets/${assetId}/raw` }),
    bodyOnly: renderBody(doc, (assetId) => `/api/assets/${assetId}/raw`),
    schemaVersion: SCHEMA_VERSION,
    platform: PLATFORM,
  };
}
