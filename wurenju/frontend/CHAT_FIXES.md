# 单聊界面修复记录

更新时间：2026-03-16

范围：

- 只修改 `wurenju/frontend/`
- 未改 `src/`
- 未改 `ui/`

## 问题 1：聊天气泡里不显示员工设置的头像

原因：

- 原版聊天气泡头像默认走 Gateway agent identity。
- 二开侧边栏员工头像存在浏览器 `localStorage` 的员工数据里，两套数据源没打通。
- 结果就是右侧聊天消息旁边一直显示原版默认头像。

修复：

- 在 `OpenClawChatSurface` 里把当前员工信息转换成聊天组件可识别的头像数据。
- 在 `grouped-render.ts` 里调整助手头像渲染优先级，先吃本地员工头像文案/emoji/图片。
- 如果本地员工没头像，再回退到原版默认头像。

结果：

- 单聊消息气泡旁会优先显示左侧员工列表里设置的自定义头像。

## 问题 2：去掉顶部搜索栏

原因：

- 原版顶栏带搜索框和 `Cmd/Ctrl + K` 提示。
- 你现在这套单聊页不需要顶栏搜索框，保留它会挤占右上角空间。

修复：

- 删除顶栏搜索框渲染。
- 保留右上角刷新、思考、专注、时钟图标。
- 同步调整顶栏布局，避免删除后右上角按钮区塌陷。

结果：

- 顶部不再显示搜索框，按钮仍保持正常对齐。

## 问题 3：顶部标题改成当前聊天对象用户名

原因：

- 原版标题是固定的面包屑 `"OpenClaw > 聊天"`。
- 二开单聊页更需要直接展示当前聊天对象是谁。

修复：

- 顶栏标题改成动态 `headerTitle`。
- 数据直接取当前选中员工的本地数据；切换员工时同步更新。

结果：

- 顶部标题现在显示当前员工名称，不再显示原版面包屑。

## 问题 4：顶部下拉框改成三个

原因：

- 原版是“会话选择 + 模型选择”两个下拉。
- 你这套二开界面要把“成员切换”和“项目组切换”拆成独立入口，原版结构不够用。

修复：

- 顶部控制区改成三个等宽下拉：
  - 第一个：`切换成员`
  - 第二个：`选择项目组`
  - 第三个：`选择模型`
- 成员列表从本地员工数据读取。
- 项目组列表从本地项目组数据读取，并按创建时间倒序。
- 模型列表保留原版能力。
- 样式沿用原版 dropdown 风格，但改成单行三列等宽布局。

结果：

- 三个下拉框一行排列，分别负责成员、项目组、模型切换。

## 问题 5：报错信息位置规则改成全局只在聊天区显示

原因：

- 原版某些错误会同时出现在顶栏按钮左侧和聊天消息区域。
- 二开后模型切换报错会出现“双份错误”，还会把顶部布局撑坏。

修复：

- 去掉顶栏按钮区左侧错误 pill 的渲染。
- 顶部右侧区域不再显示任何错误信息。
- 错误统一保留在聊天消息区内部，由聊天流自身渲染为系统消息。

结果：

- 单聊和群聊都遵循同一条规则：右上角按钮区永远不显示错误，错误只出现在聊天区里。

## 问题 6：输入框 placeholder 改中文

原因：

- 原文案 `"Message Main (Enter to send)"` 是原版英文提示，不符合当前界面。

修复：

- 连通状态下 placeholder 改成 `"输入消息…" `。
- 断开连接时保留 `"连接 Gateway 后开始聊天…"` 提示。
- 没动发送逻辑，仍然是 Enter 发送、Shift+Enter 换行。

结果：

- 输入框文案更干净，快捷键行为不变。

## 问题 7：删除聊天记录确认弹窗样式不对

原因：

- 删除确认浮层没有完整继承原版样式，导致背景、按钮、遮罩和动效都不像 OpenClaw 原版。

修复：

- 在 `openclaw-chat.css` 里补回删除确认浮层相关样式。
- 覆盖了弹窗背景、边框、阴影、按钮、勾选项、遮罩、出现动画。

