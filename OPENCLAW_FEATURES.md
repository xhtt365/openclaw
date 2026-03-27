# OpenClaw 原版功能清单

## 说明

- 原版前端实际目录是 `ui/src/ui`，不是仓库根 `src/` 下的传统前端工程。
- 没有发现 `router/index.ts` 这类框架路由文件；路由由 `ui/src/ui/navigation.ts` 的 `TAB_PATHS` 和 `ui/src/ui/app-render.ts` 的 tab 分支共同定义。
- 路由支持 basePath 前缀，所以实际访问可能是 `/overview`，也可能是 `/ui/overview`、`/apps/openclaw/overview` 这类带前缀路径。
- 本清单只统计原版 Control UI，不包含二开目录 `wurenju/frontend`。

## 一、页面路由总览

| 路由路径          | 页面名称       | 组件文件                       | 功能简述                                                                         |
| ----------------- | -------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| `/`               | 聊天           | `ui/src/ui/views/chat.ts`      | 默认页；会话聊天、附件、语音输入、slash commands、工具输出侧栏。                 |
| `/chat`           | 聊天           | `ui/src/ui/views/chat.ts`      | 与 `/` 相同，面向日常对话与 agent 会话操作。                                     |
| `/overview`       | 仪表盘         | `ui/src/ui/views/overview.ts`  | 网关接入、接入凭据、概览卡片、注意事项、事件日志、日志尾部。                     |
| `/channels`       | 渠道           | `ui/src/ui/views/channels.ts`  | 统一查看各消息渠道状态、账号情况、配置表单、WhatsApp 配对、Nostr 资料。          |
| `/instances`      | 实例           | `ui/src/ui/views/instances.ts` | 展示 gateway/client presence beacon、角色、平台、最近输入时间。                  |
| `/sessions`       | 会话           | `ui/src/ui/views/sessions.ts`  | 会话列表、搜索排序分页、会话标签/思考级别/verbose/reasoning 覆盖、删除。         |
| `/usage`          | 用量           | `ui/src/ui/views/usage.ts`     | Token/Cost 用量分析、日期过滤、查询语法、图表、会话钻取、上下文拆解、日志。      |
| `/cron`           | 定时任务       | `ui/src/ui/views/cron.ts`      | Cron 任务列表、运行记录、任务创建/编辑/克隆、投递设置、失败告警。                |
| `/agents`         | Agents         | `ui/src/ui/views/agents.ts`    | Agent 选择与多面板管理：概览、文件、工具、技能、渠道、Cron。                     |
| `/skills`         | 技能           | `ui/src/ui/views/skills.ts`    | 技能列表、启停、缺依赖提示、API Key 保存、安装技能。                             |
| `/nodes`          | 节点           | `ui/src/ui/views/nodes.ts`     | 节点列表、设备配对、设备 token 管理、exec approvals、exec node 绑定。            |
| `/config`         | 全量设置       | `ui/src/ui/views/config.ts`    | 全配置页；表单/Raw 双模式、diff、保存、应用、更新、打开配置文件。                |
| `/communications` | 通讯设置       | `ui/src/ui/views/config.ts`    | 配置页子视图，只展示 `channels/messages/broadcast/talk/audio` 相关 section。     |
| `/appearance`     | 外观设置       | `ui/src/ui/views/config.ts`    | 配置页子视图，只展示 `__appearance__/ui/wizard`，含主题家族与亮暗模式。          |
| `/automation`     | 自动化设置     | `ui/src/ui/views/config.ts`    | 配置页子视图，只展示 `commands/hooks/bindings/cron/approvals/plugins`。          |
| `/infrastructure` | 基础设施设置   | `ui/src/ui/views/config.ts`    | 配置页子视图，只展示 `gateway/web/browser/nodeHost/canvasHost/discovery/media`。 |
| `/ai-agents`      | AI Agents 设置 | `ui/src/ui/views/config.ts`    | 配置页子视图，只展示 `agents/models/skills/tools/memory/session`。               |
| `/debug`          | 调试           | `ui/src/ui/views/debug.ts`     | 状态快照、模型目录、手工 RPC 调用、事件日志。                                    |
| `/logs`           | 日志           | `ui/src/ui/views/logs.ts`      | 网关 JSONL 日志 tail、级别筛选、文本搜索、自动跟随、导出。                       |

## 二、核心功能模块

### 2.1 接入与仪表盘

- 入口组件：`ui/src/ui/views/login-gate.ts`、`ui/src/ui/views/overview.ts`
- 功能点：
  - 连接 gateway：填写 WS URL、token、password，直接连接。
  - 支持首屏登录卡和连上后的 Access 卡两种接入界面。
  - 可切换语言、sessionKey、token/password 显隐。
  - 展示连接快照：在线状态、版本、uptime、tick、活跃实例数、session 数、cron 状态、最近 channel 刷新时间。
  - 展示摘要卡片：成本、session 数、技能启用数、cron 任务概览、最近会话。
  - 自动构建 Attention 项：缺 `operator.read` scope、技能缺依赖、技能被 allowlist 拦截、cron 失败、cron overdue。
  - 展示最近事件日志与日志尾巴。
  - 提供快捷跳转按钮：Chat、Cron、Refresh、Sessions。
  - 对 pairing、鉴权失败、不安全 HTTP 等情况提供 docs 引导。
- 关键 UI 元素：
  - 登录卡片、输入框、密码显隐按钮、统计卡片、callout、列表、日志面板、事件面板、快捷按钮。
- 使用的 WS 方法：
  - `channels.status`
  - `system-presence`
  - `sessions.list`
  - `cron.status`
  - `cron.list`
  - `status`
  - `health`
  - `models.list`
  - `last-heartbeat`
  - `skills.status`
  - `sessions.usage`
  - `usage.cost`
  - `logs.tail`
