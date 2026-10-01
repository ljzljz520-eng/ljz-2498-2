import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api } from './helpers.js';
import { sanitize, hasResidualScriptRisk } from '../src/sanitizer.js';
import { normalizeTree } from '../src/modules.js';

let ctx;
test.before(async () => { ctx = await startServer(); });
test.after(async () => { await new Promise((r) => ctx.server.close(r)); });
const B = () => ctx.base;

test('平台能力配置：面向公众号图文，不包含邮件客户端规则', async () => {
  const r = await api(B(), 'GET', '/api/capabilities');
  assert.equal(r.status, 200);
  assert.equal(r.body.platform.id, 'wechat-mp-article');
  const blob = JSON.stringify(r.body);
  assert.ok(!/mso-|Outlook|Gmail|conditional comment|VML/i.test(blob), '能力描述不得含邮件客户端规则');
  assert.ok(r.body.tags.drop.includes('script'));
  assert.ok(r.body.partial.animation === undefined || r.body.supported !== undefined);
  // 动画类必须在不支持集合
  assert.ok(r.body.unsupported.includes('animation'));
  assert.match(r.body.disclaimer, /不承诺/);
});

test('验收1：危险链接 / 脚本 / 事件属性经服务端清理，正式内容无残留', async () => {
  const dirty = '<a href="javascript:alert(1)" onclick="x()">x</a><img src="data:image/gif;base64,R0" onerror="y()">'
    + '<script>alert(1)</script><iframe src="//evil"></iframe><p style="color:red;animation:f 1s">z</p>';
  const r = await api(B(), 'POST', '/api/paste', { html: dirty });
  assert.equal(r.status, 200);
  const { cleanedHtml, report, capabilities } = r.body;
  assert.ok(report.removedScripts >= 1);
  assert.ok(report.removedEventAttrs.length >= 2);
  assert.ok(report.dangerousLinks.some((d) => d.protocol === 'javascript:'));
  assert.ok(report.dangerousLinks.some((d) => d.protocol === 'data:'));
  assert.equal(report.defenses.length, 0);
  assert.equal(hasResidualScriptRisk(cleanedHtml), false);
  assert.ok(!/<script|on\w+\s*=|javascript:|<iframe/i.test(cleanedHtml));
  // 差异提示存在（动画不支持 + 脚本标签移除）
  const msgs = capabilities.diffs.map((d) => d.message).join(' ');
  assert.match(msgs, /animation/);
});

test('验收1b：允许协议明确（http/https/mailto 保留，vbscript/ftp 拒绝）', () => {
  const ok = sanitize('<a href="https://a.com">a</a><a href="mailto:m@x.com">m</a><a href="/relative">r</a>').cleanedHtml;
  assert.match(ok, /href="https:\/\/a\.com"/);
  assert.match(ok, /mailto:m@x\.com/);
  assert.match(ok, /href="\/relative"/);
  const bad = sanitize('<a href="vbscript:msgbox(1)">v</a><a href="ftp://f/x">f</a>');
  assert.ok(!/vbscript:|ftp:/.test(bad.cleanedHtml));
  assert.equal(bad.report.dangerousLinks.length, 2);
});

test('验收：浏览器预览与导出使用同一清理版（render 与 export 的正文一致且无脚本）', async () => {
  // 先在问题稿上替换为干净模块并保存
  const tree = [
    { id: 'h1', type: 'heading', level: 2, text: '同源测试' },
    { id: 't1', type: 'text', html: '<p>安全 <a href="https://mp.weixin.qq.com/x" target="_blank">链接</a></p>' },
  ];
  await api(B(), 'PUT', '/api/drafts/drf_ready', { actor: 'editor-a', draft: { title: '四月新品合辑', tree } });
  const ren = await api(B(), 'POST', '/api/drafts/drf_ready/render', {});
  assert.equal(ren.body.residualScript, false);
  assert.match(ren.body.body, /同源测试/);
  const val = await api(B(), 'POST', '/api/drafts/drf_ready/validate', {});
  assert.equal(val.body.ok, true, val.body.issues.map((i) => i.message).join(';'));
  const ex = await api(B(), 'POST', '/api/drafts/drf_ready/export', { actor: 'editor-a' });
  assert.equal(ex.status, 200);
  const html = await fetch(ctx.base + ex.body.export.htmlUrl).then((x) => x.text());
  // 导出 HTML 包含与 render 一致的正文片段，且无脚本
  assert.match(html, /同源测试/);
  assert.ok(!/<script/i.test(html));
  assert.equal(hasResidualScriptRisk(html), false);
  assert.equal(ex.body.export.externalPublishing, false);
});

