/**
 * SQLite 持久化（better-sqlite3，同步 API，适合本工具的单机/小团队场景）。
 *
 * 表职责：
 * - documents / document_versions：正文模块树 + 候选版本（每次保存生成候选，可回滚/恢复旧草稿）
 * - assets：素材资源（封面/正文图），含授权状态与图片元数据
 * - covers：封面候选池（一份文档可有多个封面候选）
 * - cover_locks：封面编辑锁（两个编辑同时换封面的冲突检测）
 * - export_jobs：导出确认记录（校验通过后才能创建；本系统不替用户向外部账号发布）
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCHEMA_VERSION } from './module-tree.js';

let db;

export function getDb(dbPath = process.env.MP_DB_PATH || 'data/preview.db') {
  if (db) return db;
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrateSchema(db);
  return db;
}

export function resetDb(dbPath) {
  if (db) { db.close(); db = null; }
  const fresh = new Database(dbPath);
  fresh.pragma('journal_mode = WAL');
  migrateSchema(fresh);
  db = fresh;
  return fresh;
}

function migrateSchema(d) {
  d.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT ${SCHEMA_VERSION},
    content_json TEXT NOT NULL,           -- 当前模块树 JSON
    cover_id TEXT,
    current_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS document_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    label TEXT,                           -- 候选版本说明
    schema_version INTEGER NOT NULL,
    content_json TEXT NOT NULL,
    sanitize_report_json TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(document_id, version)
  );

  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,                   -- cover | image | icon
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    avg_luminance REAL,                   -- 0~1，暗色图标检测用（由图片解析填充）
    authorized INTEGER NOT NULL DEFAULT 1,
    auth_note TEXT,
    storage_path TEXT,
    uploaded_by TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS covers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(id),
    label TEXT,
    selected INTEGER NOT NULL DEFAULT 0,
    expected_version INTEGER,            -- 乐观并发：选定时文档版本
    created_by TEXT,
    created_at TEXT NOT NULL
  );

  -- 封面编辑锁：同一文档同一时刻只允许一个编辑执行换封面（占用/提交/释放）
  CREATE TABLE IF NOT EXISTS cover_locks (
    document_id TEXT PRIMARY KEY,
    editor_id TEXT NOT NULL,
    acquired_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS export_jobs (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    document_version INTEGER NOT NULL,
    status TEXT NOT NULL,                 -- confirmed | generated | cancelled
    validation_json TEXT NOT NULL,       -- 校验通过快照
    controlled_html TEXT,
    phone_png TEXT,
    desktop_png TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    published_externally INTEGER NOT NULL DEFAULT 0  -- 恒为 0：本系统不执行外部发布
  );
  `);
}
