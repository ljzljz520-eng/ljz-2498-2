# 公众号图文全栈预览台

面向**微信公众号图文**（不是邮件客户端）的全栈创作/预览/导出工具：
Vue 3 双断点预览 + 正文以**结构化模块树**保存（含版本迁移与旧草稿恢复）+
SQLite 管理封面/资源/候选版本 + 后台生成**受控 HTML 与双断点预览图**。

## 架构

```
src/                     Vue 3 前端（Vite）
  App.vue                主壳：侧栏编辑 + 右侧手机/桌面断点舞台
  components/
    PreviewStage.vue     手机 375 / 桌面 1080 双断点（iframe sandbox + srcdoc）
    ModuleEditor.vue     模块树编辑；粘贴内容只提交服务端清理结果
    AssetsPanel.vue      素材上传（2MB 上限提示）、授权撤回/恢复
    CoversPanel.vue      封面候选、封面锁、乐观并发换封面
    VersionPanel.vue     候选版本、回滚、v1 旧草稿迁移恢复
    ExportModal.vue      校验结果确认页（error 阻断 / warning 逐项知悉）
server/
  platform-capabilities.js  目标平台能力配置（微信公众号，非邮件规则）
  sanitizer.js              服务端 HTML 清理（白名单标签/样式/协议 + 差异报告）
  module-tree.js            结构化模块树 + schema 迁移链（v1→v2）
  db.js                     SQLite：文档/版本/资源/封面/锁/导出任务
  image-meta.js             零依赖 PNG 尺寸与平均亮度解析
  validator.js              导出前全部校验规则 + 正式 HTML 安全断言
  controlled-html.js        由模块树生成受控 HTML（无脚本，文本转义）
  screenshot.js             Puppeteer 截图（缺失 Chromium 时 SVG 降级并标注）
  assets.js / services.js / index.js
test/                      node:test 验收测试（19 个）
```

## 关键设计决策

### 1. 平台能力配置，不沿用邮件客户端规则
`platform-capabilities.js` 显式声明公众号图文允许的标签、内联样式、链接协议
（http/https/mailto/tel）与断点；`UNSUPPORTED_STYLES`（position、flex、
animation、box-shadow 等）被清理时会生成**差异提示**而非静默丢弃。
所有预览均带免责声明：**受控近似渲染，不承诺与外部平台像素一致**。

### 2. 粘贴内容必须服务端清理，预览与导出共用同一版本
`POST /api/sanitize` 与保存时的 html-block 都走 `sanitizePipeline`：
- 剥离 `<script>`/`<iframe>`/`<style>` 块、`on*` 事件、`javascript:`/
  `vbscript:`/`file:` 协议、协议相对 URL、`expression()`；
- 返回 `report`（移除标签/属性/样式/危险链接），前端展示差异；
- 浏览器实时预览与后台导出渲染的都是这份受控 HTML，不存在两套规则。

### 3. 保存结构化模块树而非任意 HTML
| | 保存任意 HTML | 结构化模块树（采用） |
|---|---|---|
| 版本迁移 | 只能靠正则碰运气 | 每模块带 schema 版本，确定性迁移 |
| 旧草稿恢复 | 无法保证安全 | v1 整段 HTML → v2 html-block（迁移时重新清理） |
| 资源引用 | 无法定位 | assetId 精确引用，授权撤回可追踪 |
| 差异归因 | 不可归因 | 可定位到模块 |

每次保存生成 `document_versions` 候选版本；回滚也作为新版本写入，历史不丢。

### 4. 导出门禁：校验全部完成后才进入确认
`GET /api/documents/:id/preflight` 一次性跑完所有规则（不短路）：

| 验收项 | 级别 | 行为 |
|---|---|---|
| 危险链接（javascript:/vbscript:/协议相对） | error | 阻断导出 |
| 图片超过 2MB | error | 阻断，提示压缩 |
| 暗色图标在暗色背景不可见（亮度对比） | warning | 必须逐项勾选知悉 |
| 资源授权变化（撤回/过期） | error | 阻断，重新授权后恢复 |
| 两个编辑同时换封面 | 409 | 封面编辑锁 + expectedVersion 乐观并发 |
| 正式 HTML 含脚本残留 | 抛出 | `assertFormalHtmlSafe` 断言 |

确认导出后后台生成两个断点的受控 HTML 和预览图；
`export_jobs.published_externally` 恒为 0：**系统不替用户向外部账号发布**。

## 运行

```bash
npm install
npm run dev:server     # http://localhost:5174 API
npm run dev:web        # http://5173 前端（代理 /api）
npm run build && npm start   # 单端口托管构建产物
npm test               # 19 个验收测试
```

截图默认使用内建 SVG 降级渲染并在结果中标注 `svg-fallback`；
如需像素截图可安装 `puppeteer`（需要系统 Chromium），渲染器标记会变为
`puppeteer-chromium`——即便如此仍不承诺与微信端像素一致。

## 主要 API

| 方法/路径 | 说明 |
|---|---|
| `GET  /api/capabilities` | 平台能力与断点配置 |
| `POST /api/sanitize` | 粘贴 HTML 服务端清理（预览/导出同源） |
| `POST/PUT /api/documents[/:id]` | 建文档/保存模块树（生成候选版本） |
| `GET  /api/documents/:id/versions[/:v][/restore]` | 候选版本与恢复 |
| `POST /api/documents/legacy/recover` | v1 旧 HTML 草稿 → v2 模块树 |
| `POST /api/assets/:id/authorization` | 资源授权撤回/恢复 |
| `POST /api/documents/:id/cover/lock` / `cover/select` | 封面锁与乐观并发换封面 |
| `GET  /api/documents/:id/preflight` | 全量校验（导出前置） |
| `POST /api/documents/:id/export` | 确认导出（warningAck 后生成受控 HTML+预览图） |
| `GET  /api/documents/:id/preview/:viewport` | 正式受控预览（phone/desktop） |
