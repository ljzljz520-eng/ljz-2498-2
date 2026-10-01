import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDirs } from './config.js';
import { db, mutate, nextId, writeAssetFile, audit } from './store.js';
import { capabilityDescriptor } from './capabilities.js';
import { sanitize, hasResidualScriptRisk } from './sanitizer.js';
import { ingestPaste } from './paste.js';
import { normalizeTree, renderBody, CURRENT_SCHEMA } from './modules.js';
import { validateDraft } from './validation.js';
import { buildExport } from './exporter.js';
import { writePreviewSvg } from './preview.js';
import { seedIfEmpty } from './seed.js';

export async function createApp() {
  ensureDirs();
  await seedIfEmpty();
  const app = express();

  app.use(express.json({ limit: '12mb' }));

  const assetMapView = () => new Map(Object.entries(db().assets));
  const getDraft = (id) => db().drafts[id];

  const requireDraft = (req, res) => {
    const draft = getDraft(req.params.id);
    if (!draft) {
      res.status(404).json({ error: 'draft-not-found', message: '草稿不存在' });
      return null;
    }
    return draft;
  };

  // ---------- 平台能力 ----------
  app.get('/api/capabilities', (req, res) => {
    res.json(capabilityDescriptor);
  });

  // ---------- 清理（粘贴预览用，不落库） ----------
  app.post('/api/sanitize', (req, res) => {
    const html = typeof req.body?.html === 'string' ? req.body.html : '';
    const result = sanitize(html);
    res.json(result);
  });

  // ---------- 粘贴摄取：服务端清理 + 拆模块 ----------
  app.post('/api/paste', async (req, res) => {
    const html = typeof req.body?.html === 'string' ? req.body.html : '';
    const result = ingestPaste(html);
    await audit({
      actor: req.body?.actor || 'anonymous',
      action: 'paste.ingest',
      detail: {
        scripts: result.report.removedScripts,
        dangerousLinks: result.report.dangerousLinks.length,
        modules: result.modules.length,
      },
      result: result.report.dangerousLinks.length ? 'flagged' : 'ok',
    });
    res.json(result);
  });

  // ---------- 草稿 ----------
  app.get('/api/drafts', (req, res) => {
    const list = Object.values(db().drafts).map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
      schemaVersion: d.schemaVersion,
      updatedAt: d.updatedAt,
      updatedBy: d.updatedBy,
      cover: d.cover || null,
      snapshotCount: (d.snapshots || []).length,
      moduleCount: (d.tree || []).length,
    }));
    res.json(list);
  });

  app.get('/api/drafts/:id', (req, res) => {
    const draft = requireDraft(req, res);
    if (!draft) return;
    res.json(draft);
  });

  // 迁移（旧草稿 -> 当前版本），不覆盖原件，返回迁移后的草稿并另存
  app.post('/api/drafts/:id/migrate', async (req, res) => {
    const original = requireDraft(req, res);
    if (!original) return;
    const normalized = normalizeTree(
      { schemaVersion: original.schemaVersion, tree: original.tree },
      {}
    );
    const extracted = normalized.migration.extractedCover || null;
    const cover = original.cover || extracted
      ? {
          coverId: original.cover?.coverId || null,
          assetId: original.cover?.assetId || extracted?.assetId || null,
          url: original.cover?.url || extracted?.url || null,
          version: original.cover?.version ?? extracted?.version ?? 0,
        }
      : null;

    const newId = nextId('drf');
    const migrated = {
      id: newId,
      title: original.title + '（迁移副本 v' + CURRENT_SCHEMA + '）',
      status: 'editing',
      schemaVersion: CURRENT_SCHEMA,
      cover,
      tree: normalized.tree,
      capabilityDiffs: normalized.capabilityDiffs,
      migrationSteps: normalized.migration.steps,
      sourceDraftId: original.id,
      snapshots: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: req.body?.actor || 'anonymous',
    };

    await mutate((d) => {
      d.drafts[newId] = migrated;
    });
    await audit({
      actor: req.body?.actor || 'anonymous',
      action: 'draft.migrate',
      target: newId,
      detail: { from: original.schemaVersion, to: CURRENT_SCHEMA, steps: normalized.migration.steps.map((s) => `${s.from}->${s.to}`) },
    });
    res.json(migrated);
  });

  // 恢复旧版本快照 -> 生成只读恢复副本
  app.post('/api/drafts/:id/snapshots/:snapshotId/restore', async (req, res) => {
    const draft = requireDraft(req, res);
    if (!draft) return;
    const snap = (draft.snapshots || []).find((s) => s.id === req.params.snapshotId);
    if (!snap) return res.status(404).json({ error: 'snapshot-not-found', message: '快照不存在' });

    const newId = nextId('drf');
    const restored = {
      ...JSON.parse(JSON.stringify(snap)),
      id: newId,
      status: 'restored-readonly',
      restoredFrom: { draftId: draft.id, snapshotId: snap.id, label: snap.label, savedAt: snap.savedAt },
      readonly: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: req.body?.actor || 'anonymous',
    };
    delete restored.snapshots;
    await mutate((d) => {
      d.drafts[newId] = restored;
    });
    await audit({
      actor: req.body?.actor || 'anonymous',
      action: 'snapshot.restore',
      target: newId,
      detail: { sourceDraft: draft.id, snapshot: snap.id },
    });
    res.json(restored);
  });

  // 保存结构化模块树（非任意 HTML）
  app.put('/api/drafts/:id', async (req, res) => {
    const draft = requireDraft(req, res);
    if (!draft) return;
    if (draft.readonly) return res.status(409).json({ error: 'draft-readonly', message: '该草稿为恢复的只读副本，不能修改' });

    const actor = req.body?.actor || 'anonymous';
    const input = req.body?.draft || req.body || {};

    // 服务端再次归一化 + 清理（不信任浏览器）
    const normalized = normalizeTree({ schemaVersion: CURRENT_SCHEMA, tree: input.tree || draft.tree });
    // 合并 capability diffs：显式保存的 + 归一化时重新发现的
    const explicit = Array.isArray(input.capabilityDiffs) ? input.capabilityDiffs : [];
    const merged = [...explicit];
    for (const d of normalized.capabilityDiffs) {
      if (!merged.some((x) => x.kind === d.kind && x.property === d.property && x.message === d.message)) merged.push(d);
    }

    let snapshot = null;
    await mutate((d) => {
      const t = d.drafts[draft.id];
      snapshot = {
        id: 'snap_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        label: input.snapshotLabel || `自动快照 ${new Date().toLocaleString('zh-CN')}`,
        savedAt: new Date().toISOString(),
        actor,
        schemaVersion: t.schemaVersion,
        title: t.title,
        cover: JSON.parse(JSON.stringify(t.cover || null)),
        tree: JSON.parse(JSON.stringify(t.tree || [])),
        capabilityDiffs: JSON.parse(JSON.stringify(t.capabilityDiffs || [])),
      };
      t.snapshots = t.snapshots || [];
      t.snapshots.unshift(snapshot);
      if (t.snapshots.length > config.limits.maxSnapshotsPerDraft) {
        t.snapshots.length = config.limits.maxSnapshotsPerDraft;
      }

      if (typeof input.title === 'string') t.title = input.title;
      t.tree = normalized.tree;
      t.capabilityDiffs = merged;
      if (input.cover !== undefined) t.cover = input.cover;
      t.updatedAt = new Date().toISOString();
      t.updatedBy = actor;
    });

    await audit({ actor, action: 'draft.save', target: draft.id, detail: { snapshotId: snapshot.id, modules: normalized.tree.length } });
    res.json({ ok: true, draft: getDraft(draft.id), snapshot });
  });

  // ---------- 封面（候选版本 + 乐观并发） ----------
  app.get('/api/covers', (req, res) => {
    res.json(Object.values(db().covers));
  });

  // 换封面：body 必须带 expectedVersion；两个编辑同时换时后到者 409
  app.post('/api/drafts/:id/cover', async (req, res) => {
    const draft = requireDraft(req, res);
    if (!draft) return;
    const { coverId, expectedVersion, actor } = req.body || {};
    const current = draft.cover || null;

    if (expectedVersion === undefined || expectedVersion === null) {
      return res.status(400).json({ error: 'version-required', message: '换封面必须携带 expectedVersion' });
    }
    if (current && Number(expectedVersion) !== Number(current.version)) {
      await audit({
        actor: actor || 'anonymous',
        action: 'cover.swap.conflict',
        target: draft.id,
        result: 'conflict',
        detail: { expected: expectedVersion, actual: current.version },
      });
      return res.status(409).json({
        error: 'cover-version-conflict',
        message: `封面已被他人更新（v${current.version}），你基于 v${expectedVersion}，请刷新后重试`,
        current,
      });
    }

    const cover = db().covers[coverId];
    if (!cover) return res.status(404).json({ error: 'cover-not-found', message: '封面候选不存在' });
    const asset = db().assets[cover.assetId];
    if (!asset || asset.status !== 'authorized') {
      await audit({ actor: actor || 'anonymous', action: 'cover.swap.denied', target: draft.id, result: 'denied', detail: { coverId, assetStatus: asset?.status } });
      return res.status(422).json({ error: 'cover-asset-unauthorized', message: '该封面资源未授权，无法使用' });
    }

    const nextVersion = (current?.version ?? 0) + 1;
    await mutate((d) => {
      const t = d.drafts[draft.id];
      t.cover = { coverId, assetId: cover.assetId, version: nextVersion };
      t.updatedAt = new Date().toISOString();
      t.updatedBy = actor || 'anonymous';
      // 同步候选库版本历史
      const c = d.covers[coverId];
      c.version += 1;
      c.updatedBy = actor || 'anonymous';
      c.updatedAt = new Date().toISOString();
      c.history = c.history || [];
      c.history.push({ version: c.version, assetId: cover.assetId, updatedBy: actor || 'anonymous', at: new Date().toISOString() });
    });
    await audit({ actor: actor || 'anonymous', action: 'cover.swap', target: draft.id, detail: { coverId, version: nextVersion } });
    res.json({ ok: true, cover: getDraft(draft.id).cover });
  });

  // ---------- 资源 ----------
  app.get('/api/assets', (req, res) => {
    const assets = Object.values(db().assets).map((a) => ({ ...a, url: `/api/assets/${a.id}/raw` }));
    res.json(assets);
  });

  app.post('/api/assets', async (req, res) => {
    const { filename, contentType, base64, sourceName, kind, width, height, dominantDark } = req.body || {};
    if (!filename || !base64) return res.status(400).json({ error: 'missing-fields', message: 'filename 与 base64 必填' });
    let buffer;
    try {
      buffer = Buffer.from(String(base64).replace(/^data:[^,]+,/, ''), 'base64');
    } catch {
      return res.status(400).json({ error: 'bad-base64', message: 'base64 解析失败' });
    }
    const id = nextId('asset');
    await mutate((d) => {
      d.assets[id] = {
        id,
        filename: String(filename).replace(/[^a-zA-Z0-9._-]/g, '_'),
        sourceName: sourceName || filename,
        kind: kind || 'image',
        contentType: contentType || 'application/octet-stream',
        width: Number(width) || null,
        height: Number(height) || null,
        dominantDark: !!dominantDark,
        size: buffer.length,
        status: 'authorized',
        createdAt: new Date().toISOString(),
      };
      writeAssetFile(id, buffer);
    });
    await audit({ actor: req.body?.actor || 'anonymous', action: 'asset.upload', target: id, detail: { size: buffer.length } });
    res.status(201).json(db().assets[id]);
  });

  // 资源授权变化（模拟授权过期/重新授权）
  app.post('/api/assets/:id/status', async (req, res) => {
    const a = db().assets[req.params.id];
    if (!a) return res.status(404).json({ error: 'asset-not-found' });
    const status = ['authorized', 'revoked', 'expired'].includes(req.body?.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ error: 'bad-status' });
    await mutate((d) => {
      d.assets[req.params.id].status = status;
      d.assets[req.params.id].revokedAt = status === 'authorized' ? null : new Date().toISOString();
    });
    await audit({ actor: req.body?.actor || 'anonymous', action: 'asset.status', target: a.id, detail: { status } });
    res.json(db().assets[a.id]);
  });

  app.get('/api/assets/:id/raw', (req, res) => {
    const a = db().assets[req.params.id];
    if (!a) return res.status(404).send('not found');
    if (a.status !== 'authorized') {
      res.set('content-type', 'image/svg+xml');
      return res.status(403).send(svgForbidden(a));
    }
    res.set('content-type', a.contentType || 'application/octet-stream');
    fs.createReadStream(path.join(config.paths.uploadsDir, a.id)).pipe(res);
  });

  // ---------- 校验 / 渲染 / 预览图 / 导出 ----------
  app.post('/api/drafts/:id/validate', (req, res) => {
    const draft = requireDraft(req, res);
    if (!draft) return;
    // 允许前端提交临时树做校验（不落库），否则用已保存版本
    let working = draft;
    if (req.body?.draft?.tree) {
      const normalized = normalizeTree({ schemaVersion: CURRENT_SCHEMA, tree: req.body.draft.tree });
      working = { ...draft, tree: normalized.tree };
    }
    const assetMap = assetMapView();
    const expectedCoverVersion = req.body?.expectedCoverVersion ?? draft.cover?.version;
    const result = validateDraft(working, {
      assets: assetMap,
      expectedCoverVersion: req.body?.checkCoverConflict ? expectedCoverVersion : undefined,
    });
    res.json(result);
  });

  app.post('/api/drafts/:id/render', (req, res) => {
    const draft = requireDraft(req, res);
    if (!draft) return;
    let working = draft;
    if (req.body?.draft?.tree) {
      working = { ...draft, tree: normalizeTree({ schemaVersion: CURRENT_SCHEMA, tree: req.body.draft.tree }).tree };
    }
    const body = renderBody(working, { resolveAsset: (id) => `/api/assets/${id}/raw` });
    res.json({ body, residualScript: hasResidualScriptRisk(body) });
  });

  app.post('/api/drafts/:id/preview-image', async (req, res) => {
    const draft = requireDraft(req, res);
    if (!draft) return;
    const assetMap = assetMapView();
    const coverAsset = draft.cover?.assetId ? assetMap.get(draft.cover.assetId) : null;
    const resolveAsset = (id) => {
      const a = assetMap.get(id);
      return a && a.status === 'authorized' ? `/api/assets/${id}/raw` : null;
    };
    const r = writePreviewSvg(draft.id, draft, { resolveAsset, coverUrl: coverAsset ? `/api/assets/${coverAsset.id}/raw` : '' });
    await audit({ actor: req.body?.actor || 'anonymous', action: 'preview.image', target: draft.id });
    res.json({ ok: true, previewUrl: `/api/previews/${draft.id}.svg?t=${Date.now()}` });
  });

  // 导出确认：服务端重新校验；有 error 一律拒绝
  app.post('/api/drafts/:id/export', async (req, res) => {
    const draft = requireDraft(req, res);
    if (!draft) return;
    const assetMap = assetMapView();
    const result = validateDraft(draft, { assets: assetMap });
    if (!result.ok) {
      await audit({ actor: req.body?.actor || 'anonymous', action: 'export.refused', target: draft.id, result: 'refused', detail: { errors: result.errorCount } });
      return res.status(422).json({ error: 'validation-failed', message: '内容校验未通过，不能进入导出', validation: result });
    }
    const coverAsset = draft.cover?.assetId ? assetMap.get(draft.cover.assetId) : null;
    const out = buildExport(draft, { assetMap, coverAsset });
    await audit({ actor: req.body?.actor || 'anonymous', action: 'export.confirmed', target: draft.id, detail: { htmlName: out.htmlName, size: out.htmlSize } });
    res.json({ ok: true, export: out, validation: result });
  });

  app.get('/api/exports/:name', (req, res) => {
    const name = path.basename(req.params.name);
    const file = path.join(config.paths.exportsDir, name);
    if (!fs.existsSync(file)) return res.status(404).send('not found');
    res.set('content-type', 'text/html; charset=utf-8');
    fs.createReadStream(file).pipe(res);
  });

  app.get('/api/previews/:name', (req, res) => {
    const name = path.basename(req.params.name);
    const file = path.join(config.paths.previewsDir, name);
    if (!fs.existsSync(file)) return res.status(404).send('not found');
    res.set('content-type', 'image/svg+xml');
    fs.createReadStream(file).pipe(res);
  });

  // ---------- 审计 ----------
  app.get('/api/audit', (req, res) => {
    res.json(db().audit.slice(0, 100));
  });

  // 生产环境静态资源（vite build 产物）
  const dist = config.paths.distDir;
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  return app;
}

function svgForbidden(asset) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="677" height="160" viewBox="0 0 677 160">
  <rect width="677" height="160" fill="#fff2f0"/>
  <rect x="16" y="16" width="645" height="128" rx="8" fill="#ffffff" stroke="#ffccc7"/>
  <text x="338" y="78" text-anchor="middle" font-size="18" fill="#cf1322" font-family="sans-serif">资源未授权（${asset.status}）：${asset.sourceName || asset.filename}</text>
  <text x="338" y="108" text-anchor="middle" font-size="13" fill="#999" font-family="sans-serif">授权变化后请替换或重新授权</text>
</svg>`;
}
