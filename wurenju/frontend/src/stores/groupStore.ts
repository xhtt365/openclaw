import { create } from "zustand";
import { gateway } from "@/services/gateway";
import { useAgentStore, type Agent } from "@/stores/agentStore";
import { buildGroupContext, type GroupMember } from "@/utils/groupContext";
import { adaptHistoryMessages, type ChatMessage, type ChatUsage } from "@/utils/messageAdapter";

const GROUP_STORAGE_KEY = "wurenju.groups.v1";
const DEFAULT_GROUP_CONTEXT_WINDOW = 8192;
const GROUP_HISTORY_PULL_LIMIT = 24;
const MAX_GROUP_ROUTE_DEPTH = 6;

const pendingGroupSendCounts = new Map<string, number>();
const groupMessageEpochs = new Map<string, number>();

export type AgentInfo = {
  id: string;
  name: string;
  emoji?: string;
  avatarUrl?: string;
  role?: string;
};

export type Group = {
  id: string;
  name: string;
  description?: string;
  members: AgentInfo[];
  leaderId: string;
  createdAt: string;
};

export type GroupChatMessage = ChatMessage & {
  senderId?: string;
  senderName?: string;
  senderEmoji?: string;
  senderAvatarUrl?: string;
};

export type ThinkingAgent = {
  id: string;
  name: string;
  pendingCount: number;
};

export type GroupArchive = {
  id: string;
  groupId: string;
  groupName: string;
  createdAt: string;
  messages: GroupChatMessage[];
};

type CreateGroupInput = {
  name: string;
  description?: string;
  members: AgentInfo[];
  leaderId: string;
};

type GroupPersistence = {
  groups: Group[];
  selectedGroupId: string | null;
  messagesByGroupId: Record<string, GroupChatMessage[]>;
  archives: GroupArchive[];
};

type GroupState = GroupPersistence & {
  thinkingAgentsByGroupId: Map<string, Map<string, ThinkingAgent>>;
  isSendingByGroupId: Record<string, boolean>;
  fetchGroups: () => void;
  createGroup: (data: CreateGroupInput) => Group;
  selectGroup: (groupId: string) => void;
  clearSelectedGroup: () => void;
  sendGroupMessage: (groupId: string, text: string) => Promise<void>;
  getThinkingAgentsForGroup: (groupId: string) => ThinkingAgent[];
  addThinkingAgents: (groupId: string, agents: AgentInfo[]) => ThinkingAgent[];
  removeThinkingAgent: (groupId: string, agentId: string) => ThinkingAgent[];
  clearThinkingAgents: (groupId: string) => void;
  archiveGroupMessages: (groupId: string) => boolean;
  resetGroupMessages: (groupId: string) => void;
};

type GroupDispatchSource = {
  senderId?: string;
  senderName: string;
  depth: number;
  type: "user" | "assistant";
};

type ThinkingBuckets = Map<string, Map<string, ThinkingAgent>>;
type ThinkingUpdateResult = {
  thinkingAgentsByGroupId: ThinkingBuckets;
  currentAgents: ThinkingAgent[];
};

type ThinkingAddResult = ThinkingUpdateResult & {
  addedAgents: ThinkingAgent[];
};

type ThinkingRemoveResult = ThinkingUpdateResult & {
  removedAgent: ThinkingAgent | null;
};

type ThinkingCompleteResult = ThinkingUpdateResult & {
  removedAgent: ThinkingAgent | null;
  addedAgents: ThinkingAgent[];
  remainingAfterComplete: ThinkingAgent[];
};

const EMPTY_THINKING_GROUP: Map<string, ThinkingAgent> = new Map();

function emptyPersistence(): GroupPersistence {
  return {
    groups: [],
    selectedGroupId: null,
    messagesByGroupId: {},
    archives: [],
  };
}

function estimateTokens(content: string) {
  const compact = content.replace(/\s+/g, "");
  if (!compact) {
    return 0;
  }

  return Math.max(1, Math.ceil(compact.length * 1.1));
}

function normalizeMembers(members: AgentInfo[]) {
  const uniqueMembers = new Map<string, AgentInfo>();

  members.forEach((member) => {
    if (!member.id.trim()) {
      return;
    }

    uniqueMembers.set(member.id, {
      id: member.id,
      name: member.name.trim() || member.id,
      emoji: member.emoji?.trim() || undefined,
      avatarUrl: member.avatarUrl?.trim() || undefined,
      role: member.role?.trim() || undefined,
    });
  });

  return Array.from(uniqueMembers.values());
}

