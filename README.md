# dsh-cny-cost · Token 用量实时计价

[![CI](https://github.com/FeiYuSS/dsh-cny-cost/actions/workflows/ci.yml/badge.svg)](https://github.com/FeiYuSS/dsh-cny-cost/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

> **English**: `dsh-cny-cost` is a DeepSeek Harness web plugin that turns the token
> usage of DeepSeek official models into a theoretical CNY cost using the official
> peak/off-peak pricing. The cost appears under the composer and at the end of every
> completed turn, with a per-model, per-period breakdown. Install it from the Plugins
> page with `github:FeiYuSS/dsh-cny-cost`. MIT licensed.

DSH（DeepSeek Harness）Web 插件：在**使用 DeepSeek 官方模型**时，按官方公开定价把会话的
token 用量换算成**理论人民币成本**，并显示在三处：

| 位置 | 内容 |
|---|---|
| 输入框下方统计条（`conversation.composer.dock`） | `¥0.0123` 费用 pill（与宿主用量统计同款图标+数值样式；`≈` 只出现在悬停气泡与明细面板里）；悬停显示气泡，点击展开会话费用明细 |
| 每个已完成回合的操作行（`conversation.chat.assistant-actions`，排在「复制/点赞/用量统计/时间」行尾） | `¥0.0042` pill；悬停显示「本回合 / 累计 / 分桶 / 时段」气泡，点击展开本回合明细 |
| 费用明细面板 | 总费用、按「模型 × 时段」的逐桶计算（tokens × 单价 = 小计）、时段拆分、每回合表、定价快照与口径说明 |

非 DeepSeek 官方模型不显示费用；混合会话只统计官方模型调用，并在面板中提示未计价次数。

两个 pill 的交互与宿主统计控件一致：hover 出现底色，悬停片刻（或键盘聚焦）出现读数气泡，点击在控件上方展开明细面板，Esc 或点击面板外关闭。

> 回合操作行里的费用 pill 依赖会话日志里记录的最后一条 Assistant 消息 id 与回合对应。
> 插件更新 Host 半侧后需要重启 DSH 才会切换到该精确映射；重启前客户端会退化为从 Chat 视图反查回合，功能一致。

## 计价依据

官方文档「模型 & 价格」：<https://api-docs.deepseek.com/zh-cn/quick_start/pricing/>
（内置快照日期 **2026-11-10**）。单位：元 / 百万 tokens。

| 模型 | 输入·缓存命中（空闲/高峰） | 输入·缓存未命中（空闲/高峰） | 输出（空闲/高峰） |
|---|---|---|---|
| `deepseek-flash`（含 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 别名） | 0.02 / 0.04 | 1 / 2 | 4 / 8 |
| `deepseek-v4-pro` | 0.15 / 0.30 | 4.5 / 9.0 | 13.5 / 27.0 |

- **高峰**：北京时间周一至周五（不含中国法定节假日）09:00–12:00、14:00–18:00；其余时段为**空闲**（半价）。
- 内置 2026 年法定节假日表（国办发明电〔2025〕7号）。跨年或官方调整时请更新 `holidays` 配置。
- 计费 = 命中输入 + 未命中输入 + 输出；缓存写入默认不计价（`writePrice: 0`）。
- 推理 token 已包含在输出 tokens 中，不重复计算。
- Search / Fetch 按「次」计费，与 token 无关，不计入本插件。
- 内部以整数「纳元」（1 元 = 1e9 纳元）累加，避免浮点误差；费用按请求完成事件的时间戳归入高峰/空闲。

## 数据一致性

费用使用的 token 分桶与宿主界面显示的 token 用量**完全同源同口径**：

- 插件在 Host 侧注册两个会话投影（`deepseekTokenCost`、`deepseekTurnCost`），折叠已提交的会话日志；
- 折叠规则镜像宿主 `@deepseek-ai/dsh-token-meter` 的 `tokenUsage` 投影：同一 turn/step 的重复
  usage 样本按替换处理、`llm/retry-started` 关闭替换区间、`assistant/attempt` 取 stream 中最后一次 usage；
- 因此费用中的 hit / miss / write / output 总量恒等于宿主 `tokenUsage` 投影的对应字段。

插件重装或新开会话时，投影会按需回填整个日志，历史会话也会显示正确费用。

## 安装

### 从 GitHub 安装（推荐）

在 DSH 侧边栏「插件」页的安装入口填入下面的安装地址（也接受
`https://github.com/FeiYuSS/dsh-cny-cost` 或 `github:FeiYuSS/dsh-cny-cost`）：

```text
github:FeiYuSS/dsh-cny-cost
```

DSH 会以 git 依赖通过 pnpm 安装本包，并按 `dsh.bundle` 声明启用。首次安装后刷新一次
Harness 页面，浏览器半侧模块即会加载。

### 本地开发安装

在 DSH 中用 Plugin Manager 安装本地目录（或在配置档 patch 中引用），本包为单 bundle：

```yaml
- insert:
    - id: token-cost
      name: dsh-cny-cost
```

安装后若页面未出现新控件，刷新一次 Harness 页面即可（浏览器半侧模块需要重新加载）。

## 配置

在配置档的 patch 中覆盖本插件的 `config`（整段替换；未写字段取默认值）：

```yaml
- id: token-cost
  name: dsh-cny-cost
  config:
    rateDate: '2026-11-10'
    models:
      deepseek-flash: flash
      deepseek-v4-flash: flash
      deepseek-v4-flash-vision-exp: flash
      deepseek-v4-pro: pro
    families:
      flash:
        peak: { hit: 0.04, miss: 2, out: 8 }
        idle: { hit: 0.02, miss: 1, out: 4 }
      pro:
        peak: { hit: 0.30, miss: 9, out: 27 }
        idle: { hit: 0.15, miss: 4.5, out: 13.5 }
    writePrice: 0
    periodMode: auto        # auto | peak | idle（后两者用于自测或保守估计）
    holidays:               # 中国法定节假日（整天空闲）
      - '2026-10-01'
```

配置改动后插件会重启并重新折叠日志，历史会话费用随之更新。配置字段有拼写错误时插件会拒绝激活并
在日志中给出明确原因。

## 已知边界

- 展示的是**理论成本**，不是账单；实际扣费以 provider 返回的 usage 与官方结算为准。
- 高峰期边界时刻附近按请求完成时间归类，可能有秒级偏差。
- 子代理是独立会话，各自显示自己会话的费用，不汇总进父会话。
- fork 出的子会话包含被复制历史的费用（与宿主 `tokenUsage` 口径一致）。
- 已压缩/剪枝的历史仍计入费用（计费是全会话口径）。
- 未上报 usage 的尝试（如中断且无 usage）不计费。

## 开发与测试

纯计价/折叠逻辑在 `logic.js`，不依赖任何包，可直接用 Node 测试：

```text
npm test                      # node --test test/logic.test.mjs
npm run check:locale          # 校验 client.js 用到的文案键在中英文里都存在
npm run check                 # 以上两项
```

测试覆盖峰谷边界（含周末、法定节假日）、模型别名、缓存分桶、同 step 替换、重试另计、
逐回合落账、金额精度与视图/状态校验。

装好本插件后还可以用真实会话日志做端到端核对（需要 `DSH_HOME` 指向 DSH 主目录）：

```text
DSH_HOME=%USERPROFILE%\.dsh node scripts/verify-against-host.mjs <sessionId>
```

脚本会用独立实现的参考折叠与插件折叠各算一遍，并与宿主 `tokenUsage` 投影的持久化
检查点逐项比对。

## 贡献

欢迎提 Issue 和 Pull Request。提交前请跑一遍 `npm run check`；CI 会在 Node 22 和 24
上运行同样的检查。

## 许可证

[MIT](./LICENSE)