- 监听的关键 WS 事件：
  - `presence`
  - `exec.approval.requested`
  - `exec.approval.resolved`
  - `update.available`

### 2.2 聊天模块

- 入口组件：`ui/src/ui/views/chat.ts`
- 功能点：
  - 加载历史消息、发送消息、终止运行、清空历史。
  - 支持图片附件：粘贴、文件选择、拖拽上传。
  - 支持语音输入 STT。
  - 支持 slash commands：
    - `/new`
    - `/reset`
    - `/compact`
    - `/stop`
    - `/clear`
    - `/focus`
    - `/model`
    - `/think`
    - `/verbose`
    - `/help`
    - `/status`
    - `/export`
    - `/usage`
    - `/agents`
    - `/kill`
    - `/skill`
    - `/steer`
  - 支持会话切换、agent 切换、跳转到 agent 页面。
  - 支持搜索消息、固定消息、本地删除标记、焦点模式。
  - 工具输出支持右侧 Markdown Sidebar，可切换原始文本查看。
  - 展示上下文压缩状态、fallback 状态、context 占用提示。
  - 支持消息导出为 Markdown。
- 关键 UI 元素：
  - 消息列表、消息分组、输入框、附件预览、slash 命令菜单、搜索栏、Pinned 区、工具输出侧栏、分隔拖拽条、发送/停止按钮、语音按钮。
- 使用的 WS 方法：
  - `chat.history`
  - `chat.send`
  - `chat.abort`
  - `sessions.reset`
  - `sessions.compact`
  - `sessions.patch`
  - `sessions.list`
  - `models.list`
  - `health`
  - `agents.list`
- 使用的 HTTP API：
  - `GET /avatar/:agentId?meta=1`，用于拉取当前 agent 头像元数据。
- 监听的关键 WS 事件：
  - `chat`
  - `agent`

### 2.3 渠道模块

- 入口组件：`ui/src/ui/views/channels.ts`
- 功能点：
  - 汇总查看内建渠道状态：WhatsApp、Telegram、Discord、Google Chat、Slack、Signal、iMessage、Nostr，以及 generic channel。
  - 按启用状态和 channel order 排序显示。
  - 展示每个渠道的 configured/running/connected/last start/账号数。
  - Telegram/Nostr/generic channel 支持多账号卡片展示。
  - 内嵌渠道配置表单，复用总配置 schema，直接 patch `channels.<channelId>`。
  - WhatsApp 支持显示二维码、强制重新发起登录、等待扫码、登出、刷新探测。
  - Nostr 支持资料编辑、导入 relay 资料、显示头像与 bio、切换高级字段。
  - 底部有原始 channel health snapshot JSON。
- 关键 UI 元素：
  - 渠道状态卡片、账号卡片、配置表单、二维码图片、资料编辑表单、状态列表、原始 JSON 代码块。
- 使用的 WS 方法：
  - `channels.status`
  - `web.login.start`
  - `web.login.wait`
  - `channels.logout`
  - `config.get`
  - `config.schema`
  - `config.set`
- 使用的 HTTP API：
  - `PUT /api/channels/nostr/:accountId/profile`
  - `POST /api/channels/nostr/:accountId/profile/import`

### 2.4 实例/Presence 模块

- 入口组件：`ui/src/ui/views/instances.ts`
- 功能点：
  - 展示已连接实例、host、IP、mode、roles、scopes、device family、版本。
  - 支持 host/IP 打码与显隐切换。
  - 展示最近输入时间和 presence age。
- 关键 UI 元素：
  - 列表、chip、刷新按钮、眼睛显隐按钮、callout。
- 使用的 WS 方法：
  - `system-presence`
- 监听的关键 WS 事件：
  - `presence`

### 2.5 会话模块

- 入口组件：`ui/src/ui/views/sessions.ts`
- 功能点：
  - 列出 session store 中的 session。
  - 支持 activeMinutes、limit、includeGlobal、includeUnknown 过滤。
  - 支持按 key/kind/updated/tokens 排序。
  - 支持搜索、分页、page size 调整。
  - 支持直接编辑 label。
  - 支持直接 patch thinkingLevel、verboseLevel、reasoningLevel。
  - 支持跳转到对应聊天页。
  - 支持删除 session，并同时归档 transcript。
- 关键 UI 元素：
  - 数据表格、内联输入框、下拉框、菜单、分页器、筛选框、删除确认弹窗（浏览器 confirm）。
- 使用的 WS 方法：
  - `sessions.list`
  - `sessions.patch`
  - `sessions.delete`

### 2.6 用量分析模块

- 入口组件：`ui/src/ui/views/usage.ts`
- 功能点：
  - 按日期范围统计 token/cost。
  - 支持 local/UTC 两种日期解释模式，并兼容旧版 gateway。
  - 支持 query 语法过滤 session，自动给 suggestion 和 filter chips。
  - 展示 Usage Overview、insights、peak error hours、Usage Mosaic。
  - 展示 Daily Usage 图，支持 total/by-type 模式。
  - 展示 Sessions 侧栏，支持 all/recent tab、列开关、排序、单选/多选、shift range 选择。
  - 单 session 钻取：
    - usage over time
    - tokens by type
    - session logs
    - system prompt/context breakdown
  - 支持导出 Sessions CSV、Daily CSV、JSON bundle。
- 关键 UI 元素：
  - 日期输入框、筛选卡片、查询输入与 chips、图表/SVG、列表、详情面板、details 折叠、导出按钮。
- 使用的 WS 方法：
  - `sessions.usage`
  - `usage.cost`
  - `sessions.usage.timeseries`
  - `sessions.usage.logs`

### 2.7 定时任务模块

