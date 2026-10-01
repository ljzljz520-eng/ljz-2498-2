import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePipeline } from '../server/sanitizer.js';
import { styleCapability, ALLOWED_URL_PROTOCOLS, PLATFORM } from '../server/platform-capabilities.js';
import { readPngMeta, colorLuminance } from '../server/image-meta.js';
import { makePng } from './helpers.js';

test('平台能力是公众号配置：不沿用邮件客户端规则', () => {
  assert.equal(PLATFORM.id, 'wechat-mp-article');
  assert.match(PLATFORM.disclaimer, /不承诺像素/);
  // 公众号允许 section/内联样式；邮件规则通常剥离它们
  assert.ok(styleCapability('padding').supported);
  assert.ok(styleCapability('border-radius').supported);
  // 不支持的样式给出明确原因，而不是静默丢弃
  const cap = styleCapability('position');
  assert.equal(cap.supported, false);
  assert.match(cap.reason, /position/);
  assert.equal(styleCapability('animation').supported, false);
});

test('危险链接协议被拦截并报告，http/https/mailto/tel 放行', () => {
  const { clean, report } = sanitizePipeline(
    '<a href="javascript:alert(1)">x</a>' +
    '<a href="vbscript:msgbox(1)">y</a>' +
    '<a href="//evil.com">z</a>' +
    '<a href="https://example.com">ok</a>' +
    '<a href="mailto:a@b.com">m</a>',
  );
  assert.ok(!/javascript:|vbscript:/.test(clean));
  assert.ok(!clean.includes('//evil.com'));
  assert.ok(clean.includes('https://example.com'));
  assert.ok(clean.includes('mailto:a@b.com'));
  assert.ok(report.blockedLinks.length >= 3);
  assert.ok(report.hadScript);
});

test('script/iframe/style 块、事件属性、expression 全部移除', () => {
  const dirty = '<div onmouseover="x()" style="color:red;position:fixed;animation:a 1s">' +
    '<script>alert(1)</script><iframe src="https://x"></iframe>' +
    '<style>.a{}</style><p style="width:expression(alert(1))">t</p></div>';
  const { clean, report } = sanitizePipeline(dirty);
  assert.ok(!/onmouseover|<script|<iframe|<style/i.test(clean));
  assert.ok(!clean.includes('expression'));
  assert.ok(!clean.includes('position'));
  assert.ok(!clean.includes('animation'));
  assert.ok(clean.includes('color: red') || clean.includes('color:red'));
  assert.ok(report.hadScript);
  assert.ok(report.unsupportedStyles.some((s) => s.prop === 'position'));
});

test('浏览器预览与导出使用同一清理版（管道确定性）', () => {
  const dirty = '<p style="color:red;z-index:9">hi <strong>there</strong></p>';
  const a = sanitizePipeline(dirty);
  const b = sanitizePipeline(dirty);
  assert.equal(a.clean, b.clean);
  assert.ok(a.clean.includes('color'));
  assert.ok(!a.clean.includes('z-index'));
});

test('PNG 解析：尺寸与暗色/亮色平均亮度', () => {
  const black = readPngMeta(makePng(8, 8, [10, 10, 10]));
  const white = readPngMeta(makePng(8, 8, [245, 245, 245]));
  assert.deepEqual([black.width, black.height], [8, 8]);
  assert.ok(black.avgLuminance < 0.1);
  assert.ok(white.avgLuminance > 0.9);
  assert.ok(Math.abs(colorLuminance('#111111') - 0.067) < 0.02);
});
