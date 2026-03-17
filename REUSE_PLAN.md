# 虾班功能复用计划

结论：OpenClaw 原版更适合作为虾班的“网关接入 + Agent / Session / Config / Automation 底座”，不适合作为虾班主界面的直接母版。

基于当前代码阅读结果，`wurenju/frontend` 已经明显自研出一套 AI 原生 IM 前端：

- 主路由只有 `/` 和 `/office`，不是沿用 OpenClaw 原版多页控制台。
- 侧边栏已经有员工列表、部门分组、项目组、置顶、归档。
- 聊天区已经有 1v1、项目组群聊、历史消息、归档回看、上下文占用提示。
- 管理侧已经有创建员工、创建项目组、部门管理、模型切换、提示词文件编辑、核心配置编辑。

这里的“可直接复用”指的是：原版能力已经能直接作为虾班底层或后台能力接入，不等于把原版页面原样搬过来。

## ✅ 可直接复用（无需改动或极少改动）

| 原版功能               | 对应虾班需求                          | 复用方式                                                                                                                                                   | 文件路径                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway 接入与运行状态 | 设置：网关连接                        | 直接复用原版的 WS 接入、鉴权、状态探测、重连、重启能力；虾班当前已经在启动时连接 Gateway，并在办公室页面暴露重启入口。                                     | 原版：`ui/src/ui/views/login-gate.ts`、`ui/src/ui/views/overview.ts`<br>虾班现状：`wurenju/frontend/src/services/gateway.ts`、`wurenju/frontend/src/App.tsx`、`wurenju/frontend/src/pages/OfficePage.tsx` |
| 1v1 会话底层能力       | 聊天区：AI Agent 对话、历史记录       | 直接复用原版 `chat.history`、`chat.send`、`sessions.reset`、`sessions.compact`、`sessions.delete` 这套协议和会话能力；虾班已经在自定义聊天 UI 上实际接入。 | 原版：`ui/src/ui/views/chat.ts`<br>虾班现状：`wurenju/frontend/src/stores/chatStore.ts`、`wurenju/frontend/src/components/layout/ChatArea.tsx`                                                            |
| Agent 文件读写         | 管理功能：员工编辑（提示词/角色设定） | 直接复用原版 `agents.files.list/get/set` 作为“员工提示词文件编辑”底座；当前详情页已经可以读写 `IDENTITY.md` 等文件。                                       | 原版：`ui/src/ui/views/agents.ts`<br>虾班现状：`wurenju/frontend/src/stores/agentStore.ts`、`wurenju/frontend/src/components/layout/EmployeeDetailPage.tsx`                                               |
| 模型目录与模型切换     | 设置：模型配置                        | 直接复用原版 `models.list` + `config.get/set` 能力；虾班已经做了员工模型切换和“新增模型”入口。                                                             | 原版：`ui/src/ui/views/agents.ts`、`ui/src/ui/views/config.ts`<br>虾班现状：`wurenju/frontend/src/stores/agentStore.ts`、`wurenju/frontend/src/components/modals/ModelSelectModal.tsx`                    |
| 原始配置编辑           | 设置：网关/模型高级配置               | 直接复用原版配置快照读取、JSON 配置写入、热更新链路；当前办公室页面已经具备高级配置编辑入口。                                                              | 原版：`ui/src/ui/views/config.ts`<br>虾班现状：`wurenju/frontend/src/components/office/ConfigEditorModal.tsx`、`wurenju/frontend/src/services/gateway.ts`                                                 |

## 🔧 需要改造后复用

