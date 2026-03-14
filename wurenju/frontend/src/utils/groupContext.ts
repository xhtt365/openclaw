export interface GroupMember {
  id: string
  name: string
  title?: string
}

export interface GroupContextParams {
  groupName: string
  members: GroupMember[]
  leaderId: string
  targetAgentId: string
  userSpecifiedTargets?: boolean
}

function formatMember(member: GroupMember, leaderId: string) {
  const safeName = member.name.trim() || member.id
  const title = member.title?.trim() ? `（${member.title.trim()}）` : ""
  const leader = member.id === leaderId ? "（群主）" : ""
  return `- ${safeName}${title}${leader}`
}

// 纯函数：只根据输入参数拼装群聊上下文，不依赖外部状态。
export function buildGroupContext(params: GroupContextParams): string {
  const { groupName, members, leaderId, targetAgentId, userSpecifiedTargets = true } = params
  const safeGroupName = groupName.trim() || "未命名项目组"
  const targetAgent = members.find((member) => member.id === targetAgentId)
  const leader = members.find((member) => member.id === leaderId)
  const isLeader = targetAgentId === leaderId
  const memberList = members.length > 0 ? members.map((member) => formatMember(member, leaderId)).join("\n") : "- 暂无成员信息"

  let context = `[群聊模式] 你是「${targetAgent?.name?.trim() || targetAgentId}」，正在「${safeGroupName}」项目组中协作。

当前成员：

${memberList}

群主：${leader?.name?.trim() || "未指定"}
`

  if (isLeader) {
    context += `
你是本群群主，职责：

1. 用户没有 @ 任何人时，你默认接收并回复
2. 如果任务需要其他成员配合，用 @成员名 发起协作
3. 汇总各成员的产出，给用户完整的结论
`
  }

  if (isLeader && !userSpecifiedTargets) {
    context += `
用户没有指定成员，作为群主请你判断：自己回复，还是分配给合适的成员。
`
  }

  context += `
规则：

1. 直接执行任务并给出实质内容，不要只说“收到”或复读用户的消息
2. 用你的专业角色视角回复，体现你的能力和个性
3. 如果任务需要其他成员配合，在回复末尾用 @成员名 明确说明需要谁做什么
4. 回复要有干货，像一个真正的团队成员在工作，不是客服机器人

---
以下是用户发来的消息：

`

  return context
}
