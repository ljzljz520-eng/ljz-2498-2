import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makePng } from './helpers.js';
import {
  createDocument, saveDocument, preflight, confirmExport,
  acquireCoverLock, selectCover, addCoverCandidate, restoreVersion, getDocument, ConflictError,
} from '../server/services.js';
import { uploadAsset, setAuthorization } from '../server/assets.js';

before(() => freshDb());

function imageModule(assetId, extra = {}) {
  return { id: 'mod_' + Math.random().toString(36).slice(2, 10), type: 'image', props: { assetId, ...extra }, schemaVersion: 2 };
}
async function makeDocWith(modules, title = '验收文档') {
  let d = createDocument({ title, editorId: 'u1' });
  const r = saveDocument(d.id, { title, schemaVersion: 2, coverId: null, modules }, { editorId: 'u1' });
  return r.doc;
}

test('验收1：危险链接在导出前阻断（正式预览不含未清理脚本）', async () => {
  // html-block 的内容由 saveDocument 走服务端清理，javascript: 链接会被移除并记入 report
  const doc = await makeDocWith([{
    id: 'm_paste', type: 'html-block',
    props: { html: '<a href="javascript:alert(1)">领取</a><p>正文</p>' },
  }]);
  const { validation } = preflight(doc.id);
  // 清理已拦截危险链接 -> blockedLinks 进 report -> 校验出现 blocked-link error
  assert.ok(validation.checks.length >= 4); // 所有规则均执行
  assert.ok(validation.errors.some((e) => e.code === 'blocked-link'),
    '应报告 blocked-link: ' + JSON.stringify(validation.errors));
  await assert.rejects(() => confirmExport(doc.id, {}), /阻断性校验问题/);

  // 正常内容可通过且正式 HTML 无脚本
  const d2 = await makeDocWith([{ id: 'm_ok', type: 'paragraph', props: { text: '一篇安全文章' } }]);
  const pf2 = preflight(d2.id);
  assert.equal(pf2.validation.ok, true);
  const job = await confirmExport(d2.id, {});
  assert.equal(job.publishedExternally, false);
  assert.ok(job.controlledHtml.includes('一篇安全文章'));
  assert.ok(!/<script/i.test(job.controlledHtml));
});

test('验收2：图过大阻断导出', async () => {
  // 草稿阶段允许登记大图，但导出校验必须阻断；这里用小尺寸 PNG + 放大字节记录模拟
  const asset = uploadAsset(makePng(4, 4, [100, 100, 100]),
    { filename: 'huge.png', mimeType: 'image/png', kind: 'image', editorId: 'u1' });
  const { getDb } = await import('../server/db.js');
  getDb().prepare('UPDATE assets SET bytes=? WHERE id=?').run(3 * 1024 * 1024, asset.id);

  const doc = await makeDocWith([imageModule(asset.id)]);
  const { validation } = preflight(doc.id);
  assert.ok(validation.errors.some((e) => e.code === 'image-too-large'));
});

test('验收3：暗色图标在暗色背景不可见 -> warning，知悉后可导出', async () => {
  const darkIcon = uploadAsset(makePng(8, 8, [20, 20, 30]),
    { filename: 'dark.png', mimeType: 'image/png', kind: 'icon', editorId: 'u1' });
  const doc = await makeDocWith([imageModule(darkIcon.id, { containerBg: '#141414' })]);
  const v = preflight(doc.id).validation;
  assert.ok(v.warnings.some((x) => x.code === 'icon-invisible-dark'),
    '应警告暗色图标不可见: ' + JSON.stringify(v.warnings));

  // 未确认 warning 不能导出
  await assert.rejects(() => confirmExport(doc.id, { warningAck: [] }), /未全部确认/);
  // 知悉（传入等量 ack）后允许
  const job = await confirmExport(doc.id, { warningAck: v.warnings.map((w) => w.code) });
  assert.equal(job.status, 'generated');
});

