# 右侧聊天区迁移说明

## 问题 3：Main 会话选择下拉框的数据结构说明

### 1. 这个下拉框的数据从哪里来

右侧聊天区的会话下拉框不是前端自己拼的假数据，它直接来自 Gateway 的 `sessions.list` 返回值，然后再做一次前端补齐和分组。

代码链路：

- `src/components/chat/original/OpenClawChatSurface.tsx`
  - 调 `gateway.sendRequest("sessions.list", { includeGlobal: true, includeUnknown: true, limit: 200 })`
  - 再经过 `mergeSessionsWithKnownAgents(...)`
- `src/components/chat/original/chat-sessions.ts`
  - 给每个已知员工补一个 synthetic `main` 会话，保证没发过消息的员工也能出现在下拉框里
- `src/components/chat/original/chat-shell.ts`
  - `resolveSessionOptionGroups(...)` 把会话按员工分组后渲染成 `<optgroup>`

前端实际消费的核心结构是：

```ts
type GatewaySessionRow = {
  key: string;
  kind?: string;
  label?: string;
  displayName?: string;
  updatedAt: number | null;
  sessionId?: string;
  model?: string;
  modelProvider?: string;
  contextTokens?: number;
};
```

也就是说，下拉框的每一项本质上是一条 session row，核心字段是：

- `key`
  - 真正的会话唯一键，比如 `agent:zhoujielun:main`
- `label`
  - 会话标签，比如 `main`
- `displayName`
  - 给人看的名称，比如 `虾班`
- `updatedAt`
  - 用来排序，最近活跃的会话靠前

### 2. 为什么会按员工名称分组显示

因为下拉框的分组逻辑不是按会话类型分，而是按 `agent:<agentId>:<rest>` 里的 `agentId` 分。

代码在 `src/components/chat/original/chat-shell.ts`：

- 先解析 `key`
- 如果是 `agent:<agentId>:...`
  - 就创建一个分组 `agent:${agentId.toLowerCase()}`
  - 分组标题优先取 `agentNamesById[agentId]`
  - 也就是员工名称，比如「周杰伦」「123」「小虾」「呆大头」

所以你看到的结构其实是：

- 员工 A
  - 这个员工名下所有 session
- 员工 B
  - 这个员工名下所有 session

这就是为什么它看起来像“按员工分组的会话列表”。

### 3. 每种会话类型分别代表什么

#### `main`

`main` 是每个员工的默认 1v1 主会话。

例如：

- 实际 key：`agent:zhoujielun:main`
- 下拉显示：`main · 虾班`

这里：

- `main` 来自 session key 的后半段
- `虾班` 来自 `displayName`

前端还会主动补齐 synthetic `main` 会话，所以即使某个员工暂时没有真实 session row，下拉框里也会先给他补一个默认主会话入口。

#### `group:xxx`

这类项的显示文本通常来自 session key 去掉 `agent:<agentId>:` 之后的剩余部分。

例如：

- 实际 key 可能是 `agent:xiaoxia:group:1882c788-f288-4f33-afce-3c2901046709`
- 下拉显示就是 `group:1882c788-f288-4f33-afce-3c2901046709`

这类 session 的共同点是：

- 它们不是 `main`
- 它们是当前员工名下的附属会话
- key 里带 `group:` 时，UI 会把它们当成 group 相关会话

要注意一件事：

- 下拉框不会深度解析 `group:urge-xxx`、`group:announce-xxx`、`group:switch-a`
- 它只是把原始 key 后半段直接显示出来
- 这些名字是会话创建时写进去的命名约定，不是下拉框单独硬编码出来的特殊枚举

所以这几类你看到很多：

- `group:urge-*`
  - 一般表示和督促/催办流程相关的会话命名
- `group:announce-*`
  - 一般表示和 announce/通知流程相关的会话命名
- `group:switch-a`
  - 也是一个命名出来的附属会话

它们在当前 UI 里都只是“某个员工下面的 secondary session”，不是单独的产品级 session 类型。

#### `office-test`

像 `office-test · 龙虾办公室压力测试` 这种，不是保留关键字，也不是特殊内建类型。

它本质上表示：

- session key 的后半段是 `office-test`
- 同时这条 session row 还有一个 `displayName`，比如 `龙虾办公室压力测试`

所以 UI 才会显示成：

- `office-test · 龙虾办公室压力测试`

这种类型可以理解为“自定义命名的非主会话”。

### 4. 为什么有些条目看起来像 UUID，有些像中文标题

因为显示规则是统一的：

- 先显示 session key 的后半段
- 如果这一行还有 `displayName`，而且和 key/label 不重复
  - 就显示成 `后半段 · displayName`

所以会出现两类：

- 只有原始 key 片段
  - 比如 `group:1882c788-f288-4f33-afce-3c2901046709`
- key 片段加人类可读标题
  - 比如 `office-test · 龙虾办公室压力测试`
  - 比如 `main · 无人局前端`

### 5. 结论

这个下拉框展示的是：

- 所有员工名下的 session rows
- 不是员工列表本身
- 也不是只有当前员工的会话

它之所以按员工名分组，是因为 UI 明确按 `agentId` 做了 `optgroup`。

你看到的 `main`、`group:*`、`office-test`，本质上都是 session key 的不同后缀：

- `main`
  - 默认主会话
- `group:*`
  - group 相关或以 `group:` 命名的附属会话
- `office-test`
  - 自定义命名的附属会话

其中真正带业务语义的只有：

- `main` = 默认主会话

其余很多名字只是“创建会话时写进去的命名”，下拉框本身不会再做额外解释。