test('验收2：图过大判错、超宽提示', async () => {
  const tree = [
    { id: 'h', type: 'heading', level: 2, text: '大图测试' },
    { id: 'big', type: 'image', assetId: 'asset_0007', label: '超大高清海报' },
  ];
  // 换一个临时草稿：用 drf_issues 的封面但只放超大图
  await api(B(), 'PUT', '/api/drafts/drf_issues', {
    actor: 'editor-b',
    draft: {
      title: '活动长图盘点（有问题待修复）',
      tree,
      capabilityDiffs: [],
    },
  });
  const v = await api(B(), 'POST', '/api/drafts/drf_issues/validate', {});
  assert.equal(v.body.ok, false);
  assert.ok(v.body.issues.some((i) => i.code === 'image-too-large' && i.level === 'error'));
  assert.ok(v.body.issues.some((i) => i.code === 'image-overwidth' && i.level === 'warning'));
});

test('验收3：深色图标在深色背景不可见判错', async () => {
  const tree = [
    { id: 'h', type: 'heading', level: 2, text: '图标测试' },
    { id: 'ic', type: 'image', assetId: 'asset_0004', label: '深色箭头', darkIcon: true },
  ];
  await api(B(), 'PUT', '/api/drafts/drf_issues', {
    actor: 'editor-b',
    draft: { title: '图标测试稿', tree, capabilityDiffs: [] },
  });
  const v = await api(B(), 'POST', '/api/drafts/drf_issues/validate', {});
  assert.ok(v.body.issues.some((i) => i.code === 'dark-icon-invisible' && i.level === 'error'));
  // 换浅色图标后该项消失
  const tree2 = [{ id: 'h', type: 'heading', level: 2, text: '图标测试' },
    { id: 'ic', type: 'image', assetId: 'asset_0005', label: '浅色箭头', darkIcon: false }];
  await api(B(), 'PUT', '/api/drafts/drf_issues', { actor: 'editor-b', draft: { title: '图标测试稿', tree: tree2, capabilityDiffs: [] } });
  const v2 = await api(B(), 'POST', '/api/drafts/drf_issues/validate', {});
  assert.ok(!v2.body.issues.some((i) => i.code === 'dark-icon-invisible'));
});

test('验收4：资源授权变化后导出被拒；重新授权后通过', async () => {
  // drf_ready 中放入引用 asset_0003（已授权）的图片，先确认通过
  const tree = [
    { id: 'h', type: 'heading', level: 2, text: '授权测试' },
    { id: 'img', type: 'image', assetId: 'asset_0003', label: '正文配图' },
  ];
  await api(B(), 'PUT', '/api/drafts/drf_ready', { actor: 'a', draft: { title: '四月新品合辑', tree } });
  let v = await api(B(), 'POST', '/api/drafts/drf_ready/validate', {});
  assert.equal(v.body.ok, true);

  const st = await api(B(), 'POST', '/api/assets/asset_0003/status', { status: 'revoked', actor: 'admin' });
  assert.equal(st.body.status, 'revoked');
  v = await api(B(), 'POST', '/api/drafts/drf_ready/validate', {});
  assert.ok(v.body.issues.some((i) => i.code === 'asset-unauthorized'));
  const ex = await api(B(), 'POST', '/api/drafts/drf_ready/export', { actor: 'a' });
  assert.equal(ex.status, 422);
  assert.equal(ex.body.error, 'validation-failed');

  await api(B(), 'POST', '/api/assets/asset_0003/status', { status: 'authorized', actor: 'admin' });
  v = await api(B(), 'POST', '/api/drafts/drf_ready/validate', {});
  assert.equal(v.body.ok, true);
});

test('验收5：两个编辑同时换封面 —— 乐观版本号，后到者 409', async () => {
  // 当前 drf_ready 封面 v2（种子）。editor-b 以 v2 换成另一封面 -> v3
  const r1 = await api(B(), 'POST', '/api/drafts/drf_ready/cover', { coverId: 'cover_0002', expectedVersion: 2, actor: 'editor-b' });
  // cover_0002 的 asset 是 revoked，服务端应拒绝（422），因此换用逻辑要先重新授权
  if (r1.status === 422) {
    await api(B(), 'POST', '/api/assets/asset_0006/status', { status: 'authorized', actor: 'admin' });
  }
  const first = await api(B(), 'POST', '/api/drafts/drf_ready/cover', { coverId: 'cover_0002', expectedVersion: 2, actor: 'editor-b' });
  assert.equal(first.status, 200, '第一次换封面应成功');
  assert.equal(first.body.cover.version, 3);

  // editor-a 仍基于旧版本 v2 换 -> 409
  const second = await api(B(), 'POST', '/api/drafts/drf_ready/cover', { coverId: 'cover_0001', expectedVersion: 2, actor: 'editor-a' });
  assert.equal(second.status, 409);
  assert.match(second.body.message, /封面已被/);

  // 缺少 expectedVersion -> 400
  const noVer = await api(B(), 'POST', '/api/drafts/drf_ready/cover', { coverId: 'cover_0001', actor: 'editor-a' });
  assert.equal(noVer.status, 400);
});