- 入口组件：`ui/src/ui/views/cron.ts`
- 功能点：
  - 任务列表支持搜索、enabled 过滤、schedule 类型过滤、last status 过滤、排序、分页追加。
  - 运行记录支持 scope、搜索、状态筛选、delivery 状态筛选、排序、分页追加。
  - 任务表单支持：
    - schedule: `at` / `every` / `cron`
    - payload kind: `agentTurn` / `systemEvent`
    - session target、timezone、exact/stagger
    - delivery: `none` / `announce` / `webhook`
    - channel/account/to/webhook URL
    - failure alert mode、失败阈值、冷却、告警 channel/to/account
    - best effort delivery
  - 支持新增、编辑、克隆、取消编辑、启停、立即运行、按 due 运行、删除。
  - 自动给出 agent/model/thinking/timezone/delivery 建议值。
- 关键 UI 元素：
  - 列表、过滤器、下拉多选 details、表单、textarea、datalist、状态 chip、按钮组。
- 使用的 WS 方法：
  - `cron.status`
  - `cron.list`
  - `cron.runs`
  - `cron.add`
  - `cron.update`
  - `cron.run`
  - `cron.remove`
  - `models.list`
  - `channels.status`
- 监听的关键 WS 事件：
  - `cron`

### 2.8 Agent 管理模块

- 入口组件：`ui/src/ui/views/agents.ts`
- 功能点：
  - 选择 agent，复制 agent ID，设置默认 agent。
  - 面板拆分为：
    - Overview：工作区、identity、主模型、fallback model、技能概览。
    - Files：加载/编辑/保存 agent 核心文件。
    - Tools：profile 与 per-tool allow/deny override。
    - Skills：per-agent skill allowlist。
    - Channels：带 agent context 的渠道概览。
    - Cron：该 agent 对应的 cron 任务。
  - 支持读取 agent identity。
  - 支持读取 runtime tools catalog，区分 built-in/plugin/optional/provenance。
- 关键 UI 元素：
  - Agent 选择下拉、tab 切换、文本编辑器 textarea、工具开关、技能开关、context card、run now 按钮。
- 使用的 WS 方法：
  - `agents.list`
  - `agent.identity.get`
  - `agents.files.list`
  - `agents.files.get`
  - `agents.files.set`
  - `tools.catalog`
  - `skills.status`
  - `config.get`
  - `config.set`
  - `channels.status`
  - `cron.status`
  - `cron.list`
  - `cron.run`

### 2.9 技能模块

- 入口组件：`ui/src/ui/views/skills.ts`
- 功能点：
  - 读取技能总览，按 workspace / built-in / 其他来源分组。
  - 展示 disabled、blockedByAllowlist、missing dependency、reason 等状态。
  - 支持启用/禁用技能。
  - 支持保存技能 API key。
  - 支持从 install entry 直接安装技能。
  - 提供 ClawHub 跳转入口。
- 关键 UI 元素：
  - 搜索框、`details` 分组、状态 chip、按钮、密码输入框。
- 使用的 WS 方法：
  - `skills.status`
  - `skills.update`
  - `skills.install`

### 2.10 节点/设备/执行审批模块

- 入口组件：`ui/src/ui/views/nodes.ts`
- 功能点：
  - 展示 live node 列表。
  - 展示设备配对请求和已配对设备。
  - 处理设备配对 approve/reject。
  - 轮换和吊销设备 token，展示 scopes/last used/active or revoked。
  - 编辑 exec node binding：默认绑定 + per-agent override。
  - 编辑 exec approvals：
    - target 可选 gateway / node
    - defaults 与 per-agent scope
    - security / ask / askFallback / autoAllowSkills
    - allowlist pattern 列表编辑
  - 当运行命令需要人工审批时，弹出全局审批 overlay。
- 关键 UI 元素：
  - 列表、下拉框、checkbox、allowlist 输入、按钮、审批弹窗。
- 使用的 WS 方法：
  - `node.list`
  - `device.pair.list`
  - `device.pair.approve`
  - `device.pair.reject`
  - `device.token.rotate`
  - `device.token.revoke`
  - `exec.approvals.get`
  - `exec.approvals.set`
  - `exec.approvals.node.get`
  - `exec.approvals.node.set`
  - `exec.approval.resolve`
  - `config.get`
  - `config.set`
- 监听的关键 WS 事件：
  - `device.pair.requested`
  - `device.pair.resolved`
  - `exec.approval.requested`
  - `exec.approval.resolved`

### 2.11 设置模块

- 入口组件：`ui/src/ui/views/config.ts`
- 复用到的路由：
  - `/config`
  - `/communications`
  - `/appearance`
  - `/automation`
  - `/infrastructure`
  - `/ai-agents`
- 功能点：
  - 统一配置编辑器，支持 Form / Raw 双模式。
  - 顶部 section tab 按 schema 自动生成。
  - 搜索支持普通文本和 `tag:xxx` 标签过滤。
  - 敏感字段支持 redaction/reveal。
  - schema 驱动渲染 object/array/scalar/JSON textarea。
  - 展示变更 diff。
  - 支持保存、应用、更新、打开配置文件。
  - Appearance 子页额外提供主题家族和 light/dark/system 选择。
- 关键 UI 元素：
  - 顶部 tabs、模式切换、搜索框、schema 表单、Raw textarea、Diff 面板、Save/Apply/Update/Open 按钮。
- 使用的 WS 方法：
  - `config.get`
  - `config.schema`
  - `config.set`
  - `config.apply`
  - `config.openFile`
  - `update.run`

### 2.12 调试与日志模块

- 入口组件：`ui/src/ui/views/debug.ts`、`ui/src/ui/views/logs.ts`
- 功能点：
  - Debug 页面读取 status、health、model catalog、last heartbeat。
  - Debug 页面允许手填 method + JSON params 发 manual RPC。
  - Debug 页面展示最近 gateway event log。
  - Logs 页面 tail JSONL，支持文本过滤、级别过滤、自动跟随、导出。