function normalizeGroup(item: unknown): Group | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const maybeGroup = item as Partial<Group>;
  if (
    typeof maybeGroup.id !== "string" ||
    typeof maybeGroup.name !== "string" ||
    typeof maybeGroup.leaderId !== "string" ||
    !Array.isArray(maybeGroup.members) ||
    typeof maybeGroup.createdAt !== "string"
  ) {
    return null;
  }

  return {
    id: maybeGroup.id,
    name: maybeGroup.name.trim(),
    description:
      typeof maybeGroup.description === "string"
        ? maybeGroup.description.trim() || undefined
        : undefined,
    members: normalizeMembers(maybeGroup.members),
    leaderId: maybeGroup.leaderId,
    createdAt: maybeGroup.createdAt,
  };
}

function normalizeUsage(usage: unknown): ChatUsage | undefined {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const maybeUsage = usage as Partial<ChatUsage>;
  const input = typeof maybeUsage.input === "number" ? maybeUsage.input : 0;
  const output = typeof maybeUsage.output === "number" ? maybeUsage.output : 0;
  const cacheRead = typeof maybeUsage.cacheRead === "number" ? maybeUsage.cacheRead : 0;
  const cacheWrite = typeof maybeUsage.cacheWrite === "number" ? maybeUsage.cacheWrite : 0;
  const totalTokens =
    typeof maybeUsage.totalTokens === "number"
      ? maybeUsage.totalTokens
      : input + output + cacheRead + cacheWrite;

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens,
  };
}

function normalizeMessage(item: unknown): GroupChatMessage | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const maybeMessage = item as Partial<GroupChatMessage>;
  if (maybeMessage.role !== "user" && maybeMessage.role !== "assistant") {
    return null;
  }

  if (typeof maybeMessage.content !== "string") {
    return null;
  }

  return {
    id:
      typeof maybeMessage.id === "string" && maybeMessage.id.trim()
        ? maybeMessage.id
        : crypto.randomUUID(),
    role: maybeMessage.role,
    content: maybeMessage.content,
    thinking: typeof maybeMessage.thinking === "string" ? maybeMessage.thinking : undefined,
    model: typeof maybeMessage.model === "string" ? maybeMessage.model : undefined,
    usage: normalizeUsage(maybeMessage.usage),
    timestamp:
      typeof maybeMessage.timestamp === "number" && Number.isFinite(maybeMessage.timestamp)
        ? maybeMessage.timestamp
        : Date.now(),
    timestampLabel:
      typeof maybeMessage.timestampLabel === "string" ? maybeMessage.timestampLabel : undefined,
    isLoading: false,
    isNew: false,
    isHistorical: true,
    senderId: typeof maybeMessage.senderId === "string" ? maybeMessage.senderId : undefined,
    senderName: typeof maybeMessage.senderName === "string" ? maybeMessage.senderName : undefined,
    senderEmoji:
      typeof maybeMessage.senderEmoji === "string" ? maybeMessage.senderEmoji : undefined,
    senderAvatarUrl:
      typeof maybeMessage.senderAvatarUrl === "string" ? maybeMessage.senderAvatarUrl : undefined,
  };
}

function normalizeArchive(item: unknown): GroupArchive | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const maybeArchive = item as Partial<GroupArchive>;
  if (
    typeof maybeArchive.id !== "string" ||
    typeof maybeArchive.groupId !== "string" ||
    typeof maybeArchive.groupName !== "string" ||
    typeof maybeArchive.createdAt !== "string" ||
    !Array.isArray(maybeArchive.messages)
  ) {
    return null;
  }

  return {
    id: maybeArchive.id,
    groupId: maybeArchive.groupId,
    groupName: maybeArchive.groupName,
    createdAt: maybeArchive.createdAt,
    messages: maybeArchive.messages
      .map(normalizeMessage)
      .filter((message): message is GroupChatMessage => message !== null),
  };
}

function ensureMessageBuckets(
  groups: Group[],
  messagesByGroupId: Record<string, GroupChatMessage[]>,
) {
  const nextBuckets: Record<string, GroupChatMessage[]> = {};

  groups.forEach((group) => {
    nextBuckets[group.id] = messagesByGroupId[group.id] ?? [];
  });

  return nextBuckets;
}

