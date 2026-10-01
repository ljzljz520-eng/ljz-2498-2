/**
 * 粘贴摄取：任意来源 HTML -> 服务端清理 -> 结构化模块树。
 * 返回的每个富文本模块内的 html 均为“同一清理版”，浏览器预览与导出共用。
 */
import { parse } from 'node-html-parser';
import { sanitize } from './sanitizer.js';
import { BLOCK_TYPES } from './modules.js';

const uid = () => 'm_' + Math.random().toString(36).slice(2, 9);

/** 将清理后的 HTML 按顶层块拆为模块 */
export function splitIntoModules(cleanedHtml) {
  const root = parse(`<div id="__paste__">${cleanedHtml}</div>`);
  const box = root.querySelector('#__paste__');
  const modules = [];

  const labelOf = (html, fallback) => {
    const t = html.replace(/<[^>]+>/g, '').trim();
    return (t || fallback).slice(0, 12);
  };

  const pushText = (html) => {
    if (!html || !html.replace(/<[^>]+>/g, '').trim() && !/<img|svg/i.test(html)) {
      if (!html || !html.trim()) return;
    }
    modules.push({ id: uid(), type: 'html', label: labelOf(html, 'HTML 模块'), align: '', html });
  };

  for (const child of box.childNodes) {
    if (child.nodeType === 3) {
      const text = child.text.trim();
      if (text) pushText(text);
      continue;
    }
    const tag = child.tagName?.toLowerCase();
    const html = child.outerHTML ?? child.toString();

    if (/^h[1-6]$/.test(tag || '')) {
      modules.push({ id: uid(), type: 'heading', label: child.text.slice(0, 12) || '标题', align: '', level: Number(tag[1]), text: child.text });
    } else if (tag === 'img') {
      modules.push({ id: uid(), type: 'image', label: child.getAttribute('alt') || '图片', align: '', assetId: null, src: child.getAttribute('src') || '', alt: child.getAttribute('alt') || '', width: Number(child.getAttribute('width')) || null });
    } else if (tag === 'blockquote') {
      modules.push({ id: uid(), type: 'quote', label: '引用', align: '', html });
    } else if (tag === 'hr') {
      modules.push({ id: uid(), type: 'divider', label: '分隔线', align: '' });
    } else if (tag === 'p') {
      const firstImg = child.querySelector('img');
      if (firstImg && child.querySelectorAll('img').length === 1 && child.text.trim() === '') {
        modules.push({ id: uid(), type: 'image', label: firstImg.getAttribute('alt') || '图片', align: '', assetId: null, src: firstImg.getAttribute('src') || '', alt: firstImg.getAttribute('alt') || '', width: Number(firstImg.getAttribute('width')) || null });
      } else {
        pushText(html);
      }
    } else {
      pushText(html);
    }
  }

  return modules;
}

/**
 * 粘贴入口
 * @returns {{cleanedHtml, modules, report, capabilities}}
 */
export function ingestPaste(dirtyHtml) {
  const { cleanedHtml, report, capabilities } = sanitize(dirtyHtml);
  const modules = splitIntoModules(cleanedHtml);
  return {
    cleanedHtml,
    modules,
    report,
    capabilities,
    blockTypes: BLOCK_TYPES,
  };
}