- 关键 UI 元素：
  - 代码块、下拉框、textarea、事件列表、日志流视图、过滤 chip。
- 使用的 WS 方法：
  - `status`
  - `health`
  - `models.list`
  - `last-heartbeat`
  - `logs.tail`

## 三、可复用公共组件

### 3.1 组件目录结论

- 真正独立放在 `ui/src/ui/components` 下的基础组件只有 2 个：
  - `dashboard-header.ts`
  - `resizable-divider.ts`
- 其余“可复用 UI”大多以 `views/*.ts` 里的渲染器形式存在，不是单独的 `common/ui` 组件库。
- 没有发现独立的 `Modal`、`Toast`、`Dropdown`、`Avatar`、`Badge` 组件目录；这些能力更多以局部渲染器、原生 `select/details/dialog-like overlay` 和 CSS class 的形式分散在各页面中。

### 3.2 基础/高复用 UI 组件

| 组件名                         | 文件路径                                         | 功能                                                    | 复用价值                               |
| ------------------------------ | ------------------------------------------------ | ------------------------------------------------------- | -------------------------------------- |
| `DashboardHeader`              | `ui/src/ui/components/dashboard-header.ts`       | 顶部面包屑标题，支持发出 `navigate` 事件。              | 高，可作为所有控制台页统一头部。       |
| `ResizableDivider`             | `ui/src/ui/components/resizable-divider.ts`      | 左右分栏拖拽分隔条，发出 `resize` 事件。                | 高，聊天与侧栏布局直接可复用。         |
| `renderCommandPalette`         | `ui/src/ui/views/command-palette.ts`             | 命令面板，支持搜索、导航跳转、注入 slash command。      | 高，适合做全局命令中心。               |
| `renderLoginGate`              | `ui/src/ui/views/login-gate.ts`                  | 首屏接入卡片，封装网关 URL/token/password 登录。        | 高，适合复用为接入页。                 |
| `renderGatewayUrlConfirmation` | `ui/src/ui/views/gateway-url-confirmation.ts`    | 切换 gateway URL 前的安全确认浮层。                     | 中，适合所有远端网关切换场景。         |
| `renderExecApprovalPrompt`     | `ui/src/ui/views/exec-approval.ts`               | 命令执行审批 overlay，支持 allow once / always / deny。 | 高，适合所有 exec 审批流。             |
| `renderMarkdownSidebar`        | `ui/src/ui/views/markdown-sidebar.ts`            | 右侧 Markdown 预览侧栏，可回退原始文本。                | 高，适合工具输出、日志详情、文档预览。 |
| `renderBottomTabs`             | `ui/src/ui/views/bottom-tabs.ts`                 | 移动端底部 tab 导航。                                   | 中，适合移动布局补齐。                 |
| `renderConfigForm`             | `ui/src/ui/views/config-form.render.ts`          | schema 驱动的表单容器，支持 section 卡片与搜索过滤。    | 很高，几乎是整套设置系统的核心。       |
| `renderNode`                   | `ui/src/ui/views/config-form.node.ts`            | schema 节点级渲染器，处理对象、数组、标量、敏感字段。   | 很高，可复用到任何 JSON Schema 表单。  |
| `renderChannelConfigSection`   | `ui/src/ui/views/channels.config.ts`             | 从总配置 schema 中裁出单渠道配置表单。                  | 高，适合渠道配置页复用。               |
| `renderNostrProfileForm`       | `ui/src/ui/views/channels.nostr-profile-form.ts` | Nostr profile 编辑与 relay 导入表单。                   | 中，适合账号资料编辑场景。             |
| `renderExecApprovals`          | `ui/src/ui/views/nodes-exec-approvals.ts`        | exec approvals 编辑器，带 target/scope/allowlist。      | 高，复杂权限编辑器现成可复用。         |

### 3.3 页面子组件/局部渲染器

| 组件名                       | 文件路径                                        | 功能                                          | 复用价值           |
| ---------------------------- | ----------------------------------------------- | --------------------------------------------- | ------------------ |
| `renderOverviewCards`        | `ui/src/ui/views/overview-cards.ts`             | 仪表盘统计卡片和最近会话。                    | 高，适合首页概览。 |
| `renderOverviewAttention`    | `ui/src/ui/views/overview-attention.ts`         | Attention 列表和 docs 跳转。                  | 中。               |
| `renderOverviewEventLog`     | `ui/src/ui/views/overview-event-log.ts`         | 最近事件日志列表。                            | 中。               |
| `renderOverviewLogTail`      | `ui/src/ui/views/overview-log-tail.ts`          | 概览页日志尾部。                              | 中。               |
| `renderOverviewQuickActions` | `ui/src/ui/views/overview-quick-actions.ts`     | 快捷跳转按钮组。                              | 中。               |
| `renderDiscordCard`          | `ui/src/ui/views/channels.discord.ts`           | Discord 渠道状态卡。                          | 中。               |
| `renderGoogleChatCard`       | `ui/src/ui/views/channels.googlechat.ts`        | Google Chat 渠道状态卡。                      | 中。               |
| `renderIMessageCard`         | `ui/src/ui/views/channels.imessage.ts`          | iMessage 渠道状态卡。                         | 中。               |
| `renderNostrCard`            | `ui/src/ui/views/channels.nostr.ts`             | Nostr 渠道卡，带 profile 展示/编辑入口。      | 高。               |
| `renderSignalCard`           | `ui/src/ui/views/channels.signal.ts`            | Signal 渠道状态卡。                           | 中。               |
| `renderSlackCard`            | `ui/src/ui/views/channels.slack.ts`             | Slack 渠道状态卡。                            | 中。               |
| `renderTelegramCard`         | `ui/src/ui/views/channels.telegram.ts`          | Telegram 渠道状态卡，支持多账号展示。         | 中。               |
| `renderWhatsAppCard`         | `ui/src/ui/views/channels.whatsapp.ts`          | WhatsApp 状态卡，带 QR 登录控制。             | 高。               |
| `renderAgentOverview`        | `ui/src/ui/views/agents-panels-overview.ts`     | Agent 概览面板，含模型与 fallback 编辑。      | 高。               |
| `renderAgentFiles`           | `ui/src/ui/views/agents-panels-status-files.ts` | Agent 核心文件编辑器。                        | 高。               |
| `renderAgentChannels`        | `ui/src/ui/views/agents-panels-status-files.ts` | Agent 视角的渠道快照。                        | 中。               |
| `renderAgentCron`            | `ui/src/ui/views/agents-panels-status-files.ts` | Agent 视角的 cron 列表。                      | 中。               |
| `renderAgentTools`           | `ui/src/ui/views/agents-panels-tools-skills.ts` | Agent 工具权限编辑器。                        | 高。               |
| `renderAgentSkills`          | `ui/src/ui/views/agents-panels-tools-skills.ts` | Agent 技能 allowlist 编辑器。                 | 高。               |
| `renderDailyChartCompact`    | `ui/src/ui/views/usage-render-overview.ts`      | 用量日图。                                    | 高。               |
| `renderUsageInsights`        | `ui/src/ui/views/usage-render-overview.ts`      | 用量洞察卡片。                                | 高。               |
| `renderSessionsCard`         | `ui/src/ui/views/usage-render-overview.ts`      | 用量页的 session 列表卡片。                   | 高。               |
| `renderSessionDetailPanel`   | `ui/src/ui/views/usage-render-details.ts`       | 单 session 详情、时序图、日志、context 拆分。 | 很高。             |
| `renderUsageMosaic`          | `ui/src/ui/views/usage-metrics.ts`              | 24h usage mosaic 热力块。                     | 中。               |

