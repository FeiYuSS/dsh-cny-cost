# 官方定价自动检查与规则更新 · 设计说明

本文记录 0.2.0 新增的「官方定价变更检测 → 弹窗确认 → 拉起更新会话」功能的设计与取舍。

## 1. 需求

- 定时检查 DeepSeek 官方计费价格或计费方式是否变化。
- 检测到变化时弹窗提示（使用 DSH 通用样式），询问是否新建会话解析新规则并更新插件计费规则。
- 用户同意后拉起新会话，并自动预填会话内容（给 Agent 的更新提示词）。
- 在 DSH 官方设置页面追加插件配置标签页：自动检查开关、检查周期（x 小时 / x 天）、手动发起规则更新（同样拉起新会话）。

## 2. 硬约束：浏览器的 CORS

官方定价的机器可读来源是
`https://api-docs.deepseek.com/zh-cn/quick_start/pricing.md`。该站点：

- 命令行工具（wget / curl / Node）可以直接下载；
- 但响应不带任何 `Access-Control-Allow-Origin` 头，`OPTIONS` 预检直接返回 403。

CORS 是**浏览器**的安全策略，只约束页面里的 `fetch`/`XHR`，不约束命令行工具或宿主进程。因此
「全部逻辑放在浏览器插件里、又直连官方页」在技术上做不到。可选的桥接方式有三种：

| 方案 | 实时性 | 依赖 | 结论 |
|---|---|---|---|
| 浏览器直连官方页 | — | 无 | **不可行**（CORS） |
| 第三方 CORS 代理 | 实时 | 第三方服务，可能限流/收费/有隐私风险 | 否决 |
| 本仓库静态镜像 + GitHub Actions 同步 | ≤ 1 个同步周期 | GitHub 静态文件（raw 允许 CORS） | **采用** |

## 3. 采用方案：静态镜像 + 纯客户端轮询

```
DeepSeek 官方 pricing.md
        │ 每小时（GitHub Actions，workflow_dispatch 可手动触发）
        ▼
scripts/sync-pricing-mirror.mjs
  fetch → parsePricingFacts → sha256(规范化全文)
        │ 仅当变化时提交
        ▼
pricing/official-zh.json（facts + hash + fetchedAt）
        │ raw.githubusercontent.com（Access-Control-Allow-Origin: *）
        ▼
浏览器插件 client.js
  fetch 镜像 → diffPricingFacts(baseline, remote)
        ├─ 无变化：记录 lastCheck
        ├─ 有变化：pending → 全局弹窗
        │     ├─ 忽略：记录 dismissedHash
        │     └─ 确认：uiWorkspace.startSession({ prompt, whenDraftExists:'replace' })
        └─ 设置页标签页读写检查开关/周期/手动触发
```

运行时**没有任何自建服务、没有宿主侧新增代码**：Host 半侧仍然只注册两个费用投影
（`deepseekTokenCost` / `deepseekTurnCost`），所有新逻辑都在浏览器插件里。

## 4. 组件与数据流

### 4.1 镜像同步（CI，不在运行时）

- `scripts/sync-pricing-mirror.mjs`：下载官方 markdown，用 `pricing-watch.js`
  （与 `node --test` 共享的纯函数）解析成事实 JSON 并计算规范化全文哈希；
  只有内容变化才写文件。
- `.github/workflows/pricing-mirror.yml`：每小时运行一次；`git diff` 无变化则不提交。
  提交信息固定为 `chore: sync DeepSeek official pricing snapshot`，便于审计。
- 镜像文件只保存**结构化的计费事实**（模型价格、峰谷规则、别名、Search/Fetch、扣费说明）
  和全文哈希，不保存官方文档全文。

### 4.2 浏览器端状态机

状态保存在 `localStorage["dsh-cny-cost.pricing-watch.v1"]`：

```text
settings  { enabled, intervalHours }
baseline  { hash, facts, checkedAt, source: bundled | mirror }
pending   { detectedAt, changes[], remote{hash,facts,fetchedAt} } | null
dismissedHash
lastCheck { at, ok, hash, fetchedAt, messageKey? , message? }
nextCheckAt
```

