# 虾班成员头像数据流调查报告

## 1. 预设头像文件位置

- 结论：未找到“新增员工”页面使用的预设头像图片目录，也未找到 20 多个真人/卡通头像资源。
- 搜索 `avatar`、`preset`、`default`、`头像` 后，前端源码目录中没有匹配的头像资源目录；命中的目录基本都在 `node_modules`。
- 在 `/Users/kuangjiancheng/openclaw/wurenju/frontend` 下搜索图片文件后，排除 `node_modules` 一共只有 4 个图片文件；排除 `dist` 后源码资源只有 2 个。
- 这些文件都不是员工头像资源，只是站点图标。

- 路径：未找到员工预设头像目录
- 文件数量：0（员工预设头像）
- 前端非 `node_modules` 图片文件总数：4
- 前端源码图片文件总数（排除 `dist`）：2
- 文件列表（全部）：
  - `/Users/kuangjiancheng/openclaw/wurenju/frontend/public/favicon.svg`
  - `/Users/kuangjiancheng/openclaw/wurenju/frontend/public/icons.svg`
  - `/Users/kuangjiancheng/openclaw/wurenju/frontend/dist/favicon.svg`
  - `/Users/kuangjiancheng/openclaw/wurenju/frontend/dist/icons.svg`

## 2. 新增员工组件位置

- 实际入口按钮文件路径：
  - `/Users/kuangjiancheng/openclaw/wurenju/frontend/src/components/layout/EmployeeList.tsx`
- 实际“创建员工”弹窗组件文件路径：
  - `/Users/kuangjiancheng/openclaw/wurenju/frontend/src/components/modals/CreateEmployeeModal.tsx`
- 搜索 `新增员工|新建成员|创建员工|AgentLink` 的命中结果：
  - `/Users/kuangjiancheng/openclaw/wurenju/frontend/src/components/layout/EmployeeList.tsx`
  - `/Users/kuangjiancheng/openclaw/wurenju/frontend/src/components/modals/CreateEmployeeModal.tsx`
  - `/Users/kuangjiancheng/openclaw/wurenju/frontend/src/components/chat/original/chat-sessions.test.ts`

## 3. 头像数据存储流程

- 结论：当前仓库版本的“新增员工”页面没有图片头像上传，也没有预设图片头像；只有 emoji 头像选择。
- 前端变量名：
  - `form.emoji`
  - 定义位置：`/Users/kuangjiancheng/openclaw/wurenju/frontend/src/components/modals/CreateEmployeeModal.tsx`
- 当前页面不存在以下变量：
  - `avatar`
  - `avatarUrl`
  - `file`
  - `base64`
  - `FileReader`

### 当前实际数据流

1. 用户在 `CreateEmployeeModal.tsx` 中点击头像按钮。
2. 组件把选中的 emoji 写入 `form.emoji`。
3. 点击确认创建后，前端通过 Gateway WebSocket RPC 发送 `agents.create`。
4. 请求参数只包含 `name`、`workspace`、`emoji`，没有图片字段。
5. 创建完成后又发送一次 `agents.update`，只更新 `name` 和可选 `model`，仍然没有图片字段。
6. 然后前端调用 `agents.files.set` 写回默认模板文件，其中 `IDENTITY.md` 模板只有 `Name/Emoji/Role/Description`，没有 `Avatar`。

### 前端关键代码点

- emoji 选项数组：
  - `/Users/kuangjiancheng/openclaw/wurenju/frontend/src/components/modals/CreateEmployeeModal.tsx`
  - `EMPLOYEE_EMOJIS` 只有 12 个 emoji，没有图片路径
- 表单状态：
  - `EmployeeFormState` 只有 `displayName`、`role`、`bio`、`emoji`
- 选择头像赋值：
  - 点击按钮后 `setForm((current) => ({ ...current, emoji }))`
- 创建请求：
  - `gateway.createAgent({ name: agentId, workspace, emoji: form.emoji })`
- 更新请求：
  - `gateway.updateAgent(agentId, { name: trimmedDisplayName, model?: selectedModelRef })`

### API 调用方式

- 不是 HTTP REST API
- 是 Gateway WebSocket RPC
- 连接服务文件：
  - `/Users/kuangjiancheng/openclaw/wurenju/frontend/src/services/gateway.ts`
- 底层请求帧结构：

```json
{
  "type": "req",
  "id": "<uuid>",
  "method": "<gateway-method>",
  "params": { "...": "..." }
}
```

### 当前页面实际发出的请求

- 创建员工：