### 3.4 位于 `views/` 但属于支撑层的辅助模块

这些文件在 `views/` 目录下，但更像“辅助逻辑”而不是独立 UI 组件：

| 文件路径                                   | 角色                                                    |
| ------------------------------------------ | ------------------------------------------------------- |
| `ui/src/ui/views/agents-utils.ts`          | Agent、模型、工具 profile、allow/deny、头像等辅助计算。 |
| `ui/src/ui/views/channel-config-extras.ts` | 渠道配置附加字段读取与格式化。                          |
| `ui/src/ui/views/channels.shared.ts`       | 渠道启用判断、账号数统计等共享逻辑。                    |
| `ui/src/ui/views/channels.types.ts`        | 渠道页 props/type 定义。                                |
| `ui/src/ui/views/config-form.analyze.ts`   | schema 归一化与 unsupported path 分析。                 |
| `ui/src/ui/views/config-form.shared.ts`    | schema helper、敏感字段判定、默认值、人类化 label。     |
| `ui/src/ui/views/config-form.ts`           | config form 出口聚合文件。                              |
| `ui/src/ui/views/config-search.ts`         | `tag:` 搜索语法辅助。                                   |
| `ui/src/ui/views/nodes-shared.ts`          | 节点目标列表、agent 列表解析。                          |
| `ui/src/ui/views/overview-hints.ts`        | 登录/鉴权/不安全 HTTP 提示逻辑。                        |
| `ui/src/ui/views/skills-grouping.ts`       | 技能分组规则。                                          |
| `ui/src/ui/views/skills-shared.ts`         | 技能状态 chip、missing/reason 计算。                    |
| `ui/src/ui/views/usage-query.ts`           | usage query token/CSV/JSON 导出辅助。                   |
| `ui/src/ui/views/usageStyles.ts`           | usage 页样式字符串拼装。                                |
| `ui/src/ui/views/usageTypes.ts`            | usage 页类型定义。                                      |

## 四、已有的 WebSocket 方法汇总

### 4.1 Gateway RPC / WebSocket 方法

