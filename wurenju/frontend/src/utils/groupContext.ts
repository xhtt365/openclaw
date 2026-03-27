export interface GroupMember {
  id: string;
  name: string;
  title?: string;
}

export interface GroupContextParams {
  groupName: string;
  members: GroupMember[];
  leaderId: string;
  targetAgentId: string;
  userSpecifiedTargets?: boolean;
}

export interface GroupAgentSystemPromptParams extends GroupContextParams {
  announcement?: string | null;
}

export interface GroupAgentRequestMessageParams extends GroupAgentSystemPromptParams {
  message: string;
}

export function normalizeGroupAnnouncement(announcement?: string | null) {
  const normalized = announcement?.replace(/\r\n/g, "\n").trim();
  return normalized ? normalized : undefined;
}

export function buildGroupAnnouncementSystemMessage(announcement?: string | null) {
  const normalizedAnnouncement = normalizeGroupAnnouncement(announcement);
  if (!normalizedAnnouncement) {
    return "";
  }

  return `【群公告】

${normalizedAnnouncement}

如果以上公告中出现本地文件路径（如 /Users/... 或 ~/...），请先用文件读取工具主动读取相关文件，并把文件内容作为后续执行任务和回复的依据；如果文件不存在或无法读取，请在回复中明确说明。

请在回复中参考以上公告内容。

`;
}

export function buildGroupAgentSystemPrompt(params: GroupAgentSystemPromptParams) {
  const announcementMessage = buildGroupAnnouncementSystemMessage(params.announcement);
  const groupContext = buildGroupContext(params);
  return `${announcementMessage}${groupContext}`;
}

export function buildGroupAgentRequestMessage(params: GroupAgentRequestMessageParams) {
  const systemPrompt = buildGroupAgentSystemPrompt(params);
  const normalizedMessage = params.message.replace(/\r\n/g, "\n").trim();

  if (!normalizedMessage) {
    return systemPrompt.trimEnd();
  }

  // 直接把群公告和群协作规则前置到真实消息体，避免只依赖 extraSystemPrompt。
  return `${systemPrompt}${normalizedMessage}`;
}

function formatMember(member: GroupMember, leaderId: string) {
  const safeName = member.name.trim() || member.id;
  const title = member.title?.trim() ? `（${member.title.trim()}）` : "";
  const leader = member.id === leaderId ? "（群主）" : "";
  return `- ${safeName}${title}${leader}`;
}

// 纯函数：只根据输入参数拼装群聊上下文，不依赖外部状态。
export function buildGroupContext(params: GroupContextParams): string {
  const { groupName, members, leaderId, targetAgentId, userSpecifiedTargets = true } = params;
  const safeGroupName = groupName.trim() || "未命名项目组";
  const targetAgent = members.find((member) => member.id === targetAgentId);
  const leader = members.find((member) => member.id === leaderId);
  const isLeader = targetAgentId === leaderId;
  const memberList =
    members.length > 0
      ? members.map((member) => formatMember(member, leaderId)).join("\n")
      : "- 暂无成员信息";

  let context = `[群聊模式] 你是「${targetAgent?.name?.trim() || targetAgentId}」，正在「${safeGroupName}」项目组中协作。

当前成员：

${memberList}

群主：${leader?.name?.trim() || "未指定"}
`;

  if (isLeader) {
    context += `
你是本群群主，职责：

1. 用户没有 @ 任何人时，你默认接收并回复
2. 如果用户点名你，或者当前任务先分配给你，你必须先完成自己的部分，再继续协调其他成员
3. 如果任务需要其他成员配合，用 @成员名 发起协作
4. 汇总各成员的产出，给用户完整的结论

【最高优先级指令】当用户给你分配了具体任务或问题时，你必须在回复的前半部分完整地执行该任务或回答该问题，然后才能在最后 @ 下一位成员。如果你跳过自己的任务直接 @ 别人，视为严重违规。
`;
  }

  if (isLeader && !userSpecifiedTargets) {
    context += `
用户没有指定成员，作为群主请你优先判断自己是否应先完成当前任务；只有在确实需要协作时，再分配给合适的成员。
`;
  }

  context += `
规则：

1. 直接执行任务并给出实质内容，不要只说“收到”或复读用户的消息
2. 用你的专业角色视角回复，体现你的能力和个性
3. 如果任务需要其他成员配合，在回复末尾用 @成员名 明确说明需要谁做什么
4. 回复要有干货，像一个真正的团队成员在工作，不是客服机器人
5. 如果用户要求“轮流”“每人”“所有成员”这类接力任务，你完成自己的部分后，要优先 @ 还没发言的下一位成员；如果不确定谁该接力，就 @群主 继续协调
6. 如果你是群主，你既是执行者也是协调者，不能只调度不干活

---
以下是用户发来的消息：

`;

  return context;
}