function readStoredState(): GroupPersistence {
  if (typeof window === "undefined") {
    return emptyPersistence();
  }

  try {
    const raw = window.localStorage.getItem(GROUP_STORAGE_KEY);
    if (!raw) {
      return emptyPersistence();
    }

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const groups = parsed.map(normalizeGroup).filter((group): group is Group => group !== null);
      return {
        groups,
        selectedGroupId: null,
        messagesByGroupId: ensureMessageBuckets(groups, {}),
        archives: [],
      };
    }

    if (!parsed || typeof parsed !== "object") {
      return emptyPersistence();
    }

    const maybeState = parsed as Partial<GroupPersistence>;
    const groups = Array.isArray(maybeState.groups)
      ? maybeState.groups.map(normalizeGroup).filter((group): group is Group => group !== null)
      : [];
    const rawMessages =
      maybeState.messagesByGroupId && typeof maybeState.messagesByGroupId === "object"
        ? maybeState.messagesByGroupId
        : {};
    const messagesByGroupId = ensureMessageBuckets(
      groups,
      Object.fromEntries(
        Object.entries(rawMessages).map(([groupId, messages]) => [
          groupId,
          Array.isArray(messages)
            ? messages
                .map(normalizeMessage)
                .filter((message): message is GroupChatMessage => message !== null)
            : [],
        ]),
      ),
    );
    const archives = Array.isArray(maybeState.archives)
      ? maybeState.archives
          .map(normalizeArchive)
          .filter((archive): archive is GroupArchive => archive !== null)
      : [];
    const selectedGroupId =
      typeof maybeState.selectedGroupId === "string" &&
      groups.some((group) => group.id === maybeState.selectedGroupId)
        ? maybeState.selectedGroupId
        : null;

    return {
      groups,
      selectedGroupId,
      messagesByGroupId,
      archives,
    };
  } catch (error) {
    console.error("[Group] 读取项目组缓存失败:", error);
    return emptyPersistence();
  }
}

function writeStoredState(state: GroupPersistence) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("[Group] 写入项目组缓存失败:", error);
  }
}

