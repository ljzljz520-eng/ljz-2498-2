/**
 * Express API + 静态托管 Vite 构建产物。
 * 所有写接口以 X-Editor-Id 标识编辑者（两个编辑同时换封面的验收场景）。
 */
import express from 'express';
import { getDb } from './db.js';
import {
  createDocument, getDocument, saveDocument, listVersions, getVersion, restoreVersion,
  acquireCoverLock, releaseCoverLock, addCoverCandidate, listCoverCandidates, selectCover,
  preflight, confirmExport, getExportJob, previewHtml, ConflictError, NotFoundError,
} from './services.js';
import { uploadAsset, getAsset, listAssets, setAuthorization, AssetError } from './assets.js';
import { sanitizePipeline } from './sanitizer.js';
import { migrate, recoverLegacyDraft, SCHEMA_VERSION } from './module-tree.js';
import { BREAKPOINTS, PLATFORM } from './platform-capabilities.js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '6mb' }));

const editorOf = (req) => req.header('x-editor-id') || 'anon';
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------- 平台能力（前端据此渲染差异提示，不允许承诺像素一致） ---------- */
app.get('/api/capabilities', (req, res) => {
  res.json({ platform: PLATFORM, breakpoints: BREAKPOINTS });
});

/* ---------- 粘贴内容清理：浏览器预览与导出共用这一份 ---------- */
app.post('/api/sanitize', (req, res) => {
  const { clean, report } = sanitizePipeline(req.body?.html || '');
  res.json({ clean, report });
});

/* ---------- 素材 ---------- */
app.post('/api/assets', wrap(async (req, res) => {
  const { filename, mimeType, kind, base64 } = req.body || {};
  if (!base64) throw new AssetError('缺少 base64 文件内容');
  const buf = Buffer.from(String(base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
  const asset = uploadAsset(buf, { filename: filename || 'pasted', mimeType, kind, editorId: editorOf(req) });
  res.status(201).json(asset);
}));
app.get('/api/assets', (req, res) => res.json(listAssets(req.query.kind)));
app.get('/api/assets/:id', (req, res) => {
  const a = getAsset(req.params.id);
  if (!a) return res.status(404).json({ error: '资源不存在' });
  res.json(a);
});
app.get('/api/assets/:id/raw', (req, res) => {
  const a = getAsset(req.params.id);
  if (!a || !a.storage_path || !existsSync(a.storage_path)) return res.status(404).end();
  if (!a.authorized) return res.status(403).json({ error: `资源授权已变化：${a.auth_note || '未授权'}` });
  res.setHeader('content-type', a.mime_type);
  res.send(readFileSync(a.storage_path));
});
app.post('/api/assets/:id/authorization', (req, res) => {
  const a = setAuthorization(req.params.id, !!req.body.authorized, req.body.note || '');
  res.json(a);
});

/* ---------- 文档与模块树版本 ---------- */
app.post('/api/documents', wrap(async (req, res) => {
  const doc = createDocument({ title: req.body?.title, editorId: editorOf(req) });
  res.status(201).json(doc);
}));
app.get('/api/documents/:id', wrap(async (req, res) => {
  const doc = getDocument(req.params.id);
  if (!doc) throw new NotFoundError('文档不存在');
  res.json(doc);
}));
app.put('/api/documents/:id', wrap(async (req, res) => {
  const result = saveDocument(req.params.id, req.body, { editorId: editorOf(req), label: req.body?._label });
  res.json(result);
}));
app.get('/api/documents/:id/versions', wrap(async (req, res) => res.json(listVersions(req.params.id))));
app.get('/api/documents/:id/versions/:version', wrap(async (req, res) => {
  const v = getVersion(req.params.id, Number(req.params.version));
  if (!v) throw new NotFoundError('版本不存在');
  res.json(v);
}));
app.post('/api/documents/:id/versions/:version/restore', wrap(async (req, res) => {
  const result = restoreVersion(req.params.id, Number(req.params.version), { editorId: editorOf(req) });
  res.json(result);
}));

/* ---------- 旧草稿恢复（v1 任意 HTML 草稿 -> v2 模块树） ---------- */
app.post('/api/documents/legacy/recover', wrap(async (req, res) => {
  const { title, html } = req.body || {};
  const { clean, report } = sanitizePipeline(html || ''); // 旧草稿也必须先清理
  const tree = recoverLegacyDraft({ title: title || '恢复的旧草稿', cleanHtml: clean });
  const doc = createDocument({ title: tree.title, editorId: editorOf(req) });
  const saved = saveDocument(doc.id, tree, { editorId: editorOf(req), label: '旧草稿迁移恢复' });
  res.status(201).json({ ...saved, sanitizeReport: report });
}));

/* ---------- 封面：锁/候选/选定 ---------- */
app.post('/api/documents/:id/cover/lock', wrap(async (req, res) => {
  res.json(acquireCoverLock(req.params.id, editorOf(req)));
}));
app.delete('/api/documents/:id/cover/lock', wrap(async (req, res) => {
  res.json(releaseCoverLock(req.params.id, editorOf(req)));
}));
app.post('/api/documents/:id/cover/candidates', wrap(async (req, res) => {
  const c = addCoverCandidate(req.params.id, req.body.assetId, { editorId: editorOf(req), label: req.body.label });
  res.status(201).json(c);
}));
app.get('/api/documents/:id/cover/candidates', wrap(async (req, res) => res.json(listCoverCandidates(req.params.id))));
app.post('/api/documents/:id/cover/select', wrap(async (req, res) => {
  const doc = selectCover(req.params.id, req.body.assetId, {
    editorId: editorOf(req),
    expectedVersion: req.body.expectedVersion,
    candidateId: req.body.candidateId,
  });
  res.json(doc);
}));

/* ---------- 校验 → 导出确认 → 后台生成 ---------- */
app.get('/api/documents/:id/preflight', wrap(async (req, res) => res.json(preflight(req.params.id))));
app.post('/api/documents/:id/export', wrap(async (req, res) => {
  const result = await confirmExport(req.params.id, {
    editorId: editorOf(req),
    warningAck: req.body?.warningAck || [],
  });
  res.status(201).json({ ...result, controlledHtml: undefined, phonePngBase64: undefined });
}));
app.get('/api/exports/:jobId', wrap(async (req, res) => {
  const job = getExportJob(req.params.jobId);
  if (!job) throw new NotFoundError('导出任务不存在');
  res.json(job);
}));

/* ---------- 受控预览（正式预览：断言无脚本） ---------- */
app.get('/api/documents/:id/preview/:viewport', wrap(async (req, res) => {
  const vp = req.params.viewport === 'desktop' ? 'desktop' : 'phone';
  const out = previewHtml(req.params.id, vp);
  res.json(out);
}));

/* ---------- 错误处理（必须在所有路由之后注册） ---------- */
app.use((err, req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message, details: err.details || null });
});

/* ---------- 构建产物静态托管 ---------- */
const dist = resolve(__dirname, '../dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(resolve(dist, 'index.html')));
}

const port = process.env.PORT || 5174;
if (process.env.NODE_ENV !== 'test') {
  getDb();
  app.listen(port, () => console.log(`公众号图文预览台 API: http://localhost:${port}`));
}
export { app };