| 原版功能                        | 对应虾班需求                               | 需要改什么                                                                                                                                                                  | 原文件路径                                                                          |
| ------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 原版聊天页 UI 与交互            | 聊天区：1v1 聊天、群聊、消息滚动、历史记录 | 原版聊天页是“控制台对话”信息架构，不是 IM。可复用会话动作、历史、上下文压缩、附件/语音/命令体系，但 UI 必须继续按虾班的员工列表 + 会话区 + 群聊形态重做。                   | `ui/src/ui/views/chat.ts`                                                           |
| 原版 Agents 管理                | 管理功能：员工编辑、AI Agent 对话          | 原版的 Agent 概念偏运行时对象，缺少“员工/部门/项目组/置顶/归档”这套业务语义。可复用 agent identity、workspace 文件、模型配置，但要补员工资料、组织归属、群角色等业务字段。  | `ui/src/ui/views/agents.ts`                                                         |
| 原版 Cron / Agent Turn / Skills | AI 功能：@AI、AI 自动回复                  | 原版有 cron 和 agent 调度，但没有群聊场景里的“提及谁、谁先回复、是否继续接力、对项目组定时催办”这套产品规则。可复用调度能力，编排层要继续沿着虾班现有 `groupStore` 逻辑做。 | `ui/src/ui/views/cron.ts`、`ui/src/ui/views/skills.ts`、`ui/src/ui/views/agents.ts` |
| 原版 Config / Skills 管理       | 设置：API Key 管理                         | 原版更偏“配置编辑器”，不是 SaaS 风格的密钥中心。现在虾班虽然能通过 JSON 新增模型并写入 `apiKey`，但仍缺专门的 Provider 管理、密钥校验、分环境展示、权限隔离。               | `ui/src/ui/views/config.ts`、`ui/src/ui/views/skills.ts`                            |
| 原版 Sessions / Usage           | 聊天区：历史记录；后台：运营分析           | 原版是按 `sessionKey` 和 token/cost 视角分析，不是按员工、部门、项目组、租户分析。适合复用作后台能力，但展示维度和筛选条件要按虾班业务重构。                                | `ui/src/ui/views/sessions.ts`、`ui/src/ui/views/usage.ts`                           |
| 原版 Overview / Channels        | 设置：网关连接；未来外部 IM 接入           | 原版渠道页偏“机器人渠道配置中心”，对虾班主场景不是直接可用，但它的状态卡、健康探测、配置 patch 流程可以复用到后台或接入层。                                                 | `ui/src/ui/views/overview.ts`、`ui/src/ui/views/channels.ts`                        |

## 🆕 需要从零开发

| 虾班需求                        | 原因                                                                                                                                                           | 优先级 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 多租户                          | OpenClaw 原版是单 Gateway / 单工作区控制台，没有租户隔离、租户配置、租户级资源边界。当前 `wurenju/frontend` 里也没有发现租户模型相关代码。                     | 高     |
| 登录注册                        | 原版只有 Gateway token / password 接入，不是 SaaS 账户体系；当前虾班前端也没有登录、注册、找回密码、组织邀请等流程。                                           | 高     |
| 组织通讯录后端数据层            | 原版没有“员工列表、部门分组、项目组、置顶、归档”这套组织 IM 数据模型。当前虾班虽然前端 UI 已有雏形，但大量状态仍是前端 store + 本地持久化，不是 SaaS 后端。    | 高     |
| 项目组/群聊的服务端化与权限体系 | 原版没有真正的项目组、成员关系、消息权限、跨端同步模型。当前虾班群聊已经有前端编排能力，但要成为 SaaS 产品，仍需补服务端会话、成员、权限、归档规则。           | 高     |
| 员工编辑与分组运营的业务规则    | 原版只有 agent/runtime 配置，没有“移动到分组、部门调整、归档策略、置顶同步、离职/停用”这些企业 IM 业务规则；当前虾班已有交互原型，但规则层和持久化层仍要自建。 | 中高   |

## 💡 原版亮点功能（虾班可借鉴）

- Schema 驱动配置系统：原版 `config` 页不是手写表单，而是靠 schema 自动生成分组、字段、敏感项和 diff。虾班后续做“网关连接、模型配置、API Key 管理、租户设置”时，非常值得照这个思路做，能显著降低单人维护成本。
- Session 与 Usage 后台：原版对 session、token、cost、context breakdown 的拆解很完整。虾班后续做“员工效率、项目组消耗、客户账单、运营分析”时，不必从 0 想后台结构，可以直接把这套分析骨架业务化。
- Exec Approval 审批流：原版节点/执行审批模块把“危险动作要不要人工确认”做成了现成模式。虾班如果后面允许 AI 触发外部动作、发消息、改配置，这套审批思路非常适合拿来做企业安全阀。
- Cron 自动化后台：原版 cron 页已经把任务列表、状态、运行记录、立即执行做全了。虾班做“AI 自动回复、定时催办、日报/周报播报”时，优先应该复用它做后台，再在前台补更产品化的开关和场景模板。
- Agent 文件体系：原版把 Agent 的 persona、workspace 文件、工具权限拆得很清楚。虾班的“员工设定、角色卡、SOP、提示词文件”最好继续沿这套文件化结构，而不是重新发明一套更重的后台编辑系统。
