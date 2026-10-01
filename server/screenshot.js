/**
 * 预览图生成（后台）。
 * - 优先使用 Puppeteer 真实渲染受控 HTML 截图；
 * - 环境无 Chromium 时降级为内置 SVG 占位渲染，并在返回中标记 renderer: 'svg-fallback'，
 *   明确告知用户这不是像素级截图（与平台能力配置的免责声明一致）。
 */
let puppeteer = null;
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  puppeteer = null;
}

async function renderPuppeteer(html, { width, height }) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.screenshot({ type: 'png', fullPage: true });
  } finally {
    await browser.close();
  }
}

function escapeXml(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** 无浏览器时的降级图：手机/桌面外框 + 纯文本内容摘要（仅用于流程占位） */
function renderSvgFallback(doc, { width, height, label }) {
  const text = (doc.modules || [])
    .map((m) => {
      const p = m.props || {};
      return p.text || (m.type === 'html-block' ? '[富文本内容块（已清理）]' : `[${m.type}]`);
    })
    .join('\n');
  const lines = escapeXml(text).split('\n').slice(0, 18);
  const body = lines
    .map((l, i) => `<text x="20" y="${90 + i * 26}" font-size="14" fill="#333" font-family="sans-serif">${l}</text>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<rect width="100%" height="100%" fill="#f2f2f2"/>
<rect x="8" y="8" width="${width - 16}" height="${height - 16}" rx="12" fill="#ffffff" stroke="#ccc"/>
<text x="20" y="40" font-size="15" font-weight="bold" fill="#222" font-family="sans-serif">${escapeXml(doc.title || '未命名')}</text>
<text x="20" y="64" font-size="11" fill="#e07b00" font-family="sans-serif">${escapeXml(label)} · SVG 降级渲染（未安装 Chromium，非像素截图）</text>
${body}
</svg>`;
  return Buffer.from(svg, 'utf-8');
}

/**
 * @returns {Promise<{png:Buffer, renderer:string, viewport:{width:number,height:number}}>}
 */
export async function capturePreview(html, doc, viewportDef) {
  const { width, height } = viewportDef;
  if (puppeteer) {
    try {
      const png = await renderPuppeteer(html, { width, height });
      return { png, renderer: 'puppeteer-chromium', viewport: { width, height } };
    } catch (e) {
      // 装了 puppeteer 但缺系统库时，同样降级并记录原因
      const png = renderSvgFallback(doc, { width, height, label: `${viewportDef.label} · Chromium 启动失败：${e.message.slice(0, 40)}` });
      return { png, renderer: 'svg-fallback', viewport: { width, height } };
    }
  }
  const png = renderSvgFallback(doc, { width, height, label: viewportDef.label });
  return { png, renderer: 'svg-fallback', viewport: { width, height } };
}

export const hasPuppeteer = () => puppeteer !== null;
