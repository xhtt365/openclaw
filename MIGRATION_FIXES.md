# 右侧聊天区域迁移修复记录

本文记录 `wurenju/frontend/src/components/chat/` 从 OpenClaw 3.13 原版迁移后，右侧聊天区域出现的 7 个问题的根因、修复方式和当前状态。

## 问题 1：顶部搜索框点击没有反应

- 原因
  - 搜索 UI 本体其实已经迁移过来了，位于 `wurenju/frontend/src/components/chat/original/views/chat.ts` 的 `renderSearchBar`。
  - 迁移后顶部搜索按钮只会切换内部状态，没有自动聚焦到搜索输入框，用户点击后几乎感知不到反馈。
  - 键盘快捷键实现也和按钮提示不一致，原本只监听 `Cmd/Ctrl + F`，但顶部提示写的是 `⌘K`。
- 修复
  - 在 `wurenju/frontend/src/components/chat/original/views/chat.ts` 中补了 `Cmd/Ctrl + K` 快捷键识别。
  - 给搜索输入框补了 `data-chat-search-input="true"` 标记，并在展开后自动聚焦。
  - 在 `wurenju/frontend/src/components/chat/original/OpenClawChatSurface.tsx` 中让顶部搜索按钮展开后立即聚焦搜索栏，恢复原版“点了就有反馈”的交互。
- 当前状态
  - 已修复。

## 问题 2：全屏按钮点击后右侧变空白

- 原因
  - 右上角这个按钮不是浏览器全屏，而是原版聊天区的“专注模式”按钮。
  - 迁移后专注模式切换时，没有同步关闭右侧 Markdown 侧栏；如果侧栏处于空内容状态，视觉上会像“右侧变空白”。
  - 同时缺了原版 `.chat-focus-exit` 样式，进入专注模式后退出入口不明显。
- 修复
  - 在 `wurenju/frontend/src/components/chat/original/OpenClawChatSurface.tsx` 中增加 `handleToggleFocusMode()`，进入专注模式时主动关闭右侧侧栏并清理空内容。
  - 在 `wurenju/frontend/src/styles/openclaw-chat.css` 中补回 `.chat-focus-exit` 样式，确保进入专注模式后仍有明显退出入口。
- 当前状态
  - 已修复。

## 问题 3：聊天框里的 Tool output 图标变得巨大

- 原因
  - 迁移时 `ui/src/styles/chat/tool-cards.css` 里一整段 Tool output / JSON collapse / summary icon 样式没有并入 `wurenju/frontend/src/styles/openclaw-chat.css`。
  - 结果是 `chat-tool-msg-summary__icon`、`chat-tools-summary__icon` 等类没有尺寸约束，图标被浏览器默认样式和全局样式放大。
- 修复
  - 在 `wurenju/frontend/src/styles/openclaw-chat.css` 中补回原版的：
    - `.chat-tools-summary*`
    - `.chat-tool-msg-summary*`
    - `.chat-json-*`
    - `.chat-tool-card__status*`
  - 这样 Tool output 的闪电图标、摘要行、JSON 折叠块都恢复到原版尺寸和布局。
- 当前状态
  - 已修复。

## 问题 4：左下角出现「选择文件 未选择任何文件」文字 + 点击无效

- 原因
  - 原版文件上传本来就是隐藏 `<input type="file">`，通过附件按钮触发。
  - 迁移时漏掉了 `ui/src/styles/chat/layout.css` 里的 `.agent-chat__file-input { display: none; }`。
  - 所以原生 file input 直接暴露在页面上。
- 修复
  - 在 `wurenju/frontend/src/styles/openclaw-chat.css` 中补回 `.agent-chat__file-input { display: none; }`。
  - 保留原版附件按钮触发逻辑，恢复为只显示附件按钮，不直接显示原生 input。
- 当前状态
  - 已修复。

## 问题 5：右下角发送按钮颜色不对

- 原因
  - 迁移后的聊天壳子复用了当前二开项目的全局主题变量，发送按钮颜色和原版 OpenClaw 的红珊瑚发送按钮不完全一致。
- 修复
  - 在 `wurenju/frontend/src/styles/openclaw-chat.css` 的 `.openclaw-chat-shell` 下增加：
    - `--openclaw-chat-send-accent`
    - `--openclaw-chat-send-hover`
    - `--openclaw-chat-send-shadow`
  - 并让 `.chat-send-btn` 显式使用这些变量，避免被二开全局主题漂移。
- 当前状态
  - 已修复。