```json
{
  "type": "req",
  "id": "<uuid>",
  "method": "agents.create",
  "params": {
    "name": "<agentId>",
    "workspace": "<stateDir>/workspace-<agentId>",
    "emoji": "<form.emoji>"
  }
}
```

- 更新员工：

```json
{
  "type": "req",
  "id": "<uuid>",
  "method": "agents.update",
  "params": {
    "agentId": "<agentId>",
    "name": "<displayName>",
    "model": "<provider/model>"
  }
}
```

- 写默认文件时还会继续发：

```json
{
  "type": "req",
  "id": "<uuid>",
  "method": "agents.files.set",
  "params": {
    "agentId": "<agentId>",
    "name": "IDENTITY.md",
    "content": "# <agentName>\n\n- Name: <agentName>\n- Emoji: <emoji>\n- Role: <role>\n- Description: <description>\n"
  }
}
```

### 头像字段名

- 当前页面真正使用的字段名：`emoji`
- Gateway API 支持但当前页面没有使用的字段名：`avatar`
- 结论：当前页面没有把图片 URL 或 base64 传给任何创建员工 API

## 4. Gateway 处理逻辑

- 处理文件路径：
  - `/Users/kuangjiancheng/openclaw/src/gateway/server-methods/agents.ts`
  - `/Users/kuangjiancheng/openclaw/src/gateway/server-methods/agent.ts`
  - `/Users/kuangjiancheng/openclaw/src/gateway/assistant-identity.ts`
  - `/Users/kuangjiancheng/openclaw/src/gateway/control-ui-shared.ts`
  - `/Users/kuangjiancheng/openclaw/src/gateway/control-ui.ts`
  - `/Users/kuangjiancheng/openclaw/src/agents/identity-file.ts`
  - `/Users/kuangjiancheng/openclaw/src/agents/identity-avatar.ts`

### `agents.create` / `agents.update` 如何保存头像

- Gateway schema 确实支持：
  - `agents.create`: `name`, `workspace`, `emoji?`, `avatar?`
  - `agents.update`: `agentId`, `name?`, `workspace?`, `model?`, `avatar?`
- 保存方式不是数据库字段，而是写入 agent 工作区的 `IDENTITY.md`
- 具体保存逻辑：
  - `agents.create` 会追加：
    - `- Name: ...`
    - `- Emoji: ...`
    - `- Avatar: ...`（仅在请求里传了 `avatar` 时）
  - `agents.update` 如果传了 `avatar`，也只会把 `- Avatar: ...` 追加到 `IDENTITY.md`

### `agent.identity.get` 为什么只返回 emoji / 单字母

- 关键原因不在前端，而在 Gateway 的身份合成逻辑。
- `agent.identity.get` 的返回 schema 只有：
  - `agentId`
  - `name`
  - `avatar`
  - `emoji`
- 没有 `avatarUrl`

- Gateway 在 `/Users/kuangjiancheng/openclaw/src/gateway/assistant-identity.ts` 中会按下面顺序拼 `avatar`：
  1. `config.ui.assistant.avatar`
  2. `agent identity.avatar`
  3. `agent identity.emoji`
  4. `IDENTITY.md` 中的 `Avatar`
  5. `IDENTITY.md` 中的 `Emoji`
  6. 默认值 `"A"`

- 这意味着：
  - 如果没有真实图片头像，但有 emoji，`avatar` 会直接变成 emoji
  - 如果连 emoji 都没有，`avatar` 会回退成 `"A"`

- 所以你看到 `agent.identity.get.avatar` 是 `'🎀'` 或 `'A'`，不是图片 URL，这不是前端把图片弄丢了，而是 Gateway 故意这么兜底的结果。

### 图片头像是否被保留 / 丢弃 / 转换

- 当前“新增员工”页面：
  - 图片头像根本没有进入请求
  - 所以谈不上在 Gateway 被丢弃
  - 实际存储的是 `emoji`
- Gateway 通用能力：
  - 如果真的收到 `avatar`
  - 会写入 `IDENTITY.md` 的 `- Avatar: ...`
  - 后续 `agent.identity.get` 会把路径型头像转成 `/avatar/<agentId>` 这种可访问路径
- 当前观测到的转换点：
  - `emoji -> avatar`
  - 默认 `"A" -> avatar"`

## 5. 预设头像 URL 映射

- 结论：未找到“预设头像图片文件 -> URL”的前端映射数组或对象。
- 在 `/Users/kuangjiancheng/openclaw/wurenju/frontend/src` 中未找到：
  - `avatarMap`
  - `avatarOptions`
  - `preset avatars`
  - 图片资源数组
  - 文件路径到 URL 的映射表