function toPersistence(
  state: Pick<GroupState, "groups" | "selectedGroupId" | "messagesByGroupId" | "archives">,
): GroupPersistence {
  return {
    groups: state.groups,
    selectedGroupId: state.selectedGroupId,
    messagesByGroupId: state.messagesByGroupId,
    archives: state.archives,
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return fallback;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveGroupMembers(group: Group, agents: Agent[]) {
  const agentMap = new Map(agents.map((agent) => [agent.id, agent]));
  const resolvedMembers = normalizeMembers(
    group.members.map((member) => {
      const latestAgent = agentMap.get(member.id);
      return {
        id: member.id,
        name: latestAgent?.name?.trim() || member.name,
        emoji: latestAgent?.emoji?.trim() || member.emoji,
        avatarUrl: latestAgent?.avatarUrl?.trim() || member.avatarUrl,
        role: latestAgent?.role?.trim() || member.role,
      };
    }),
  );

  if (resolvedMembers.some((member) => member.id === group.leaderId)) {
    return resolvedMembers;
  }

  const leader = agentMap.get(group.leaderId);
  if (!leader) {
    return resolvedMembers;
  }

  return normalizeMembers([
    ...resolvedMembers,
    {
      id: leader.id,
      name: leader.name,
      emoji: leader.emoji,
      avatarUrl: leader.avatarUrl,
      role: leader.role,
    },
  ]);
}

function buildGroupSessionKey(agentId: string, mainKey: string) {
  return `agent:${agentId}:${mainKey}`;
}

function findMentionIndex(text: string, name: string) {
  const safeName = name.trim();
  if (!safeName) {
    return -1;
  }

  const matcher = new RegExp(
    `(?:^|[\\s（(])@${escapeRegExp(safeName)}(?=$|\\s|[，。,.!?！？:：；;、）)])`,
    "i",
  );
  return text.search(matcher);
}

function extractMentionTargets(text: string, members: AgentInfo[], excludeMemberIds: string[] = []) {
  const excluded = new Set(excludeMemberIds);
  return members
    .map((member) => ({
      member,
      index: findMentionIndex(text, member.name),
    }))
    .filter((entry) => entry.index >= 0 && !excluded.has(entry.member.id))
    .toSorted((left, right) => left.index - right.index)
    .map((entry) => entry.member);
}

function resolveTargetMembers(group: Group, text: string, agents: Agent[]) {
  const members = resolveGroupMembers(group, agents);
  const mentionedMembers = extractMentionTargets(text, members);

  if (mentionedMembers.length > 0) {
    return {
      members,
      targets: mentionedMembers,
      userSpecifiedTargets: true,
    };
  }

  const leader = members.find((member) => member.id === group.leaderId) ?? members[0] ?? null;
  return {
    members,
    targets: leader ? [leader] : [],
    userSpecifiedTargets: false,
  };
}

function toContextMembers(members: AgentInfo[]): GroupMember[] {
  return members.map((member) => ({
    id: member.id,
    name: member.name,
    title: member.role,
  }));
}

function buildRelayMessage(senderName: string, text: string) {
  return [
    `[群内协作转发] 以下内容来自项目组成员「${senderName}」在群聊中的最新发言。`,
    "请你直接回应这条协作请求，给出实质内容；如果还需要其他成员配合，可以继续 @成员名。",
    "",
    text,
  ].join("\n");
}

function getThinkingAgentsFromBuckets(thinkingAgentsByGroupId: ThinkingBuckets, groupId: string) {
  const thinkingGroup = thinkingAgentsByGroupId.get(groupId) ?? EMPTY_THINKING_GROUP;
  return Array.from(thinkingGroup.values());
}

function withThinkingGroup(
  thinkingAgentsByGroupId: ThinkingBuckets,
  groupId: string,
  updater: (thinkingGroup: Map<string, ThinkingAgent>) => void,
) {
  const nextBuckets = new Map(thinkingAgentsByGroupId);
  const currentGroup = thinkingAgentsByGroupId.get(groupId) ?? EMPTY_THINKING_GROUP;
  const nextGroup = new Map(currentGroup);

  updater(nextGroup);

  if (nextGroup.size === 0) {
    nextBuckets.delete(groupId);
  } else {
    nextBuckets.set(groupId, nextGroup);
  }

  return nextBuckets;
}

function addThinkingAgentsToBuckets(
  thinkingAgentsByGroupId: ThinkingBuckets,
  groupId: string,
  agents: AgentInfo[],
): ThinkingAddResult {
  const addedAgents: ThinkingAgent[] = [];
  const nextBuckets = withThinkingGroup(thinkingAgentsByGroupId, groupId, (thinkingGroup) => {
    agents.forEach((agent) => {
      const safeName = agent.name.trim() || agent.id;
      const current = thinkingGroup.get(agent.id);

      if (!current) {
        const nextAgent = {
          id: agent.id,
          name: safeName,
          pendingCount: 1,
        };
        thinkingGroup.set(agent.id, nextAgent);
        addedAgents.push(nextAgent);
        return;
      }

      thinkingGroup.set(agent.id, {
        ...current,
        name: safeName,
        pendingCount: current.pendingCount + 1,
      });
    });
  });

  return {
    thinkingAgentsByGroupId: nextBuckets,
    currentAgents: getThinkingAgentsFromBuckets(nextBuckets, groupId),
    addedAgents,
  };
}

function removeThinkingAgentFromBuckets(
  thinkingAgentsByGroupId: ThinkingBuckets,
  groupId: string,
  agentId: string,
): ThinkingRemoveResult {
  let removedAgent: ThinkingAgent | null = null;
  const nextBuckets = withThinkingGroup(thinkingAgentsByGroupId, groupId, (thinkingGroup) => {
    const current = thinkingGroup.get(agentId);
    if (!current) {
      return;
    }

    removedAgent = current;
    if (current.pendingCount > 1) {
      thinkingGroup.set(agentId, {
        ...current,
        pendingCount: current.pendingCount - 1,
      });
      return;
    }

    thinkingGroup.delete(agentId);
  });

  return {
    thinkingAgentsByGroupId: nextBuckets,
    currentAgents: getThinkingAgentsFromBuckets(nextBuckets, groupId),
    removedAgent,
  };
}

function completeThinkingAgentsInBuckets(
  thinkingAgentsByGroupId: ThinkingBuckets,
  groupId: string,
  agentId: string,
  nextAgents: AgentInfo[],
): ThinkingCompleteResult {
  let removedAgent: ThinkingAgent | null = null;
  const addedAgents: ThinkingAgent[] = [];
  let remainingAfterComplete: ThinkingAgent[] = [];

  const nextBuckets = withThinkingGroup(thinkingAgentsByGroupId, groupId, (thinkingGroup) => {
    const current = thinkingGroup.get(agentId);
    if (current) {
      removedAgent = current;
      if (current.pendingCount > 1) {
        thinkingGroup.set(agentId, {
          ...current,
          pendingCount: current.pendingCount - 1,
        });
      } else {
        thinkingGroup.delete(agentId);
      }
    }

    remainingAfterComplete = Array.from(thinkingGroup.values());

    nextAgents.forEach((agent) => {
      const safeName = agent.name.trim() || agent.id;
      const existing = thinkingGroup.get(agent.id);

      if (!existing) {
        const nextThinkingAgent = {
          id: agent.id,
          name: safeName,
          pendingCount: 1,
        };
        thinkingGroup.set(agent.id, nextThinkingAgent);
        addedAgents.push(nextThinkingAgent);
        return;
      }

      thinkingGroup.set(agent.id, {
        ...existing,
        name: safeName,
        pendingCount: existing.pendingCount + 1,
      });
    });
  });

  return {
    thinkingAgentsByGroupId: nextBuckets,
    currentAgents: getThinkingAgentsFromBuckets(nextBuckets, groupId),
    removedAgent,
    addedAgents,
    remainingAfterComplete,
  };
}

function pickLatestAssistantReply(messages: ChatMessage[], startedAt: number) {
  const assistantMessages = messages.filter(
    (message) => message.role === "assistant" && message.content.trim(),
  );
  if (assistantMessages.length === 0) {
    return null;
  }

  const freshAssistantMessage =
    // 优先拿本轮发送之后生成的回复，避免误取旧历史。
    [...assistantMessages]
      .toReversed()
      .find(
        (message) =>
          typeof message.timestamp === "number" &&
          Number.isFinite(message.timestamp) &&
          message.timestamp >= startedAt - 1000,
      ) ?? null;

  return freshAssistantMessage ?? assistantMessages[assistantMessages.length - 1] ?? null;
}

export const useGroupStore = create<GroupState>((set, get) => {
  const initialState = readStoredState();

  function updateState(updater: (state: GroupState) => Partial<GroupState>) {
    set((state) => {
      const patch = updater(state);
      const nextState = { ...state, ...patch };
      writeStoredState(toPersistence(nextState));
      return patch;
    });
  }

  function syncThinkingBuckets(
    updater: (thinkingAgentsByGroupId: ThinkingBuckets) => ThinkingUpdateResult,
  ) {
    let result: ThinkingUpdateResult = {
      thinkingAgentsByGroupId: new Map(),
      currentAgents: [],
    };

    updateState((state) => {
      result = updater(state.thinkingAgentsByGroupId);
      return {
        thinkingAgentsByGroupId: result.thinkingAgentsByGroupId,
      };
    });

    return result;
  }

  function getGroupEpoch(groupId: string) {
    return groupMessageEpochs.get(groupId) ?? 0;
  }

  function bumpGroupEpoch(groupId: string) {
    const nextEpoch = getGroupEpoch(groupId) + 1;
    groupMessageEpochs.set(groupId, nextEpoch);
    return nextEpoch;
  }

  function beginGroupSend(groupId: string, count: number) {
    const nextCount = Math.max(0, (pendingGroupSendCounts.get(groupId) ?? 0) + count);
    pendingGroupSendCounts.set(groupId, nextCount);
    updateState((state) => ({
      isSendingByGroupId: {
        ...state.isSendingByGroupId,
        [groupId]: nextCount > 0,
      },
    }));
  }

  function finishGroupSend(groupId: string) {
    const currentCount = pendingGroupSendCounts.get(groupId) ?? 0;
    const nextCount = Math.max(0, currentCount - 1);

    if (nextCount === 0) {
      pendingGroupSendCounts.delete(groupId);
    } else {
      pendingGroupSendCounts.set(groupId, nextCount);
    }

    updateState((state) => ({
      isSendingByGroupId: {
        ...state.isSendingByGroupId,
        [groupId]: nextCount > 0,
      },
    }));
  }

  function cancelGroupPending(groupId: string) {
    bumpGroupEpoch(groupId);
    pendingGroupSendCounts.delete(groupId);
    updateState((state) => ({
      thinkingAgentsByGroupId: withThinkingGroup(state.thinkingAgentsByGroupId, groupId, (thinkingGroup) => {
        thinkingGroup.clear();
      }),
      isSendingByGroupId: {
        ...state.isSendingByGroupId,
        [groupId]: false,
      },
    }));
  }

  function addThinkingAgentsInternal(groupId: string, agents: AgentInfo[]) {
    return syncThinkingBuckets((thinkingAgentsByGroupId) =>
      addThinkingAgentsToBuckets(thinkingAgentsByGroupId, groupId, agents),
    ) as ThinkingAddResult;
  }

  function removeThinkingAgentInternal(groupId: string, agentId: string) {
    return syncThinkingBuckets((thinkingAgentsByGroupId) =>
      removeThinkingAgentFromBuckets(thinkingAgentsByGroupId, groupId, agentId),
    ) as ThinkingRemoveResult;
  }

  function completeThinkingAgentsInternal(groupId: string, agentId: string, nextAgents: AgentInfo[]) {
    return syncThinkingBuckets((thinkingAgentsByGroupId) =>
      completeThinkingAgentsInBuckets(thinkingAgentsByGroupId, groupId, agentId, nextAgents),
    ) as ThinkingCompleteResult;
  }

  function clearThinkingAgentsInternal(groupId: string) {
    syncThinkingBuckets((thinkingAgentsByGroupId) => {
      const nextBuckets = withThinkingGroup(thinkingAgentsByGroupId, groupId, (thinkingGroup) => {
        thinkingGroup.clear();
      });

      return {
        thinkingAgentsByGroupId: nextBuckets,
        currentAgents: [],
      };
    });
  }

  async function ensureGroupAgentRuntime(agent: Agent, agentStore = useAgentStore.getState()) {
    const currentModelRef =
      agent.modelName?.trim() ||
      agentStore.agents.find((item) => item.id === agent.id)?.modelName?.trim() ||
      agentStore.defaultModelLabel?.trim() ||
      "";

    if (currentModelRef.startsWith("openai/")) {
      await agentStore.ensureModelRuntimeConfig(agent.id, currentModelRef);
    }
  }

  async function loadLatestAssistantReply(sessionKey: string, startedAt: number) {
    const payload = await gateway.loadHistory(sessionKey, GROUP_HISTORY_PULL_LIMIT);
    const messages = adaptHistoryMessages(payload);
    return pickLatestAssistantReply(messages, startedAt);
  }

  function appendGroupAssistantMessage(groupId: string, message: GroupChatMessage) {
    updateState((state) => ({
      messagesByGroupId: {
        ...state.messagesByGroupId,
        [groupId]: [...(state.messagesByGroupId[groupId] ?? []), message],
      },
    }));
  }

  async function queueGroupDispatches(
    groupId: string,
    requests: Array<{
      group: Group;
      member: AgentInfo;
      members: AgentInfo[];
      text: string;
      userSpecifiedTargets: boolean;
      epoch: number;
      source: GroupDispatchSource;
    }>,
  ) {
    if (requests.length === 0) {
      return;
    }

    beginGroupSend(groupId, requests.length);
    await Promise.all(
      requests.map((request) =>
        dispatchMessageToTarget({
          groupId,
          group: request.group,
          member: request.member,
          members: request.members,
          text: request.text,
          userSpecifiedTargets: request.userSpecifiedTargets,
          epoch: request.epoch,
          source: request.source,
        }),
      ),
    );
  }

  async function dispatchMessageToTarget(params: {
    groupId: string;
    group: Group;
    member: AgentInfo;
    members: AgentInfo[];
    text: string;
    userSpecifiedTargets: boolean;
    epoch: number;
    source: GroupDispatchSource;
  }) {
    const { groupId, group, member, members, text, userSpecifiedTargets, epoch, source } = params;

    try {
      const agentStore = useAgentStore.getState();
      const liveAgent = agentStore.agents.find((agent) => agent.id === member.id);
      const targetMember = liveAgent
        ? {
            ...member,
            name: liveAgent.name,
            emoji: liveAgent.emoji,
            avatarUrl: liveAgent.avatarUrl,
            role: liveAgent.role,
          }
        : member;

      const targetAgent = liveAgent ?? {
        id: targetMember.id,
        name: targetMember.name,
        emoji: targetMember.emoji || "",
        avatarUrl: targetMember.avatarUrl,
        role: targetMember.role,
      };

      if (!agentStore.mainKey.trim()) {
        throw new Error("当前 Agent 会话未就绪，请稍后重试");
      }

      await ensureGroupAgentRuntime(targetAgent, agentStore);

      const contextPrefix = buildGroupContext({
        groupName: group.name,
        members: toContextMembers(members),
        leaderId: group.leaderId,
        targetAgentId: targetMember.id,
        userSpecifiedTargets,
      });
      const payloadText =
        source.type === "assistant" ? buildRelayMessage(source.senderName, text) : text;
      const actualMessage = `${contextPrefix}${payloadText}`;
      const sessionKey = buildGroupSessionKey(targetMember.id, agentStore.mainKey);
      const startedAt = Date.now();

      console.log(`[Group] 注入群聊上下文 → Agent: ${targetMember.name}, 群: ${group.name}`);
      const result = await gateway.sendChat(actualMessage, sessionKey);
      if (!result.ok) {
        throw new Error(result.error?.message?.trim() || "连接 Gateway 失败，请确认服务已启动");
      }

      // 群聊不复用 1v1 的活跃回复桶，直接回拉目标 Agent 的历史拿最终结果。
      const reply = await loadLatestAssistantReply(sessionKey, startedAt);
      if (!reply) {
        throw new Error("未获取到 Agent 回复");
      }

      if (getGroupEpoch(groupId) !== epoch) {
        return;
      }

      appendGroupAssistantMessage(groupId, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: reply.content,
        thinking: reply.thinking,
        model: reply.model,
        usage: reply.usage,
        timestamp: reply.timestamp ?? Date.now(),
        timestampLabel: reply.timestampLabel,
        isLoading: false,
        isNew: true,
        isHistorical: false,
        senderId: targetMember.id,
        senderName: targetMember.name,
        senderEmoji: targetMember.emoji,
        senderAvatarUrl: targetMember.avatarUrl,
      });
      console.log(`[Group] 群成员回复: ${targetMember.name}`);

      if (source.depth >= MAX_GROUP_ROUTE_DEPTH) {
        const completionResult = completeThinkingAgentsInternal(groupId, targetMember.id, []);
        const remainingNames = completionResult.remainingAfterComplete
          .map((item) => item.name)
          .join(", ");
        console.log(
          `[Group] 回复完成: ${targetMember.name}, 剩余思考中: ${remainingNames || "无"}`,
        );
        console.warn(`[Group] 群内协作转发达到深度上限: ${group.name}`);
        return;
      }

      const nextTargets = extractMentionTargets(reply.content, members, [targetMember.id]);
      const completionResult = completeThinkingAgentsInternal(groupId, targetMember.id, nextTargets);
      const remainingNames = completionResult.remainingAfterComplete
        .map((item) => item.name)
        .join(", ");
      console.log(
        `[Group] 回复完成: ${targetMember.name}, 剩余思考中: ${remainingNames || "无"}`,
      );

      if (completionResult.addedAgents.length > 0) {
        console.log(
          `[Group] 递归路由: ${targetMember.name} 的回复触发 → ${completionResult.addedAgents.map((item) => item.name).join("、")} 加入思考`,
        );
      }

      if (nextTargets.length === 0) {
        return;
      }

      await queueGroupDispatches(
        groupId,
        nextTargets.map((nextTarget) => ({
          group,
          member: nextTarget,
          members,
          text: reply.content,
          userSpecifiedTargets: true,
          epoch,
          source: {
            senderId: targetMember.id,
            senderName: targetMember.name,
            depth: source.depth + 1,
            type: "assistant",
          },
        })),
      );
    } catch (error) {
      const errorText = getErrorMessage(error, "连接 Gateway 失败，请确认服务已启动");
      console.error(`[Group] 群消息发送失败: ${member.name}`, error);

      const removeResult = removeThinkingAgentInternal(groupId, member.id);
      console.log(
        `[Group] 回复失败移出思考中: ${member.name}, 剩余思考中: ${removeResult.currentAgents.map((item) => item.name).join(", ") || "无"}`,
      );

      if (getGroupEpoch(groupId) === epoch) {
        appendGroupAssistantMessage(groupId, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `${member.name} 暂时无法回复。\n原始错误：${errorText}`,
          timestamp: Date.now(),
          isLoading: false,
          isNew: true,
          isHistorical: false,
          senderId: member.id,
          senderName: member.name,
          senderEmoji: member.emoji,
          senderAvatarUrl: member.avatarUrl,
        });
      }
    } finally {
      finishGroupSend(groupId);
    }
  }

  return {
    ...initialState,
    thinkingAgentsByGroupId: new Map(),
    isSendingByGroupId: {},

    fetchGroups: () => {
      const nextState = readStoredState();
      console.log(`[Group] 获取项目组列表: ${nextState.groups.length} 个`);
      set({
        ...nextState,
        thinkingAgentsByGroupId: new Map(),
        isSendingByGroupId: {},
      });
    },

    createGroup: (data) => {
      const name = data.name.trim();
      const description = data.description?.trim() || undefined;
      const members = normalizeMembers(data.members);
      const group: Group = {
        id: crypto.randomUUID(),
        name,
        description,
        members,
        leaderId: data.leaderId,
        createdAt: new Date().toISOString(),
      };

      let createdGroup = group;
      updateState((state) => {
        const nextGroups = [group, ...state.groups];
        const nextMessagesByGroupId = {
          ...state.messagesByGroupId,
          [group.id]: [],
        };

        console.log(`[Group] 创建项目组成功: ${group.name} (${group.id})`);
        createdGroup = group;
        return {
          groups: nextGroups,
          selectedGroupId: group.id,
          messagesByGroupId: ensureMessageBuckets(nextGroups, nextMessagesByGroupId),
        };
      });
      return createdGroup;
    },

    selectGroup: (groupId) => {
      console.log(`[Group] 选中项目组: ${groupId}`);
      updateState(() => ({
        selectedGroupId: groupId,
      }));
    },

    clearSelectedGroup: () => {
      console.log("[Group] 清空当前项目组选中态");
      updateState(() => ({
        selectedGroupId: null,
      }));
    },

    getThinkingAgentsForGroup: (groupId) => {
      return getThinkingAgentsFromBuckets(get().thinkingAgentsByGroupId, groupId);
    },

    addThinkingAgents: (groupId, agents) => {
      const result = addThinkingAgentsInternal(groupId, agents);
      return result.currentAgents;
    },

    removeThinkingAgent: (groupId, agentId) => {
      const result = removeThinkingAgentInternal(groupId, agentId);
      return result.currentAgents;
    },

    clearThinkingAgents: (groupId) => {
      clearThinkingAgentsInternal(groupId);
    },

    sendGroupMessage: async (groupId, text) => {
      const cleanText = text.trim();
      if (!cleanText) {
        return;
      }

      const group = get().groups.find((item) => item.id === groupId);
      if (!group) {
        return;
      }

      const userMessage: GroupChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: cleanText,
        timestamp: Date.now(),
        isNew: true,
        isHistorical: false,
      };

      const agentStore = useAgentStore.getState();
      const { members, targets, userSpecifiedTargets } = resolveTargetMembers(
        group,
        cleanText,
        agentStore.agents,
      );
      if (targets.length === 0) {
        console.error(`[Group] 发送群消息失败: ${group.name} 没有可用成员`);
        return;
      }

      const epoch = getGroupEpoch(groupId);

      console.log(
        `[Group] 发送群消息: ${group.name} -> ${targets.map((member) => member.name).join(", ")}`,
      );
      updateState((state) => ({
        messagesByGroupId: {
          ...state.messagesByGroupId,
          [groupId]: [...(state.messagesByGroupId[groupId] ?? []), userMessage],
        },
      }));

      addThinkingAgentsInternal(groupId, targets);
      console.log(`[Group] 思考中: ${targets.map((member) => member.name).join(", ")}`);

      await queueGroupDispatches(
        groupId,
        targets.map((member) => ({
          group,
          member,
          members,
          text: cleanText,
          userSpecifiedTargets,
          epoch,
          source: {
            senderName: "用户",
            depth: 0,
            type: "user",
          },
        })),
      );
    },

    archiveGroupMessages: (groupId) => {
      const group = get().groups.find((item) => item.id === groupId);
      const messages = get().messagesByGroupId[groupId] ?? [];
      if (!group || messages.length === 0) {
        return false;
      }

      cancelGroupPending(groupId);

      const archive: GroupArchive = {
        id: crypto.randomUUID(),
        groupId,
        groupName: group.name,
        createdAt: new Date().toISOString(),
        messages,
      };

      console.log(`[Group] 归档群聊记录: ${group.name}`);
      updateState((state) => ({
        archives: [archive, ...state.archives],
        messagesByGroupId: {
          ...state.messagesByGroupId,
          [groupId]: [],
        },
        isSendingByGroupId: {
          ...state.isSendingByGroupId,
          [groupId]: false,
        },
      }));
      return true;
    },

    resetGroupMessages: (groupId) => {
      cancelGroupPending(groupId);
      console.log(`[Group] 重置群聊记录: ${groupId}`);
      updateState((state) => ({
        messagesByGroupId: {
          ...state.messagesByGroupId,
          [groupId]: [],
        },
        isSendingByGroupId: {
          ...state.isSendingByGroupId,
          [groupId]: false,
        },
      }));
    },
  };
});

