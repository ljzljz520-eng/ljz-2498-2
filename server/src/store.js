/**
 * 仓储层：JSON 文件持久化（环境无内置 SQLite 时的零依赖实现，接口与关系库等价）。
 * 写操作使用临时文件 + rename 原子提交，避免半写状态。
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDirs } from './config.js';

let dbPath = config.paths.dbFile;
let cache = null;
let writeChain = Promise.resolve();

const emptyDb = () => ({
  meta: { createdAt: new Date().toISOString(), counter: 1 },
  drafts: {},   // id -> draft
  assets: {},   // id -> asset
  covers: {},   // id -> cover record（封面候选库）
  audit: [],    // 审计事件
});

export function useDbFile(file) {
  dbPath = file;
  cache = null;
}

export function db() {
  if (cache) return cache;
  ensureDirs();
  if (!fs.existsSync(dbPath)) {
    cache = emptyDb();
    persist();
  } else {
    cache = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  }
  return cache;
}

function persist() {
  const tmp = dbPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, dbPath);
}

/** 串行化写操作 */
export function mutate(fn) {
  writeChain = writeChain.then(async () => {
    const d = db();
    const maybe = await fn(d);
    persist();
    return maybe;
  });
  return writeChain;
}

export const nextId = (prefix) => {
  const d = db();
  const n = d.meta.counter++;
  return `${prefix}_${String(n).padStart(4, '0')}`;
};

export function audit({ actor = 'anonymous', action, target = '', detail = {}, result = 'ok' }) {
  return mutate((d) => {
    const event = {
      id: `evt_${d.audit.length + 1}`,
      at: new Date().toISOString(),
      actor,
      action,
      target,
      result,
      detail,
    };
    d.audit.unshift(event);
    if (d.audit.length > 500) d.audit.length = 500;
    return event;
  });
}

// ---------- 资产文件 ----------
export function assetFilePath(assetId) {
  return path.join(config.paths.uploadsDir, assetId);
}

export function writeAssetFile(assetId, buffer) {
  ensureDirs();
  fs.writeFileSync(assetFilePath(assetId), buffer);
}

export function readAssetFile(assetId) {
  return fs.readFileSync(assetFilePath(assetId));
}

export { fs };
