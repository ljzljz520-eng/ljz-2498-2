/**
 * 内容校验器 —— 导出确认的前置闸门。
 *
 * 规则（error 阻断；warning 需用户在确认页显式知悉）：
 *  1. 危险链接：受控 HTML 中出现 javascript:/vbscript:/file:/data: 协议、协议相对 URL → error
 *     （清理阶段应已移除；这里是纵深防御，任何残留都阻断导出）
 *  2. 图过大：引用的素材超过平台字节上限 → error
 *  3. 暗色图标不可见：图标素材亮度与所在背景对比不足 → warning
 *  4. 资源授权变化：被引用素材 unauthorized（授权撤回/过期）→ error
 *  5. 脚本残留：正式受控 HTML 中存在 <script>/on*= 等 → error（正常情况下不可能出现）
 *  6. 平台样式差异：来自清理报告的 unsupportedStyles → warning，需向用户展示
 *
 * 所有校验规则全部执行完毕（而不是遇到第一个就退出），一次性返回完整问题清单。
 */
import { MEDIA_LIMITS, SEVERITY } from './platform-capabilities.js';
import { MODULE_TYPES } from './module-tree.js';
import { colorLuminance } from './image-meta.js';

const DANGEROUS_PROTO = /(?:javascript|vbscript|data:text\/html|file)\s*:/i;
const SCRIPT_TAG = /<script[\s>]/i;
const INLINE_HANDLER = /\son[a-z]+\s*=/i;

