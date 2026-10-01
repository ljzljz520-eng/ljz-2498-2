import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, recoverLegacyDraft, SCHEMA_VERSION } from '../server/module-tree.js';
import { renderControlledHtml, renderBody } from '../server/controlled-html.js';
import { assertFormalHtmlSafe } from '../server/validator.js';
import { sanitizePipeline } from '../server/sanitizer.js';

test('v1 任意 HTML 草稿迁移到 v2 模块树，旧封面 URL 不静默映射', () => {
  const v1 = { schemaVersion: 1, title: '旧文', bodyHtml: '<p>hello</p>', coverUrl: 'http://x/c.jpg' };
  const v2 = migrate(v1);
  assert.equal(v2.schemaVersion, 2);
  assert.equal(v2.modules.length, 1);
  assert.equal(v2.modules[0].type, 'html-block');
  assert.equal(v2.coverId, null);
  assert.equal(v2.legacyCoverUrl, 'http://x/c.jpg');
  assert.equal(v2.migrated, true);
});

test('recoverLegacyDraft 使用已清理 HTML，脚本不进入迁移结果', () => {
  const { clean } = sanitizePipeline('<script>bad()</script><p style="z-index:2">正文</p>');
  const doc = recoverLegacyDraft({ title: '恢复', cleanHtml: clean });
  assert.equal(doc.schemaVersion, SCHEMA_VERSION);
  assert.ok(!doc.modules[0].props.html.includes('<script'));
  assert.ok(doc.modules[0].props.html.includes('正文'));
});

test('幂等迁移：已是最新版本的数据结构不变', () => {
  const cur = { schemaVersion: 2, title: 't', coverId: null, modules: [{ id: 'm1', type: 'paragraph', props: { text: 'a' } }] };
  const again = migrate(cur);
  assert.equal(again.modules.length, 1);
  assert.equal(again.modules[0].id, 'm1');
});

test('受控渲染：结构化文本被转义、链接协议过滤、无脚本', () => {
  const doc = {
    schemaVersion: 2, title: 'T&<x>', coverId: null,
    modules: [
      { id: 'm1', type: 'paragraph', props: { text: '<b>原始尖括号</b>' } },
      { id: 'm2', type: 'html-block', props: { html: '<p>safe</p>' } },
    ],
  };
  const html = renderControlledHtml(doc, { viewport: 'phone' });
  assert.ok(html.includes('&lt;b&gt;原始尖括号&lt;/b&gt;'));
  assert.ok(!/<script/i.test(html));
  assertFormalHtmlSafe(html);
});

test('正式预览断言：html-block 若藏脚本直接抛错（纵深防御）', () => {
  const doc = { title: 't', modules: [{ id: 'm', type: 'html-block', props: { html: '<script>x</script>' } }] };
  assert.throws(() => renderBody(doc), /安全断言失败/);
});

test('桌面与手机渲染同一份模块树、同一份清理内容，仅容器宽度不同', () => {
  const doc = { title: 't', coverId: null, modules: [{ id: 'm', type: 'paragraph', props: { text: '同一段' } }] };
  const phone = renderControlledHtml(doc, { viewport: 'phone' });
  const desktop = renderControlledHtml(doc, { viewport: 'desktop' });
  assert.ok(phone.includes('同一段'));
  assert.ok(desktop.includes('同一段'));
  assert.ok(phone.includes('max-width:100%'));
  assert.ok(desktop.includes('max-width:677px'));
});