结果：

- 删除确认弹窗视觉和原版更接近，不再是浏览器默认风格。

## 问题 8：`Main` 用户来源调查

结论：

- `Main` 不是你左侧侧边栏里的员工。
- 它是 OpenClaw / Gateway 自带的默认 agent 和默认主会话，不是二开前端自动从 `localStorage` 创建出来的员工。

代码依据：

- `wurenju/frontend/src/stores/agentStore.ts` 会吃 Gateway 返回的 `defaultId` 和 `mainKey`。
- 原版 `ui/src/ui/app-render.helpers.ts` 会把 `main` 和 `agent:main:main` 特判成 `"Main Session"`。
- `src/config/defaults.ts` 会把 `session.mainKey` 归一成 `"main"`。
- `src/routing/resolve-route.ts` 和相关 session key 工具链默认都围绕 `main` 这条主会话工作。

通俗解释：

- 可以把它理解成 OpenClaw 出厂自带的“默认主账号 / 默认主会话”。
- 你在二开里做的员工，是前端本地概念；`Main` 是 Gateway 后端原生概念。
- 所以原版 18789 端口里会看到 `Main`，但你左侧员工列表里不一定有它。

补充确认：

- 我在 2026-03-16 本机执行 `openclaw status --json`，当前 Gateway 的 `agents.defaultId` 就是 `main`，并且名字也是 `Main`。

## 问题 9：定时开关功能调查 + 演示

结论先说：

- 右上角这个时钟按钮不是“定时任务总开关”。
- 它真正控制的是：是否在聊天会话列表里显示 cron 会话。
- 也就是说，它只是在“显示/隐藏 cron 会话入口”，不是在“启用/停用定时任务调度器”。

原版代码行为：

- 原版 UI 里对应状态叫 `sessionsHideCron`。
- 默认值是 `true`，也就是默认隐藏 cron 会话。
- 当它为 `true` 时：
  - 普通会话照常显示
  - `:cron:` 会话会从会话下拉里被过滤掉
  - 按钮会显示“已隐藏 N 个”提示
- 当它为 `false` 时：
  - cron 会话会重新出现在会话下拉里

关键代码依据：

- `ui/src/ui/app-render.helpers.ts`
  - 点击按钮只是切 `state.sessionsHideCron = !hideCron`
  - 真正过滤逻辑在 `resolveSessionOptionGroups(...)`
  - 这里会跳过 `isCronSessionKey(row.key)` 的会话

当前二开版现状：

- `wurenju/frontend/src/components/chat/original/chat-shell.ts` 里保留了这个按钮和隐藏数量提示。
- 但你这次把“会话选择下拉”改成了“成员 / 项目组 / 模型”三个下拉。
- 结果就是：这个按钮现在保留了“状态”和“隐藏数量”，但单聊页里已经没有原版那种会话下拉可供切换，所以它的可见效果比原版弱很多。
- 换句话说，它不是坏了，它本来就不是调度器开关；现在只是因为会话下拉被你替换掉了，所以视觉反馈少了。

调度器真正的开关：

- 真正的定时任务开关是 Gateway cron 服务本身，也就是 `cron.status.enabled`。
- 我在 2026-03-16 本机执行 `openclaw cron status`，结果是：
  - `enabled: true`
  - `storePath: /Users/kuangjiancheng/.openclaw/cron/jobs.json`
- 这才是“定时器有没有开”的真实状态。

我已创建的 3 个演示任务：

- `演示-早安问候`
  - id: `4ee3c4f7-190d-4958-8072-2d1c29bb2879`
  - 计划：每天 09:00（`0 9 * * *`，`Asia/Shanghai`）
  - 状态：已手动触发一次，`lastRunStatus = ok`
- `演示-晚间日报提醒`
  - id: `0364a5d7-3828-4eaa-a98d-1aefa52eb4bb`
  - 计划：每天 18:30（`30 18 * * *`，`Asia/Shanghai`）
  - 状态：已手动触发一次，`lastRunStatus = ok`