test('验收4：资源授权变化（撤回）-> error 阻断，恢复后通过', async () => {
  const a = uploadAsset(makePng(8, 8, [200, 100, 50]),
    { filename: 'licensed.png', mimeType: 'image/png', kind: 'image', editorId: 'u1' });
  const doc = await makeDocWith([imageModule(a.id)]);
  assert.equal(preflight(doc.id).validation.ok, true);

  setAuthorization(a.id, false, '版权方撤回授权');
  const v = preflight(doc.id).validation;
  assert.ok(v.errors.some((e) => e.code === 'asset-unauthorized'));
  await assert.rejects(() => confirmExport(doc.id, {}), /阻断性校验问题/);

  setAuthorization(a.id, true, '已续约');
  assert.equal(preflight(doc.id).validation.ok, true);
});

test('验收5：两个编辑同时换封面 —— 锁互斥 + 乐观版本冲突', async () => {
  const doc = createDocument({ title: '封面冲突', editorId: 'alice' });
  const c1 = uploadAsset(makePng(16, 8, [255, 0, 0]), { filename: 'c1.png', mimeType: 'image/png', kind: 'cover', editorId: 'alice' });
  const c2 = uploadAsset(makePng(16, 8, [0, 0, 255]), { filename: 'c2.png', mimeType: 'image/png', kind: 'cover', editorId: 'bob' });

  // Alice 先拿锁；Bob 拿锁被拒
  acquireCoverLock(doc.id, 'alice');
  assert.throws(() => acquireCoverLock(doc.id, 'bob'), (e) => e instanceof ConflictError && /另一位编辑/.test(e.message));

  // Alice 基于 v1 换封面成功（锁释放）
  const updated = selectCover(doc.id, c1.id, { editorId: 'alice', expectedVersion: 1 });
  assert.equal(updated.coverId, c1.id);
  assert.equal(updated.currentVersion, 2);

  // Bob 持有过期视图 expectedVersion=1 -> 乐观并发拒绝
  assert.throws(
    () => selectCover(doc.id, c2.id, { editorId: 'bob', expectedVersion: 1 }),
    (e) => e instanceof ConflictError && /已被他人更新/.test(e.message),
  );
  // Bob 刷新后基于 v2 成功
  const again = selectCover(doc.id, c2.id, { editorId: 'bob', expectedVersion: 2 });
  assert.equal(again.coverId, c2.id);
});

test('验收6：旧草稿可恢复为候选版本，内容走清理且历史保留', async () => {
  const doc = createDocument({ title: '演进文档', editorId: 'u1' });
  saveDocument(doc.id, {
    title: '演进文档', schemaVersion: 2, coverId: null,
    modules: [{ id: 'm1', type: 'paragraph', props: { text: '第二版内容' } }],
  }, { editorId: 'u1', label: 'v2 编辑' });
  // 回滚到 v1
  const restored = restoreVersion(doc.id, 1, { editorId: 'u1' });
  assert.ok(restored.doc.modules.length === 0); // v1 是空文档
  // 回滚成为 v3，历史仍在
  const live = getDocument(doc.id);
  assert.equal(live.currentVersion, 3);
});

test('校验全部规则一次性执行完（不因首个错误短路）', async () => {
  const big = uploadAsset(makePng(4, 4, [1, 1, 1]), { filename: 'b.png', mimeType: 'image/png', kind: 'image' });
  const { getDb } = await import('../server/db.js');
  getDb().prepare('UPDATE assets SET bytes=? WHERE id=?').run(5 * 1024 * 1024, big.id);
  setAuthorization(big.id, false, '同时也撤回');
  const doc = await makeDocWith([
    imageModule(big.id, { containerBg: '#111111' }),
    { id: 'paste', type: 'html-block', props: { html: '<a href="javascript:x">x</a>' } },
  ]);
  const v = preflight(doc.id).validation;
  const codes = new Set(v.errors.map((e) => e.code));
  assert.ok(codes.has('asset-unauthorized'));
  assert.ok(codes.has('blocked-link'));
  // 超大资源未授权时以 missing/unauthorized 优先，至少保证多类问题同时被收集
  assert.ok(v.checks.includes('links-scanned') && v.checks.includes('cover-checked'));
});

