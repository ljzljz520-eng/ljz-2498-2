/**
 * 结构化模块树 —— 正文的唯一权威存储形态。
 *
 * 为什么不保存「任意 HTML」？两种方案对比：
 *
 * A. 直接保存任意 HTML
 *    + 接入快，编辑器输出什么存什么
 *    - 无法做版本迁移：结构未知，字段调整只能靠正则，旧草稿不可恢复
 *    - 无法按模块引用资源/做授权校验（图被删、授权撤回无法定位）
 *    - 清理结果与原始内容混杂，预览与导出容易出现两套 HTML
 *    - 多端差异提示无法归因到具体模块
 *
 * B. 保存结构化模块树（本项目采用）
 *    + 每个模块带 schema 版本，可随平台能力升级做确定性迁移
 *    + 资源以 assetId 引用，授权变化/超大图可精确定位
 *    - 粘贴的富文本先经服务端清理，再作为 html-block 模块存入（内容是受控白名单 HTML）
 *
 * 迁移链：v1(legacy HTML 草稿) -> v2(结构化模块树)。读取任何旧版本数据都先经过 migrate()，
 * 原始草稿保留在 versions 表中，可随时「恢复旧草稿」。
 */
import { v4 as uuid } from 'uuid';

export const SCHEMA_VERSION = 2;

export const MODULE_TYPES = Object.freeze({
  HEADING: 'heading',
  PARAGRAPH: 'paragraph',
  IMAGE: 'image',
  QUOTE: 'quote',
  LIST: 'list',
  DIVIDER: 'divider',
  HTML_BLOCK: 'html-block', // 粘贴来源：内容为服务端清理后的安全 HTML
  VIDEO: 'video',
});

export function newModuleId() {
  return 'mod_' + uuid().slice(0, 12);
}

/**
 * v1 草稿：早期形态，正文是一整段（未分模块）HTML，封面只记 URL。
 * 形如 { schemaVersion: 1, title, bodyHtml, coverUrl }
 */
function migrateV1ToV2(docV1, sanitizedHtml = null) {
  const modules = [];
  const body = sanitizedHtml ?? docV1.bodyHtml ?? '';
  if (body && body.trim()) {
    modules.push({
      id: newModuleId(),
      type: MODULE_TYPES.HTML_BLOCK,
      props: {
        html: body,
        source: 'legacy-v1',
        migratedFrom: 'v1',
      },
    });
  }
  return {
    schemaVersion: 2,
    title: docV1.title || '未命名草稿',
    coverId: docV1.coverId || null, // v1 的 coverUrl 无法映射受控资源，置空提示用户重选
    legacyCoverUrl: docV1.coverUrl || null,
    modules,
    migrated: true,
  };
}

const MIGRATIONS = {
  1: migrateV1ToV2,
};

/**
 * 把任意历史版本的文档迁移到当前版本。幂等：已经是当前版本则原样返回。
 * @param {object} doc
 * @param {(html:string)=>string} [resanitize] 迁移旧 HTML 时可强制重新清理（默认保留原文）
 */
export function migrate(doc, resanitize) {
  let current = structuredClone(doc);
  const fromVersion = Number(current.schemaVersion ?? current.version ?? 1);
  if (!current.schemaVersion) current.schemaVersion = fromVersion;

  let v = fromVersion;
  while (v < SCHEMA_VERSION) {
    const fn = MIGRATIONS[v];
    if (!fn) throw new Error(`缺少 v${v} 的迁移方案，无法恢复该旧草稿`);
    current = fn(current, resanitize ? resanitize(current.bodyHtml) : null);
    current.schemaVersion = v + 1;
    v += 1;
  }
  // 模块级版本标记：渲染器据此打 data-mp-version
  current.schemaVersion = SCHEMA_VERSION;
  for (const m of current.modules || []) {
    if (!m.id) m.id = newModuleId();
    m.schemaVersion = m.schemaVersion || SCHEMA_VERSION;
  }
  return current;
}

/**
 * 把一份「外部粘贴的任意 HTML」恢复为可编辑的结构化草稿（旧草稿恢复入口）。
 * 调用方必须先拿到服务端清理结果再传入。
 */
export function recoverLegacyDraft({ title, cleanHtml, coverId = null }) {
  const v1 = { schemaVersion: 1, title, bodyHtml: cleanHtml, coverId };
  return migrate(v1, (html) => html); // 已是清理版，迁移函数原样使用
}

/** 轻量校验模块树基本形态（深度业务校验在 validator.js） */
export function assertModuleTree(doc) {
  if (!doc || typeof doc !== 'object') throw new Error('文档必须是对象');
  if (!Array.isArray(doc.modules)) throw new Error('modules 必须是数组');
  const ids = new Set();
  for (const m of doc.modules) {
    if (!m.id || ids.has(m.id)) throw new Error('模块 id 缺失或重复');
    ids.add(m.id);
    if (!Object.values(MODULE_TYPES).includes(m.type)) {
      throw new Error(`未知模块类型: ${m.type}`);
    }
    if (!m.props || typeof m.props !== 'object') throw new Error(`模块 ${m.id} 缺少 props`);
  }
  return true;
}