export function getGroupContextMetrics(messages: GroupChatMessage[]) {
  const inputTokens = messages.reduce((total, message) => {
    if (message.role !== "user") {
      return total;
    }

    return total + estimateTokens(message.content);
  }, 0);
  const assistantUsage = messages.reduce<ChatUsage>(
    (summary, message) => {
      if (message.role !== "assistant") {
        return summary;
      }

      const usage = message.usage;
      const output = usage?.output ?? estimateTokens(message.content);
      const input = usage?.input ?? 0;
      const cacheRead = usage?.cacheRead ?? 0;
      const cacheWrite = usage?.cacheWrite ?? 0;
      return {
        input: summary.input + input,
        output: summary.output + output,
        cacheRead: summary.cacheRead + cacheRead,
        cacheWrite: summary.cacheWrite + cacheWrite,
        totalTokens: summary.totalTokens + input + output + cacheRead + cacheWrite,
      };
    },
    {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
    },
  );
  const currentUsed = messages.reduce((total, message) => {
    return total + estimateTokens(message.content) + estimateTokens(message.thinking ?? "");
  }, 0);

  return {
    currentUsed,
    total: DEFAULT_GROUP_CONTEXT_WINDOW,
    inputTokens: inputTokens + assistantUsage.input,
    outputTokens: assistantUsage.output,
    cacheHitTokens: assistantUsage.cacheRead + assistantUsage.cacheWrite,
    totalConsumed:
      inputTokens +
      assistantUsage.input +
      assistantUsage.output +
      assistantUsage.cacheRead +
      assistantUsage.cacheWrite,
  };
}