- 首次运行：`baseline` 取插件内置快照（`PRICING_WATCH.BUNDLED`），不弹窗。
- 每次检查：镜像 hash 与 baseline 相同 → 清空 pending；不同 → 用
  `diffPricingFacts` 得出价格/模型/规则/费用变化，写入 pending 并在全局弹窗展示。
- 用户点「忽略此次」→ 记录 `dismissedHash`，同一份官方内容不再打扰；
  官方再次变化（hash 变）会重新提示。
- 用户点「新建会话并更新规则」→ 生成更新提示词 → 尝试
  `ctx.get('uiWorkspace').startSession(workspaceId, { prompt, whenDraftExists: 'replace' })`；
  成功则把 baseline 提升为最新快照并清空 pending。若当前部署没有 `uiWorkspace`，
  退化为把提示词复制到剪贴板。
- 定时器只在有组件挂载时运行（全局弹窗 slot 或设置标签页），页面关闭即停止；
  下次打开页面会按 `lastCheck + interval` 判断是否立即补检。

### 4.3 新会话内容

`PRICING_WATCH.buildPrompt()` 生成的提示词包含：

- 官方机器可读来源、官方价格页、本次镜像同步时间；
- 检测到的逐条变化（含新旧价格/规则文本）；
- 明确任务：核对官方页面 → 修改 `logic.js` 的 `DEFAULT_RATE_DATE` /
  `DEFAULT_FAMILIES` / `DEFAULT_MODELS` / `DEFAULT_HOLIDAYS` → 更新测试与文档 →
  `npm run check` → 汇报；**在用户确认发布前不 git push、不发 npm**；
- 源码位置提示（当前工作区的插件目录，或 `git clone` 仓库）。

## 5. UI

DSH 没有全局 dialog/toast 服务，官方做法是组件化：

- 全局弹窗挂在根 slot `shell.overlay`，用平台 seed 模块
  `@deepseek-ai/dsh-client-ui-primitives` 的 `Modal` / `Button` / `Toast`
  （以 `require` 的 try/catch 兜底，模块缺失时回退到只用 `--dsw-*` token 的自绘组件）。
- 设置标签页挂在 `settings.plugins.tab`（设置 → 内置插件），标签名「Token 计价」。
  内容：自动检查开关、检查周期（数字 + 小时/天）、立即检查、手动发起规则更新、
  上次/下次检查、已确认快照、镜像同步时间、镜像地址、待确认变化列表，
  以及 CORS/镜像机制说明。
- 所有颜色/圆角/阴影只用 DSH 主题 token（`--dsw-alias-*`、`--dsw-radius-*`、
  `--dsw-elevation-prominent`），不复制官方构建后的哈希类名。

## 6. 与「服务端方案」的对比（已否决）

早期实现曾在 Host 半侧定时抓取并暴露 HTTP 路由（`webServer.register` +
`connection.requestRejection`）与 `sessionController` 建会话。该方案在 Web 关闭时也能检查，
但需要宿主侧代码与一个额外的鉴权接口。按需求改为纯客户端后：

- 优点：安装即用、无宿主 API、无额外攻击面、不依赖 Host 版本；
- 代价：页面关闭时不检查；镜像最多延迟一个同步周期；设置只保存在当前浏览器。

## 7. 失败与降级

| 场景 | 行为 |
|---|---|
| 镜像请求失败 / 格式错误 | 记录 `lastCheck.ok=false` 与错误，设置页显示；按周期重试 |
| 镜像超过 7 天未同步 | 设置页显示警告，提示 GitHub Actions 可能被禁用 |
| `uiWorkspace` 不可用或建会话失败 | 提示词复制到剪贴板，弹窗内提示手动粘贴 |
| `ui-primitives` 不可用 | 使用自绘 Modal/Button/Switch 等回退组件 |
| 官方内容仅格式变化 | 返回「文档内容有变化」而非具体价格差异 |
| 用户忽略 | 同一 hash 不再提示；官方再次变化会重新提示 |
