# GROUP_CHAT_FIXES

## 已复用的旧实现

- 群公告：`src/components/chat/GroupChatArea.tsx`、`src/components/modals/GroupAnnouncementModal.tsx`、`src/stores/groupStore.ts`
- 督促模式：`src/components/chat/GroupChatArea.tsx`、`src/components/modals/GroupUrgeModal.tsx`、`src/stores/groupStore.ts`
- @成员：`src/components/chat/GroupChatArea.tsx`、`src/components/chat/GroupMentionPopover.tsx`、`src/utils/groupMention.ts`、`src/stores/groupStore.ts`
- 旧群聊入口：`src/components/chat/GroupChatArea.tsx`、`src/components/chat/GroupChatHeader.tsx`

## 问题1：顶部标题改造

- 统一聊天顶栏改到 `src/components/chat/original/chat-shell.ts`
- 群聊模式下改成项目组专属标题：
  - 左侧读取 localStorage 项目组快照头像，没有就显示默认群组图标
  - 中间显示项目组名称
  - 右侧显示成员头像堆叠和人数
- 成员数据由 `src/utils/groupSurface.ts` 从项目组成员和实时员工信息合并得到

## 问题2：去掉顶部搜索框

- 群聊顶栏不再渲染右上角搜索位
- 改动在 `src/components/chat/original/chat-shell.ts`
- 顶栏布局改成群信息专用结构后，右侧只保留成员堆叠，不再占搜索框位置

## 问题3：下拉框改造

- 改动在 `src/components/chat/original/chat-shell.ts`
- 群聊模式只保留两个下拉框：
  - 第一个默认显示“私聊成员”，切 1v1
  - 第二个默认显示“切换项目组”，按创建时间倒序
- 切换逻辑接到 `src/components/chat/original/OpenClawChatSurface.tsx`
  - 员工切换复用现有 `switchAgent`
  - 项目组切换复用现有 `selectGroup`
- 样式改在 `src/styles/openclaw-chat.css`
  - 群聊下拉框改成两列等宽
  - 修复同一行错位

## 问题4：群公告 + 督促模式按钮

- 群聊模式按钮改在 `src/components/chat/original/chat-shell.ts`
- 旧功能接入点改在 `src/components/chat/original/OpenClawChatSurface.tsx`
  - 群公告按钮打开 `GroupAnnouncementModal`
  - 督促模式按钮打开 `GroupUrgeModal`
  - 保存公告复用 `updateGroupAnnouncement`
  - 开启/暂停/恢复/关闭督促复用 `startGroupUrging` / `pauseGroupUrging` / `resumeGroupUrging` / `stopGroupUrging`
- 样式在 `src/styles/openclaw-chat.css`
  - 公告和督促按钮使用高亮胶囊样式
  - 视觉层级高于刷新/全屏等普通图标按钮

## 问题5：输入框 placeholder + @功能

- 输入框改造在 `src/components/chat/original/views/chat.ts`
- 群聊输入状态管理接在 `src/components/chat/original/OpenClawChatSurface.tsx`
- 复用旧 @ 逻辑：
  - 提及识别/插入复用 `src/utils/groupMention.ts`
  - 被 @ 后的实际路由和通知链路继续复用 `src/stores/groupStore.ts` 的 `sendGroupMessage`
- 新统一组件里的适配点：
  - placeholder 改为“输入消息，按 @ 提及成员”
  - 输入框加镜像层，@成员名称在输入中高亮
  - 输入 `@` 时显示成员浮层
  - 支持键盘上下选择、回车插入、Esc 关闭
  - 发送后的聊天气泡里，@成员名称高亮为蓝色

## 适配到统一聊天组件的地方

- `src/components/chat/original/OpenClawChatSurface.tsx`
  - 新增群聊专属状态
  - 把旧群公告、督促、@成员逻辑接到统一 surface
- `src/components/chat/original/chat-shell.ts`
  - 顶栏、下拉框、群聊按钮改造成群聊版
- `src/components/chat/original/views/chat.ts`
  - 输入框、@浮层、快捷 @、placeholder 改成群聊版
- `src/components/chat/original/chat/grouped-render.ts`
  - 聊天气泡支持 @成员高亮
- `src/utils/groupSurface.ts`
  - 新增群聊 surface 专用的成员、头像、提及高亮辅助逻辑