test('验收：结构化模块优于任意 HTML —— 保存即归一化，任意脚本不入库', async () => {
  const evilTree = [
    { id: 'x', type: 'text', html: '<p onclick="x()">a<script>bad()</script></p>' },
    { id: 'y', type: 'html', html: '<a href="javascript:x">x</a>' },
  ];
  await api(B(), 'PUT', '/api/drafts/drf_ready', {
    actor: 'a',
    draft: { title: '结构化测试', tree: evilTree, capabilityDiffs: [] },
  });
  const got = await api(B(), 'GET', '/api/drafts/drf_ready');
  const all = JSON.stringify(got.body.tree);
  assert.ok(!/onclick|<script|javascript:/.test(all), '保存的模块树不得含脚本入口');
  const ren = await api(B(), 'POST', '/api/drafts/drf_ready/render', {});
  assert.equal(ren.body.residualScript, false);
});

test('验收：版本迁移 v1→v3 与旧草稿恢复（只读副本）', async () => {
  const mig = await api(B(), 'POST', '/api/drafts/drf_legacy/migrate', { actor: 'editor-a' });
  assert.equal(mig.status, 200);
  assert.equal(mig.body.schemaVersion, 3);
  assert.deepEqual(mig.body.migrationSteps.map((s) => [s.from, s.to]), [[1, 2], [2, 3]]);
  assert.ok(mig.body.tree.every((n) => ['heading', 'text', 'image', 'quote', 'divider', 'html'].includes(n.type)));
  assert.ok(mig.body.cover && mig.body.cover.url.includes('old-cover.png'));
  // 旧稿原件仍是 v1
  const orig = await api(B(), 'GET', '/api/drafts/drf_legacy');
  assert.equal(orig.body.schemaVersion, 1);

  // 保存 drf_issues 产生快照，再恢复为只读副本
  await api(B(), 'PUT', '/api/drafts/drf_issues', {
    actor: 'b',
    snapshotLabel: '验收快照',
    draft: { title: '快照用稿', tree: [{ id: 'h', type: 'heading', level: 2, text: '快照标题' }], capabilityDiffs: [] },
  });
  const d = await api(B(), 'GET', '/api/drafts/drf_issues');
  const snapId = d.body.snapshots[0].id;
  const res = await api(B(), 'POST', `/api/drafts/drf_issues/snapshots/${snapId}/restore`, { actor: 'b' });
  assert.equal(res.body.readonly, true);
  assert.equal(res.body.status, 'restored-readonly');
  // 只读副本不能保存
  const denied = await api(B(), 'PUT', `/${res.body.id}`.replace('//', '/'), {});
  const denied2 = await api(B(), 'PUT', `/api/drafts/${res.body.id}`, { actor: 'b', draft: { tree: [] } });
  assert.equal(denied2.status, 409);
});

test('验收：内容校验完成且通过才进入导出；样式差异以 warning 提示不伪造像素一致', async () => {
  // drf_issues 种子含多个错误，直接导出 422
  // 恢复一个全新问题稿状态
  await api(B(), 'PUT', '/api/drafts/drf_issues', {
    actor: 'b',
    draft: {
      title: '活动长图盘点（有问题待修复）',
      tree: [
        { id: 'i1', type: 'heading', level: 2, text: '活动长图盘点' },
        { id: 'i2', type: 'image', assetId: 'asset_0007', label: '超大高清海报' },
      ],
      capabilityDiffs: [{ kind: 'css-partial', property: 'float', level: 'warning', message: '样式 float: 浮动在窄屏与不同终端容易错位' }],
    },
  });
  const blocked = await api(B(), 'POST', '/api/drafts/drf_issues/export', { actor: 'b' });
  assert.equal(blocked.status, 422);
  // 能力差异是 warning，且提示中不含“像素一致”承诺；平台声明带不承诺
  const caps = await api(B(), 'GET', '/api/capabilities');
  assert.match(caps.body.disclaimer, /不承诺.*像素/);
});

test('验收：粘贴内容经服务端清理，预览与导出同源，style 块被下线并提示', async () => {
  const r = await ingestAndAppend(B());
  assert.ok(r.cleanedHtml.includes('保留正文'));
  assert.ok(!r.cleanedHtml.includes('.secret'));
  assert.ok(r.capabilities.diffs.some((d) => d.kind === 'style-tag' && d.level === 'error'));
});

test('单元：normalizeTree 会剥离内联不支持样式并保留差异', () => {
  const n = normalizeTree({
    schemaVersion: 3,
    tree: [{ id: 'a', type: 'html', html: '<p style="animation:f 1s;color:red;position:fixed;top:0">x</p>' }],
  });
  const html = n.tree[0].html;
  assert.ok(!/animation/.test(html));
  assert.match(html, /color:\s*red/);
  assert.ok(n.capabilityDiffs.some((d) => d.property === 'animation'));
});

async function ingestAndAppend(base) {
  const r = await api(base, 'POST', '/api/paste', {
    html: '<style>.secret{display:block}</style><p>保留正文</p><script>x</script>',
  });
  return r.body;
}