| 方法名                      | 用途                                                   | 所在文件                                                                                                                                               |
| --------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent.identity.get`        | 读取 agent identity/头像/展示名。                      | `ui/src/ui/controllers/agent-identity.ts`<br>`ui/src/ui/controllers/assistant-identity.ts`                                                             |
| `agents.files.get`          | 读取指定 agent 文件内容。                              | `ui/src/ui/controllers/agent-files.ts`                                                                                                                 |
| `agents.files.list`         | 列出 agent 核心文件。                                  | `ui/src/ui/controllers/agent-files.ts`                                                                                                                 |
| `agents.files.set`          | 保存 agent 文件。                                      | `ui/src/ui/controllers/agent-files.ts`                                                                                                                 |
| `agents.list`               | 读取 agent 列表；聊天 slash command 也会用它列 agent。 | `ui/src/ui/controllers/agents.ts`<br>`ui/src/ui/chat/slash-command-executor.ts`                                                                        |
| `channels.logout`           | 让渠道登出；当前用于 WhatsApp。                        | `ui/src/ui/controllers/channels.ts`                                                                                                                    |
| `channels.status`           | 拉取所有渠道状态快照。                                 | `ui/src/ui/controllers/channels.ts`                                                                                                                    |
| `chat.abort`                | 中止当前或目标 session 的运行。                        | `ui/src/ui/controllers/chat.ts`<br>`ui/src/ui/chat/slash-command-executor.ts`                                                                          |
| `chat.history`              | 读取聊天历史。                                         | `ui/src/ui/controllers/chat.ts`                                                                                                                        |
| `chat.send`                 | 发送聊天消息。                                         | `ui/src/ui/controllers/chat.ts`                                                                                                                        |
| `config.apply`              | 保存并立即应用配置。                                   | `ui/src/ui/controllers/config.ts`                                                                                                                      |
| `config.get`                | 读取当前配置快照。                                     | `ui/src/ui/controllers/config.ts`                                                                                                                      |
| `config.openFile`           | 在本地打开配置文件。                                   | `ui/src/ui/controllers/config.ts`                                                                                                                      |
| `config.schema`             | 读取配置 schema + UI hints。                           | `ui/src/ui/controllers/config.ts`                                                                                                                      |
| `config.set`                | 保存配置但不 apply。                                   | `ui/src/ui/controllers/config.ts`                                                                                                                      |
| `cron.add`                  | 新增 cron 任务。                                       | `ui/src/ui/controllers/cron.ts`                                                                                                                        |
| `cron.list`                 | 拉取 cron 任务列表。                                   | `ui/src/ui/controllers/cron.ts`                                                                                                                        |
| `cron.remove`               | 删除 cron 任务。                                       | `ui/src/ui/controllers/cron.ts`                                                                                                                        |
| `cron.run`                  | 手动触发 cron 任务。                                   | `ui/src/ui/controllers/cron.ts`                                                                                                                        |
| `cron.runs`                 | 拉取 cron 运行记录。                                   | `ui/src/ui/controllers/cron.ts`                                                                                                                        |
| `cron.status`               | 拉取 cron 总状态。                                     | `ui/src/ui/controllers/cron.ts`                                                                                                                        |
| `cron.update`               | 更新 cron 任务或启停状态。                             | `ui/src/ui/controllers/cron.ts`                                                                                                                        |
| `device.pair.approve`       | 批准设备配对请求。                                     | `ui/src/ui/controllers/devices.ts`                                                                                                                     |
| `device.pair.list`          | 读取 pending/paired 设备列表。                         | `ui/src/ui/controllers/devices.ts`                                                                                                                     |
| `device.pair.reject`        | 拒绝设备配对请求。                                     | `ui/src/ui/controllers/devices.ts`                                                                                                                     |
| `device.token.revoke`       | 吊销设备 token。                                       | `ui/src/ui/controllers/devices.ts`                                                                                                                     |
| `device.token.rotate`       | 轮换设备 token，并返回新 token。                       | `ui/src/ui/controllers/devices.ts`                                                                                                                     |
| `exec.approval.resolve`     | 对待审批命令执行 allow once / always / deny。          | `ui/src/ui/app.ts`                                                                                                                                     |
| `exec.approvals.get`        | 读取 gateway 本地 exec approvals 文件。                | `ui/src/ui/controllers/exec-approvals.ts`                                                                                                              |
| `exec.approvals.node.get`   | 读取 node 侧 exec approvals 文件。                     | `ui/src/ui/controllers/exec-approvals.ts`                                                                                                              |
| `exec.approvals.node.set`   | 保存 node 侧 exec approvals。                          | `ui/src/ui/controllers/exec-approvals.ts`                                                                                                              |
| `exec.approvals.set`        | 保存 gateway 侧 exec approvals。                       | `ui/src/ui/controllers/exec-approvals.ts`                                                                                                              |
| `health`                    | 读取系统健康状态；debug 与 chat slash `/status` 会用。 | `ui/src/ui/controllers/debug.ts`<br>`ui/src/ui/controllers/health.ts`<br>`ui/src/ui/chat/slash-command-executor.ts`                                    |
| `last-heartbeat`            | 读取最近 heartbeat。                                   | `ui/src/ui/controllers/debug.ts`                                                                                                                       |
| `logs.tail`                 | tail 日志；overview 与 logs 页都会用。                 | `ui/src/ui/app-settings.ts`<br>`ui/src/ui/controllers/logs.ts`                                                                                         |
| `models.list`               | 读取模型目录。                                         | `ui/src/ui/controllers/cron.ts`<br>`ui/src/ui/controllers/debug.ts`<br>`ui/src/ui/controllers/models.ts`<br>`ui/src/ui/chat/slash-command-executor.ts` |
| `node.list`                 | 读取 live node 列表。                                  | `ui/src/ui/controllers/nodes.ts`                                                                                                                       |
| `sessions.compact`          | 手动压缩 session 上下文。                              | `ui/src/ui/chat/slash-command-executor.ts`                                                                                                             |
| `sessions.delete`           | 删除 session 并归档 transcript。                       | `ui/src/ui/controllers/sessions.ts`                                                                                                                    |
| `sessions.list`             | 读取 session 列表；聊天和 slash command 也依赖它。     | `ui/src/ui/controllers/sessions.ts`<br>`ui/src/ui/chat/slash-command-executor.ts`                                                                      |
| `sessions.patch`            | 修改 session label/model/thinking/verbose/reasoning。  | `ui/src/ui/controllers/sessions.ts`<br>`ui/src/ui/chat/slash-command-executor.ts`                                                                      |
| `sessions.reset`            | 清空当前会话历史。                                     | `ui/src/ui/app-chat.ts`<br>`ui/src/ui/app-render.ts`                                                                                                   |
| `sessions.usage`            | 拉取 session 级别 usage 统计。                         | `ui/src/ui/controllers/usage.ts`                                                                                                                       |
| `sessions.usage.logs`       | 拉取单 session 日志。                                  | `ui/src/ui/controllers/usage.ts`                                                                                                                       |
| `sessions.usage.timeseries` | 拉取单 session 时序点。                                | `ui/src/ui/controllers/usage.ts`                                                                                                                       |
| `skills.install`            | 安装技能。                                             | `ui/src/ui/controllers/skills.ts`                                                                                                                      |
| `skills.status`             | 读取技能状态；全局和单 agent 都会用。                  | `ui/src/ui/controllers/skills.ts`<br>`ui/src/ui/controllers/agent-skills.ts`                                                                           |
| `skills.update`             | 启停技能或保存技能 API key。                           | `ui/src/ui/controllers/skills.ts`                                                                                                                      |
| `status`                    | 读取 gateway 状态快照。                                | `ui/src/ui/controllers/debug.ts`                                                                                                                       |
| `system-presence`           | 读取 presence beacon 列表。                            | `ui/src/ui/controllers/presence.ts`                                                                                                                    |
| `tools.catalog`             | 读取 agent runtime 工具目录与 profile。                | `ui/src/ui/controllers/agents.ts`                                                                                                                      |
| `update.run`                | 触发程序更新。                                         | `ui/src/ui/controllers/config.ts`                                                                                                                      |
| `usage.cost`                | 拉取 cost 按日聚合。                                   | `ui/src/ui/controllers/usage.ts`                                                                                                                       |
| `web.login.start`           | 发起 WhatsApp Web 登录并获取二维码。                   | `ui/src/ui/controllers/channels.ts`                                                                                                                    |
| `web.login.wait`            | 阻塞等待 WhatsApp 扫码结果。                           | `ui/src/ui/controllers/channels.ts`                                                                                                                    |

### 4.2 补充 HTTP API / 资源接口

| 接口                                                 | 用途                                                               | 所在文件                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| `GET /api/control-ui/bootstrap`                      | 在 WS 连接前加载 assistant 名称、头像、默认 agent、serverVersion。 | `ui/src/ui/controllers/control-ui-bootstrap.ts` |
| `GET /avatar/:agentId?meta=1`                        | 拉取聊天页当前 agent 的头像 URL 元数据。                           | `ui/src/ui/app-chat.ts`                         |
| `PUT /api/channels/nostr/:accountId/profile`         | 保存并向 relay 发布 Nostr profile。                                | `ui/src/ui/app-channels.ts`                     |
| `POST /api/channels/nostr/:accountId/profile/import` | 从 relay 导入 Nostr profile，并合并到表单。                        | `ui/src/ui/app-channels.ts`                     |

### 4.3 前端侧监听到的关键 WS 事件

| 事件名                    | 用途                                                  | 所在文件                   |
| ------------------------- | ----------------------------------------------------- | -------------------------- |
| `agent`                   | 聊天中工具流和 agent 运行事件；工具结果后会刷新历史。 | `ui/src/ui/app-gateway.ts` |
| `chat`                    | 聊天流式 delta/final/aborted/error 处理。             | `ui/src/ui/app-gateway.ts` |
| `presence`                | 实时刷新实例 presence。                               | `ui/src/ui/app-gateway.ts` |
| `cron`                    | cron 页打开时自动刷新任务和运行记录。                 | `ui/src/ui/app-gateway.ts` |
| `device.pair.requested`   | 有新设备申请配对时刷新设备列表。                      | `ui/src/ui/app-gateway.ts` |
| `device.pair.resolved`    | 配对请求处理后刷新设备列表。                          | `ui/src/ui/app-gateway.ts` |
| `exec.approval.requested` | 弹出执行审批 overlay。                                | `ui/src/ui/app-gateway.ts` |
| `exec.approval.resolved`  | 从审批队列中移除已处理项。                            | `ui/src/ui/app-gateway.ts` |
| `update.available`        | 更新可用时展示升级 banner。                           | `ui/src/ui/app-gateway.ts` |

## 五、3.13 新增功能

### 5.1 严格 diff 确认的新增/变化

- 对比基线：当前仓库 `2026.3.11` 源码 vs `openclaw@2026.3.13` npm 包内 `CHANGELOG.md` 与 Control UI source map。
- 结论：
  - 真正能确认的前端增量，主要是会话级 `Fast Mode`、聊天区模型下拉切换、连接错误语义化、移动端抽屉导航/在线状态点、长文本渲染优化。
  - 你特别点名的“聊天框文件上传 / 语音消息”，严格说不属于这次 `3.11 -> 3.13` 的新增：前者现状仍是“仅图片附件”，后者现状仍是“浏览器 STT 语音输入”。但这两块原文档没有拆到实现层，所以这里一并补实现细节，方便后续复用。

| 功能名                                    | 组件路径                                                                                                                              | WS 方法                                          | 复用价值评估                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| 会话级 Fast Mode 开关                     | `ui/src/ui/chat/slash-commands.ts`、`ui/src/ui/chat/slash-command-executor.ts`、`ui/src/ui/views/sessions.ts`                         | `sessions.patch`、`sessions.list`                | 高，适合复用成“低延迟/低成本”模式切换。                    |
| 聊天区模型下拉切换器                      | `ui/src/ui/app-render.helpers.ts`、`ui/src/ui/app-chat.ts`、`ui/src/ui/controllers/models.ts`                                         | `models.list`、`sessions.patch`、`sessions.list` | 很高，适合多模型控制台直接复用。                           |
| 连接错误语义化提示                        | `ui/src/ui/connect-error.ts`、`ui/src/ui/app-gateway.ts`、`ui/src/ui/controllers/chat.ts`、`ui/src/ui/views/overview-hints.ts`        | 无新增；消费 WS 连接握手错误 details             | 高，接入页/概览页都能复用。                                |
| 移动端抽屉导航 + 侧栏在线状态点           | `ui/src/ui/app-render.ts`、`ui/src/ui/app-render.helpers.ts`、`ui/src/ui/app.ts`                                                      | 无新增；复用现有连接状态                         | 中，适合做响应式控制台壳层。                               |
| 长文本普通段落回退渲染                    | `ui/src/ui/markdown.ts`、`ui/src/ui/chat/grouped-render.ts`、`ui/src/ui/app-gateway.ts`                                               | `chat`、`chat.history`                           | 中，适合所有带长日志/长回复的聊天页。                      |
| 聊天框附件上传（仅图片，非通用文件）      | `ui/src/ui/views/chat.ts`、`ui/src/ui/chat/attachment-support.ts`、`ui/src/ui/controllers/chat.ts`、`src/gateway/chat-attachments.ts` | `chat.send`                                      | 高，但只适合图片上传；如果要做通用文件中心，还得继续扩展。 |
| 浏览器语音输入（STT，非语音消息文件链路） | `ui/src/ui/chat/speech.ts`、`ui/src/ui/views/chat.ts`、`ui/src/ui/chat/grouped-render.ts`                                             | 最终仍是 `chat.send` 文本发送                    | 中，适合轻量语音输入；不适合直接当语音消息系统复用。       |

### 5.2 重点实现细节补充

#### 5.2.1 聊天框附件上传（仅图片）

- 前端入口：
  - `ui/src/ui/views/chat.ts` 里有 3 条入口：隐藏 `input[type=file]`、剪贴板粘贴、拖拽上传。
  - 点击回形针按钮，本质上触发的是 `.agent-chat__file-input`。
- 支持类型：
  - `ui/src/ui/chat/attachment-support.ts` 写死了 `CHAT_ATTACHMENT_ACCEPT = "image/*"`。
  - `isSupportedChatAttachmentMimeType()` 只放过 `image/` MIME。
  - 结论：当前不是“通用文件上传”，而是“图片附件上传”。
- 传输链路：
  - 浏览器端用 `FileReader.readAsDataURL()` 把文件转成 `dataUrl`。
  - `ui/src/ui/controllers/chat.ts` 再把 `dataUrl` 转成 base64，组装成 `chat.send` 的 `attachments`：
    - `type: "image"`
    - `mimeType`
    - `content`
  - 发送时仍然是单个 WS RPC：`chat.send`，没有独立 `upload` 接口。
- Gateway 侧处理：
  - `src/gateway/server-methods/chat.ts` 先用 `normalizeRpcAttachmentsToChatAttachments()` 归一化参数。
  - 然后走 `parseMessageWithAttachments()`。
  - `src/gateway/chat-attachments.ts` 会再次 sniff MIME，只保留真正的图片；非图片直接丢弃。
- 文件存储方式：
  - 没有单独 HTTP 上传接口，没有对象存储/本地落盘这一层。
  - 图片是 base64 内联通过 WS 发给 gateway，再转成会话里的 image content block。
  - `chat.history` 返回历史时会把 `image.data` 原始 base64 去掉，只保留省略信息，避免历史消息爆大。
- 限制：
  - Gateway 当前对单附件限制是 `5_000_000` decoded bytes。
  - UI 预览组件是 `<img>` 缩略图 + remove 按钮，没有通用文件卡片、文件名列表、上传进度条。

#### 5.2.2 语音输入 / 语音消息现状

- 前端实现：
  - `ui/src/ui/chat/speech.ts` 用的是浏览器原生 `SpeechRecognition` / `webkitSpeechRecognition`。
  - `ui/src/ui/views/chat.ts` 的麦克风按钮只负责开始/停止识别，并把 interim/final transcript 回填到 textarea。
- 相关 WS 方法：
  - 前端不会上传音频 blob。
  - 没有发现 `media.upload`、`chat.sendVoice`、`voice.transcribe` 这类独立 WS 方法。
  - 最终仍然是把识别出来的文本通过 `chat.send` 发出去。
- 音频格式与播放器：
  - Control UI 聊天框不会产出音频文件，所以没有“录音文件格式”这一层。
  - 也没有聊天框语音播放器/waveform 组件。
  - `speech.ts` 里确实还有浏览器 `SpeechSynthesis`，`ui/src/ui/chat/grouped-render.ts` 也能给 assistant 文本加 TTS 播放按钮，但这是“文本朗读”，不是“语音消息播放器”。
- 结论：
  - 现状更准确的叫法是“语音转文字输入”，不是“完整语音消息链路”。
  - 如果二开要做真正的语音消息，还需要补：
    - 前端音频采集与 blob 上传
    - 音频消息卡片/播放器
    - 服务端音频上传协议
    - 会话历史里的音频消息结构

#### 5.2.3 会话级 Fast Mode

- 新入口：
  - `ui/src/ui/chat/slash-commands.ts` 新增 `/fast status|on|off`。
  - `ui/src/ui/views/sessions.ts` 新增 `Fast` 列，可直接对单个 session 改 `inherit/on/off`。
- 调用链路：
  - slash command 和 Sessions 表格最终都调用 `sessions.patch`。
  - 状态读取依赖 `sessions.list` 返回的 `row.fastMode`。
- 复用判断：
  - 这套能力适合直接移植到二开控制台，因为它不依赖复杂 UI 组件，核心就是一个枚举切换 + session patch。

#### 5.2.4 聊天区模型下拉切换器

- 新入口：
  - `ui/src/ui/app-render.helpers.ts` 在 `renderChatSessionSelect()` 里新增了 `renderChatModelSelect()`。
- 调用链路：
  - 首次刷新聊天区时，`ui/src/ui/app-chat.ts` 会额外调用 `models.list` 拉模型目录。
  - 用户切换模型时，直接调用 `sessions.patch { key, model }`。
  - 本地还会维护 `chatModelOverrides`，让 UI 在 RPC 往返期间保持选中状态，不闪回。
- 复用判断：
  - 这块非常适合复用，因为它已经把“模型目录加载、默认值回退、会话级 override、失败回滚”都串好了。

#### 5.2.5 连接错误语义化与接入提示

- 新文件：
  - `ui/src/ui/connect-error.ts` 是这次 diff 里唯一明确新增的前端源码文件。
- 能力变化：
  - 把连接失败从笼统的 `fetch failed` / `unauthorized`，细化成：
    - token mismatch
    - auth failed
    - too many failed authentication attempts
    - pairing required
    - device identity required
    - origin not allowed
- 触达位置：
  - 聊天发送报错
  - gateway 建连报错
  - overview 里的 auth hint / pairing hint / insecure hint
- 复用判断：
  - 这块对任何“网关控制台 + 共享 token/password”模式都很值钱，能明显减少接入期排错成本。