/** 从受控 HTML 提取链接与图片地址（轻量正则；输入已经过 sanitize-html 规范化） */
function extractUrls(html) {
  const urls = [];
  const re = /(?:href|src)\s*=\s*("|')([^"']*)\1/gi;
  let m;
  while ((m = re.exec(html))) urls.push(m[2]);
  return urls;
}

function issue(severity, code, message, moduleId = null) {
  return { severity, code, message, moduleId };
}

/**
 * @param {object} doc 迁移后的模块树
 * @param {Map<string,object>} assetsById 资源记录映射
 * @param {object} [sanitizeReport] 本轮清理报告
 * @returns {{ok:boolean, errors:Array, warnings:Array, infos:Array, checks:string[]}}
 */
export function validateDocument(doc, assetsById = new Map(), sanitizeReport = null) {
  const errors = [];
  const warnings = [];
  const infos = [];
  const checks = [];

  const allHtml = [];
  const referencedAssets = new Set();

  for (const mod of doc.modules || []) {
    if (mod.type === MODULE_TYPES.HTML_BLOCK && mod.props?.html) {
      allHtml.push(mod.props.html);
    }
    if ((mod.type === MODULE_TYPES.IMAGE || mod.type === MODULE_TYPES.VIDEO) && mod.props?.assetId) {
      referencedAssets.add(mod.props.assetId);
    }
    if (mod.type === MODULE_TYPES.IMAGE) {
      const asset = assetsById.get(mod.props.assetId);
      // 规则 2：图过大
      if (asset) {
        if (asset.bytes > MEDIA_LIMITS.maxImageBytes) {
          errors.push(issue(
            SEVERITY.ERROR, 'image-too-large',
            `图片「${asset.filename}」大小 ${(asset.bytes / 1024 / 1024).toFixed(2)}MB，` +
            `超过公众号图文 ${MEDIA_LIMITS.maxImageBytes / 1024 / 1024}MB 上限，请压缩后替换`,
            mod.id,
          ));
        }
        if (!MEDIA_LIMITS.allowedImageTypes.includes(asset.mime_type)) {
          errors.push(issue(SEVERITY.ERROR, 'image-type', `不支持的图片类型 ${asset.mime_type}`, mod.id));
        }
        // 规则 3：暗色图标不可见
        if (asset.kind === 'icon' && typeof asset.avg_luminance === 'number') {
          const bg = colorLuminance(mod.props.contextBg || mod.props.containerBg || '');
          if (bg !== null) {
            const contrast = Math.abs(asset.avg_luminance - bg);
            const tooClose = contrast < 0.25;
            const darkOnDark = asset.avg_luminance < 0.3 && bg < 0.35;
            if (tooClose || darkOnDark) {
              warnings.push(issue(
                SEVERITY.WARNING, 'icon-invisible-dark',
                `图标「${asset.filename}」为暗色（亮度 ${asset.avg_luminance.toFixed(2)}），` +
                `所在区块背景同样偏暗（亮度 ${bg.toFixed(2)}），在深色/夜间环境下可能不可见，建议换用浅色或带描边图标`,
                mod.id,
              ));
            }
          } else {
            infos.push(issue(
              SEVERITY.INFO, 'icon-bg-undeclared',
              `图标「${asset.filename}」未声明所在区块背景色，暗色模式可见性未校验`, mod.id,
            ));
          }
        }
      }
      // 规则 4：资源授权变化（引用缺失或未授权）
      if (!asset) {
        errors.push(issue(SEVERITY.ERROR, 'asset-missing', `引用的资源 ${mod.props.assetId} 不存在`, mod.id));
      } else if (!asset.authorized) {
        errors.push(issue(
          SEVERITY.ERROR, 'asset-unauthorized',
          `资源「${asset.filename}」授权状态已变化：${asset.auth_note || '未授权/已撤回'}，正文引用必须移除或重新授权后才能导出`,
          mod.id,
        ));
      }
    }
  }
  checks.push('modules-scanned');

  // 封面引用同样受授权与大小约束
  if (doc.coverId) {
    referencedAssets.add(doc.coverId);
    const cover = assetsById.get(doc.coverId);
    if (!cover) {
      errors.push(issue(SEVERITY.ERROR, 'cover-missing', `封面资源 ${doc.coverId} 不存在`));
    } else {
      if (!cover.authorized) {
        errors.push(issue(SEVERITY.ERROR, 'cover-unauthorized',
          `封面「${cover.filename}」授权已变化：${cover.auth_note || '未授权'}，请重新选择封面`));
      }
      if (cover.bytes > MEDIA_LIMITS.maxImageBytes) {
        errors.push(issue(SEVERITY.ERROR, 'cover-too-large',
          `封面「${cover.filename}」超过 ${MEDIA_LIMITS.maxImageBytes / 1024 / 1024}MB 上限`));
      }
    }
  }
  checks.push('cover-checked');

  const html = allHtml.join('\n');

  // 规则 1：危险链接（纵深防御；正常已在清理阶段拦截）
  for (const u of extractUrls(html)) {
    if (DANGEROUS_PROTO.test(u)) {
      errors.push(issue(SEVERITY.ERROR, 'dangerous-link', `检测到危险链接协议：${u.slice(0, 80)}`));
    }
    if (u.trim().startsWith('//')) {
      errors.push(issue(SEVERITY.ERROR, 'protocol-relative-url', `协议相对链接已禁止：${u.slice(0, 80)}`));
    }
  }
  checks.push('links-scanned');

  // 规则 6：样式差异提示（来自清理报告）
  if (sanitizeReport) {
    for (const s of sanitizeReport.unsupportedStyles || []) {
      warnings.push(issue(SEVERITY.WARNING, 'unsupported-style', `${s.reason}（${s.prop}）`));
    }
    for (const t of sanitizeReport.removedTags || []) {
      if (/script/i.test(t.tag)) continue; // 脚本走专门规则
      infos.push(issue(SEVERITY.INFO, 'tag-removed', t.reason));
    }
    for (const l of sanitizeReport.blockedLinks || []) {
      errors.push(issue(SEVERITY.ERROR, 'blocked-link', l.reason));
    }
  }
  checks.push('style-diff-reported');

  // 外链图片无法做字节校验时提示
  for (const u of extractUrls(html)) {
    if (/^https?:\/\//i.test(u) && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(u)) {
      warnings.push(issue(SEVERITY.WARNING, 'external-image-unchecked',
        `外链图片 ${u.slice(0, 60)}… 无法校验体积与授权，建议上传为平台素材后引用`));
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    infos,
    checks,
    validatedAt: new Date().toISOString(),
  };
}

/**
 * 规则 5：正式受控 HTML 的脚本残留检查（导出/正式预览前最后一道）。
 * 受控渲染器永远不产出脚本；此函数作为断言，任何命中即抛出/阻断。
 */
export function assertFormalHtmlSafe(controlledHtml) {
  const findings = [];
  if (SCRIPT_TAG.test(controlledHtml)) findings.push('包含 <script> 标签');
  if (INLINE_HANDLER.test(controlledHtml)) findings.push('包含内联事件属性 on*=');
  if (/javascript\s*:/i.test(controlledHtml)) findings.push('包含 javascript: 协议');
  if (/<iframe[\s>]/i.test(controlledHtml)) findings.push('包含 <iframe>');
  if (findings.length) {
    const err = new Error(`正式 HTML 安全断言失败：${findings.join('；')}`);
    err.findings = findings;
    throw err;
  }
  return true;
}