## 问题 6：会话选择下拉框里只有群组，没有之前创建的员工 1v1 会话

- 原因
  - 迁移后的 `wurenju/frontend/src/components/chat/original/OpenClawChatSurface.tsx` 把原版 `sessions.list` 改成了按当前 `agentId` 过滤。
  - 这会直接把其他员工的 1v1 会话排除掉，导致下拉框只剩部分会话。
  - 另外，某些员工虽然已经创建，但 Gateway 里还没真正产出历史消息；这种情况下 `sessions.list` 也可能暂时没有该员工的 `agent:<id>:main`。
  - 侧边栏里员工的部门/置顶信息确实在 localStorage，但员工本体仍然来自 Gateway `agents.list`，所以这里不是 localStorage 数据丢了，而是 session 拉取范围被缩窄了。
- 修复
  - 在 `wurenju/frontend/src/components/chat/original/OpenClawChatSurface.tsx` 中恢复原版的“全量 `sessions.list` 拉取”。
  - 新增 `wurenju/frontend/src/components/chat/original/chat-sessions.ts`，把 Gateway 返回的 session 列表和当前 `agents.list` 做合并：
    - 保留所有真实会话，包括 group / cron / direct session
    - 为每个已存在员工补一个默认 `agent:<id>:<mainKey>` 1v1 会话入口，即使这个会话还没有历史消息
  - 在 `wurenju/frontend/src/components/chat/original/chat-shell.ts` 里让 session 分组优先显示员工中文名，而不是裸 `agentId`。
- 当前状态
  - 已修复。
- 架构说明
  - 这次修复没有把 localStorage 的侧边栏分组数据硬塞进 Gateway session 系统，只做了安全桥接：
    - 员工列表：来自 Gateway `agents.list`
    - 会话列表：来自 Gateway `sessions.list`
    - 侧边栏部门/置顶：继续走 localStorage
  - 这样不会把两套数据结构混在一起，也不会引入 session key 污染。

## 问题 7：右上角蓝色箭头标识按钮功能说明

| 图标描述     | 功能名称                    | 组件 / 代码文件                                                                         | 事件处理函数                                                                                                                      | 当前状态                                  |
| ------------ | --------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 圆形刷新箭头 | 刷新当前聊天数据            | `wurenju/frontend/src/components/chat/original/chat-shell.ts` 的 `renderChatControls()` | `wurenju/frontend/src/components/chat/original/OpenClawChatSurface.tsx` 中 `onRefresh -> refreshCurrentSession(sessionKey)`       | 正常                                      |
| 脑图标       | 切换助手思考/工作输出显示   | `wurenju/frontend/src/components/chat/original/chat-shell.ts` 的 `renderChatControls()` | `wurenju/frontend/src/components/chat/original/OpenClawChatSurface.tsx` 中 `onToggleThinking -> setShowThinking(...)`             | 正常                                      |
| 四角聚焦图标 | 专注模式                    | `wurenju/frontend/src/components/chat/original/chat-shell.ts` 的 `renderChatControls()` | `wurenju/frontend/src/components/chat/original/OpenClawChatSurface.tsx` 中 `onToggleFocusMode -> handleToggleFocusMode()`         | 已修复并正常                              |
| 时钟图标     | 显示/隐藏 cron 定时任务会话 | `wurenju/frontend/src/components/chat/original/chat-shell.ts` 的 `renderChatControls()` | `wurenju/frontend/src/components/chat/original/OpenClawChatSurface.tsx` 中 `onToggleHideCronSessions -> setHideCronSessions(...)` | 正常；需有 `cron:` 会话时才能明显看到变化 |

## 本次新增的回归验证

- 纯函数 / 模板 / 样式回归测试
  - `wurenju/frontend/src/components/chat/original/chat-shortcuts.test.ts`
  - `wurenju/frontend/src/components/chat/original/chat-sessions.test.ts`
  - `wurenju/frontend/src/components/chat/original/chat-shell.test.ts`
  - `wurenju/frontend/src/styles/openclaw-chat.test.ts`
- WebSocket mock 验证
  - `wurenju/frontend/src/services/gateway.connect.test.ts`
- 验证命令
  - `pnpm exec tsx --tsconfig tsconfig.app.json --test src/components/chat/original/chat-shortcuts.test.ts src/components/chat/original/chat-sessions.test.ts src/components/chat/original/chat-shell.test.ts src/styles/openclaw-chat.test.ts src/services/gateway.connect.test.ts`
  - `pnpm build`