### 当前存在的只有通用 Avatar URL 机制，不是预设头像映射

- Gateway 会把“路径型头像”统一映射成：
  - `/avatar/<agentId>`
- 元信息地址：
  - `/avatar/<agentId>?meta=1`
- 这套逻辑不按文件名暴露图片，而是按 `agentId` 暴露
- 映射文件路径：
  - `/Users/kuangjiancheng/openclaw/src/gateway/control-ui-shared.ts`
  - `/Users/kuangjiancheng/openclaw/src/gateway/control-ui.ts`
  - `/Users/kuangjiancheng/openclaw/ui/src/ui/app-chat.ts`

### 映射结构

- 输入：
  - `avatar = "avatars/bot.png"` 或其他 workspace 内相对路径
- 处理中：
  - `resolveAssistantAvatarUrl(...)` 判断它是路径型 avatar
- 输出：
  - `/avatar/<agentId>`

### 图片可访问 URL 示例

- 相对路径示例：
  - `/avatar/main?meta=1`
  - `/avatar/main`
- 推断的完整 URL 示例：
  - `http://localhost:18789/avatar/main?meta=1`
  - `http://localhost:18789/avatar/main`
- 说明：
  - 这是基于默认 Gateway 端口 `18789` 的推断
  - 如果配置了 basePath 或反向代理，实际 URL 会变
  - 当前“新增员工”页面并没有为新员工设置这种路径型 avatar

## 6. 本地存储

- 结论：未找到“员工头像”写入 `localStorage` 或 `IndexedDB` 的逻辑。
- `IndexedDB`：
  - 未找到相关代码

### localStorage 相关 key

- 与头像相关，但属于“当前用户头像”而不是“员工头像”的 key：
  - `xiaban_user_avatar`
  - `userAvatar`（legacy key）
- 文件路径：
  - `/Users/kuangjiancheng/openclaw/wurenju/frontend/src/utils/userProfile.ts`
  - `/Users/kuangjiancheng/openclaw/wurenju/frontend/src/components/chat/UserProfilePopover.tsx`

### 当前用户头像上传链路

- 这条链路存在，但它不是“新增员工”页面：
  1. 在 `UserProfilePopover.tsx` 选择图片
  2. `FileReader` 读成 data URL
  3. `saveUserAvatar(nextAvatar)`
  4. 写入 `localStorage["xiaban_user_avatar"]`

- 这说明：
  - 仓库里确实有“上传图片转 base64 / data URL”的逻辑
  - 但它只服务于“当前用户头像”
  - 没有接到“新增员工”流程里

### 与员工相关但不是头像的 localStorage key

- `/Users/kuangjiancheng/openclaw/wurenju/frontend/src/utils/sidebarPersistence.ts` 中只保存：
  - `xiaban.sidebar.departments`
  - `xiaban.sidebar.agentMeta`
  - `employeeDepartmentMap`
  - `pinnedEmployees`
  - `xiaban.sidebar.collapsedSections.v2`
  - `xiaban.sidebar.directArchives`

- 这些 key 只管部门、置顶、折叠、归档，不管员工头像图片。

## 结论

- 当前这版虾班前端的“新增员工”页面，实际没有实现“预设图片头像”或“上传自定义图片头像”。
- 页面层真正存在的只有 `emoji` 选择，数据流是：
  - 选择 emoji
  - 写入 `form.emoji`
  - 通过 WebSocket RPC 发 `agents.create`
  - Gateway 把它写进 agent 工作区的 `IDENTITY.md`
  - 前端后续通过 `agents.list`、`agent.identity.get`、`agents.files.get` 再读回来
- 你看到 `agent.identity.get.avatar` 返回 `'🎀'` 或 `'A'`，根本原因是 Gateway 的 `resolveAssistantIdentity(...)` 会把 `emoji` 当成 `avatar` 的回退值，没有真实头像时默认再回退成 `"A"`。
- 当前真正的断裂点在页面层：
  - “新增员工”页面没有图片头像变量
  - 没有图片文件资源
  - 没有图片上传逻辑
  - 没有把 `avatar` 发给 `agents.create` / `agents.update`
- 另一个潜在断裂点在模板覆盖：
  - 当前创建流程会在 `agents.create` 之后用 `agents.files.set` 重写 `IDENTITY.md`
  - 默认模板只有 `Name/Emoji/Role/Description`
  - 没有 `Avatar`
  - 所以如果后面只是在 `agents.create` 里补 `avatar`，但不同时修改 `IDENTITY.md` 模板，`Avatar` 行很可能被后续模板写入覆盖掉
