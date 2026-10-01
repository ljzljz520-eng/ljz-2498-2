# 公众号图文全栈预览台（MPA Preview Studio）

面向**微信公众号图文消息正文**的全栈预览/导出工作台：Vue 3 展示手机（375px）与桌面（≥768px）两个预览断点；正文以**结构化模块树**保存（非任意 HTML）；数据库层管理封面、资源与候选版本；后台生成**受控 HTML 与预览图**。

> 边界声明：本系统的能力配置只描述公众号图文正文，**不沿用任何邮件客户端规则**（无 mso- 条件注释、表格布局 hack、VML 回退）；样式差异会显式提示；预览**不承诺与外部平台像素完全一致**；系统**不会替用户向公众号或任何外部账号发布**内容。

## 快速开始

```bash
npm install
npm run dev:server     # 后端 http://localhost:5179（同时托管 dist 静态产物）
npm run build          # 构建前端到 dist/（生产模式由后端托管）
npm test               # node:test 验收测试（14 项）
```

开发时另开 `npx vite`（5173，已配置 `/api` 代理到 5179）。

首次启动自动写入种子数据（3 份草稿、7 个资源、2 个封面候选）。数据文件位于 `data/db.json`（JSON 仓储，原子写；接口与关系库等价，可替换为 SQLite 实现而不改路由）。

## 核心设计

### 1. 平台能力配置（不是邮件规则）
`server/src/capabilities.js`
- 白名单式声明正文可承载的内联样式：41 项稳定支持、21 项部分支持（保留但提示差异）、动画/过渡等明确不支持（清理时剥离）。
- 标签能力：允许集、解包集（保留子内容）、直接移除集（`script/style/iframe/object/...`）。
- `GET /api/capabilities` 返回完整描述与“不承诺像素一致”声明。

### 2. 服务端清理（预览/导出唯一来源）
`server/src/sanitizer.js`
- 标签/属性/协议三层显式白名单；默认拒绝。
- 允许协议明确：链接 `http/https/mailto`、图片 `http/https`、同源相对路径与页内锚点；`javascript:/vbscript:/data:` 等一律拦截并记账。
- 事件属性（`on*`）、`<script>`、`<style>`、注释（含可能的条件注释）全部移除。
- 输出后再跑 `defensiveScan` 防御扫描；**浏览器 iframe 预览与导出 HTML 都由 `renderBody/renderControlledDocument` 渲染同一份已清理模块树**，前端 iframe 使用 `sandbox="allow-same-origin"`（不授 `allow-scripts`）。

### 3. 结构化模块树与版本迁移
`server/src/modules.js`
- 当前 schema v3，块类型：heading / text / image / quote / divider / html；富文本块的 html 在保存时服务端再次清理。
- `v1 → v2 → v3` 前向迁移（类型收窄、封面结构化、封面与正文分离），迁移产生**副本**，原件保留。
- 每次保存自动写快照（最多 20 条）；从快照恢复生成**只读副本**（`readonly`，服务端 409 拒绝修改）。

### 4. 封面 / 资源 / 候选版本
- 封面候选带 `version` 与历史；换封面必须带 `expectedVersion`，并发时后到者收到 **409**（两个编辑同时换封面验收点）。
- 资源有 `authorized/revoked/expired` 状态；撤销授权后正文/封面引用立即在校验中报错、原始文件接口返回 403 占位图。

### 5. 导出前校验（通过后才进入导出确认）
`server/src/validation.js`
- 危险链接（协议复扫）、未清理脚本（阻断）、图过大（>1MB 判错）、超宽（>677px 提示）、深色图标落在深色背景不可见（判错）、资源授权变化（判错）、外链图片（提示入库）、缺封面（判错）、封面版本冲突（判错）、平台样式差异（warning/error 展示）。
- 导出端点服务端**再次**校验，失败返回 422；成功才落盘受控 HTML + 375×667 预览 SVG。`externalPublishing` 恒为 false。

## 主要 API
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/capabilities | 平台能力配置与差异规则 |
| POST | /api/sanitize | 仅清理（不落库） |
| POST | /api/paste | 粘贴：服务端清理 + 拆模块 + 差异报告 |
| GET/PUT | /api/drafts[/:id] | 列表 / 保存结构化模块树（保存即建快照） |
| POST | /api/drafts/:id/migrate | 旧草稿迁移为 v3 副本 |
| POST | /api/drafts/:id/snapshots/:sid/restore | 恢复为只读副本 |
| POST | /api/drafts/:id/cover | 换封面（乐观版本号，冲突 409） |
| GET/POST | /api/assets[/:id/status] | 资源列表 / 授权变化 |
| POST | /api/drafts/:id/validate | 导出前校验 |
| POST | /api/drafts/:id/render | 渲染清理版正文（预览同源） |
| POST | /api/drafts/:id/preview-image | 后台生成预览图 |
| POST | /api/drafts/:id/export | 校验通过后导出受控 HTML（不发布） |
| GET | /api/audit | 审计事件 |

## 验收点对应
- 危险链接、事件属性、脚本：`paste`/`sanitize` 测试 + 导出 422；
- 图过大 / 超宽：`drf_issues` 的 asset_0007（真实 >1MB、1200px）；
- 暗色图标不可见：asset_0004（深色箭头，darkIcon）；
- 资源授权变化：资产面板“撤销授权”→ 校验报错；
- 两个编辑同时换封面：右栏“🧪 模拟另一编辑并发换封面”→ 再点封面触发 409；
- 内容校验完成才进入导出确认：导出按钮仅在校验 ok 后可用，服务端复核兜底；
- 不直接发布：导出只写本地文件，界面与 API 均无外发动作；
- 正式预览/导出不含未清理脚本：防御扫描 + sandbox iframe + 导出拒绝机制。