- `演示-周一重点清单`
  - id: `7d2b6018-b4c6-470f-9374-beaf092c12f7`
  - 计划：每周一 10:00（`0 10 * * 1`，`Asia/Shanghai`）
  - 状态：已手动触发一次，`lastRunStatus = ok`

演示任务已经产生的 cron 会话：

- `agent:main:cron:4ee3c4f7-190d-4958-8072-2d1c29bb2879`
- `agent:main:cron:0364a5d7-3828-4eaa-a98d-1aefa52eb4bb`
- `agent:main:cron:7d2b6018-b4c6-470f-9374-beaf092c12f7`

怎么观察效果：

- 在原版 18789 UI 里，这几个 cron 会话会进入会话列表。
- 时钟按钮处于“隐藏”状态时，它们会被过滤掉。
- 点一下时钟按钮切到“显示”状态，这几个 cron 会话就会出现在列表里。
- 在你当前这套二开单聊页里，因为原版会话下拉已经被替换掉，所以更明显的反馈主要是按钮的隐藏数量提示。

如果你之后想删掉这些演示任务：

- `openclaw cron rm 4ee3c4f7-190d-4958-8072-2d1c29bb2879`
- `openclaw cron rm 0364a5d7-3828-4eaa-a98d-1aefa52eb4bb`
- `openclaw cron rm 7d2b6018-b4c6-470f-9374-beaf092c12f7`

## 问题 10：右下角 `+` 新建会话异常

原因：

- 当前二开页沿用了原版 `/new` 队列流程，但你现在的单聊状态是“本地员工 + 自定义会话拼装”。
- 继续走旧的 `/new` 流程，会出现状态没有真正清空、会话没切干净的问题。

修复：

- 把 `+` 按钮逻辑改成直接重置当前 session。
- 调用 `gateway.resetSession(sessionKey)` 后清空当前聊天渲染态，再刷新历史。
- 本地排队消息里如果遇到 `/new`，也统一走同一套新建流程。

结果：

- 点击 `+` 后会清空当前聊天区，重新开始一个新会话，行为和原版更接近。

## 问题 11：发送消息经常转圈后没回复 / `chat.send timeout`

原因：

- 这个问题确实出在二开前端，不是 Gateway 和模型本身。
- 根因是 `wurenju/frontend/src/services/gateway.ts` 把通用 `sendRequest("chat.send")` 改坏了：
  - 原版逻辑：收到 `accepted` 回执就算请求成功，真正回复内容继续通过 `chat` 事件流进入界面
  - 二开逻辑：错误地要求 `chat.send` 一定等到最终 `final` 事件才 resolve
- 一旦流式回复慢一点、或者 `final` 到得晚一点，前端自己就会先把这次请求判超时。
- 另外还有一个补刀问题：
  - 某些 `chat final` 事件本身不带 `message`
  - 二开界面之前直接把流状态清空，没有去回拉历史
  - 于是会出现“三个点跳几下就没了，但没有回复”的假死现象

修复：

- `sendRequest("chat.send")` 恢复成原版语义：收到 `accepted` 就 resolve。
- 只有 `sendChat(...)` 这个辅助方法还保留“等待 final”的行为。
- 聊天 surface 对 `final` 且无 `message` 的情况，主动执行一次 `loadChatHistory(runtime)` 回拉最新回复。
- 同时把前端这条 RPC 的容错超时放宽，避免慢回执被前端误判。

结果：

- 前端不会再因为自己等错事件而频繁触发 `chat.send timeout`。
- 流式回复缺失 `message` 的场景也能通过历史回拉补回来。

## 本次验证

已完成：

- `pnpm build`
- `node --import ./scripts/register-node-alias.mjs --import tsx --test src/services/gateway.chat-send.test.ts src/components/chat/original/chat-shell.test.ts src/styles/openclaw-chat.test.ts`

验证结果：

- 构建通过
- 相关 9 条测试全部通过
- 问题 11 的关键回归测试已经补上：
  - `sendRequest(chat.send)` 收到 accepted 后立即 resolve
  - `sendChat` 辅助方法仍等待最终 `chat` 事件
