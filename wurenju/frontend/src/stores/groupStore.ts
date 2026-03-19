import { create } from "zustand";
import { gateway, type GatewayChatAttachmentInput } from "@/services/gateway";
import { useAgentStore, type Agent } from "@/stores/agentStore";
import { useDirectArchiveStore } from "@/stores/directArchiveStore";
import { useHealthStore } from "@/stores/healthStore";
import {
  hydrateArchiveTitles,
  resolveArchiveTitle,
  sanitizeArchiveTitle,
} from "@/utils/archiveTitle";
import {
  buildGroupAgentRequestMessage,
  normalizeGroupAnnouncement,
  type GroupMember,
} from "@/utils/groupContext";
import { GROUP_STORAGE_KEY, writeGroupStorageSnapshot } from "@/utils/groupPersistence";
import {
  DEFAULT_GROUP_RELAY_FALLBACK_LIMIT,
  inspectSequentialRelayRequest,
  resolveAssistantRelayTargets,
  type RelayIntentInspection,
} from "@/utils/groupRelay";
import { resolveAvatarImage } from "@/utils/groupSurface";
import { buildUrgeMessage, resolveUrgeNextDelayMs, resolveUrgeTargets } from "@/utils/groupUrge";
import {
  adaptHistoryMessage,
  adaptHistoryMessages,
  type ChatMessage,
  type ChatUsage,
} from "@/utils/messageAdapter";
import { sanitizeAssistantText } from "@/utils/messageSanitizer";
import {
  clearSidebarGroupUnreadCount,
  incrementSidebarGroupUnreadCount,
} from "@/utils/sidebarPersistence";

const DEFAULT_GROUP_CONTEXT_WINDOW = 8192;
const GROUP_HISTORY_PULL_LIMIT = 24;
const MAX_GROUP_ROUTE_DEPTH = 6;
const GROUP_RELAY_SETTLE_DELAY_MS = 2500;
const GROUP_RELAY_IDLE_TIMEOUT_MS = 5000;
const GROUP_COMPACT_THRESHOLD = 30;
const GROUP_COMPACT_KEEP_RECENT = 5;
const GROUP_COMPACT_HISTORY_LIMIT = 200;

const pendingGroupSendCounts = new Map<string, number>();
const groupMessageEpochs = new Map<string, number>();
const groupRoundStates = new Map<string, GroupRoundState>();
const groupRelayIdleTimerIds = new Map<string, number>();
const groupRelaySettleTimerIds = new Map<string, number>();
const groupUrgeTimerIds = new Map<string, number>();
const compactingAgents = new Set<string>();
let groupUrgeVisibilityHandler: (() => void) | null = null;

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
  avatarUrl?: string;
  description?: string;
  announcement?: string;
  announcementVersion?: number;
  notificationsEnabled?: boolean;
  soundEnabled?: boolean;
  isUrging?: boolean;
  urgeIntervalMinutes?: number;
  urgeStartedAt?: number;
  urgeCount?: number;
  isUrgePaused?: boolean;
  urgeLastCheckedAt?: number;
  members: AgentInfo[];
  leaderId: string;
  createdAt: string;
};

export type GroupChatMessage = ChatMessage & {
  senderId?: string;
  senderName?: string;
  senderEmoji?: string;
  senderAvatarUrl?: string;
  sessionTargetIds?: string[];
};

export type ThinkingAgent = {
  id: string;
  name: string;
  pendingCount: number;
  detail?: string;
};

export type GroupArchive = {
  id: string;
  groupId: string;
  groupName: string;
  groupAvatarUrl?: string;
  title: string;
  createdAt: string;
  messages: GroupChatMessage[];
};

type CreateGroupInput = {
  name: string;
  avatarUrl?: string;
  description?: string;
  members: AgentInfo[];
  leaderId: string;
};

type GroupPersistence = {
  groups: Group[];
  selectedGroupId: string | null;
  selectedArchiveId: string | null;
  messagesByGroupId: Record<string, GroupChatMessage[]>;
  archives: GroupArchive[];
};

type GroupActionResult = {
  success: boolean;
  error?: string;
};

type GroupArchiveActionResult = GroupActionResult & {
  archiveId?: string;
};

export type CleanupGroupStateOptions = {
  archive?: GroupArchive;
};

type GroupState = GroupPersistence & {
  thinkingAgentsByGroupId: Map<string, Map<string, ThinkingAgent>>;
  announcementSyncStatus: Map<string, Record<string, number>>;
  isSendingByGroupId: Record<string, boolean>;
  fetchGroups: () => void;
  createGroup: (data: CreateGroupInput) => Group;
  selectGroup: (groupId: string) => void;
  clearSelectedGroup: () => void;
  selectArchive: (archiveId: string) => void;
  clearSelectedArchive: () => void;
  deleteArchive: (archiveId: string) => void;
  renameArchive: (archiveId: string, title: string) => boolean;
  updateGroupInfo: (
    groupId: string,
    payload: {
      name: string;
      avatarUrl?: string | null;
      description?: string;
    },
  ) => void;
  updateGroupAnnouncement: (groupId: string, announcement: string) => void;
  setGroupNotificationsEnabled: (groupId: string, enabled: boolean) => void;
  setGroupSoundEnabled: (groupId: string, enabled: boolean) => void;
  sendGroupMessage: (
    groupId: string,
    text: string,
    attachments?: GatewayChatAttachmentInput[],
  ) => Promise<void>;
  mirrorCronReplyToGroup: (params: {
    groupId: string;
    agentId: string;
    jobId: string;
    message: ChatMessage;
  }) => void;
  startGroupUrging: (groupId: string, intervalMinutes: number) => void;
  pauseGroupUrging: (groupId: string) => void;
  resumeGroupUrging: (groupId: string) => void;
  stopGroupUrging: (groupId: string) => void;
  restoreGroupUrging: (groupId: string) => void;
  clearGroupUrgeRuntime: (groupId: string, reason?: string) => void;
  compensateGroupUrge: (groupId: string) => void;
  getThinkingAgentsForGroup: (groupId: string) => ThinkingAgent[];
  addThinkingAgents: (groupId: string, agents: AgentInfo[]) => ThinkingAgent[];
  removeThinkingAgent: (groupId: string, agentId: string) => ThinkingAgent[];
  clearThinkingAgents: (groupId: string) => void;
  handleMemberRemoved: (groupId: string, member: AgentInfo) => void;
  cleanupGroupState: (
    groupId: string,
    options?: CleanupGroupStateOptions,
  ) => Promise<GroupArchiveActionResult>;
  archiveGroupMessages: (groupId: string, title?: string) => Promise<GroupArchiveActionResult>;
  archiveGroupSession: (groupId: string, title?: string) => Promise<GroupArchiveActionResult>;
  resetGroupMessages: (groupId: string) => Promise<GroupActionResult>;
  dissolveGroup: (groupId: string) => Promise<GroupActionResult>;
  removeAgentData: (agentId: string) => void;
};

type GroupDispatchSource = {
  senderId?: string;
  senderName: string;
  depth: number;
  type: "user" | "assistant" | "announcement" | "urge" | "system";
  systemReason?:
    | "failure_fallback"
    | "failure_skip"
    | "leader_fallback"
    | "member_removed"
    | "watchdog";
};

type GroupDispatchRequest = {
  group: Group;
  member: AgentInfo;
  members: AgentInfo[];
  text: string;
  attachments?: GatewayChatAttachmentInput[];
  userSpecifiedTargets: boolean;
  epoch: number;
  source: GroupDispatchSource;
  skipRelayDetection?: boolean;
  showReplyInUi?: boolean;
  showThinkingStatus?: boolean;
  skipAutoCompact?: boolean;
  requireReply?: boolean;
};

type GroupDispatchResult = {
  member: AgentInfo;
  reply: ChatMessage | null;
  ok: boolean;
};

type GroupRoundState = {
  epoch: number;
  triggerText: string;
  leaderId: string;
  allMembersMode: boolean;
  failedAgentIds: Set<string>;
  pendingAgentIds: Set<string>;
  spokenAgentIds: Set<string>;
  remainingAgentIds: string[];
  interventionCount: number;
  interventionLimit: number;
  lastReplyAt: number;
  lastReplyMemberId?: string;
  lastReplyMemberName?: string;
  lastReplyContent?: string;
  lastReplyDepth: number;
  lastDispatchSourceType: GroupDispatchSource["type"];
  lastDispatchSystemReason?: GroupDispatchSource["systemReason"];
  intent: RelayIntentInspection;
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
    selectedArchiveId: null,
    messagesByGroupId: {},
    archives: [],
  };
}

function cloneGroupMessages(messages: GroupChatMessage[]) {
  return messages.map((message) => ({
    ...message,
    usage: message.usage
      ? {
          ...message.usage,
          cost: message.usage.cost ? { ...message.usage.cost } : undefined,
        }
      : undefined,
  }));
}

function sortGroupArchivesByNewest(archives: GroupArchive[]) {
  return [...archives].toSorted(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

function createGroupArchive(
  group: Group,
  messages: GroupChatMessage[],
  existingArchives: GroupArchive[],
  title?: string,
): GroupArchive {
  const createdAt = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    groupId: group.id,
    groupName: group.name,
    groupAvatarUrl: group.avatarUrl,
    title: resolveArchiveTitle({
      title,
      sourceName: group.name,
      archivedAt: createdAt,
      siblingArchives: existingArchives.map((archive) => ({
        title: archive.title,
        sourceName: archive.groupName,
        archivedAt: archive.createdAt,
      })),
    }),
    createdAt,
    messages: cloneGroupMessages(messages),
  };
}

function collectGroupSessionMemberIds(group: Group) {
  return Array.from(
    new Set(
      [group.leaderId, ...normalizeMembers(group.members).map((member) => member.id)].filter(
        (memberId) => memberId.trim(),
      ),
    ),
  );
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
      avatarUrl: resolveAvatarImage(member) ?? undefined,
      role: member.role?.trim() || undefined,
    });
  });

  return Array.from(uniqueMembers.values());
}

function normalizeSessionTargetIds(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const targetIds = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  return targetIds.length > 0 ? targetIds : undefined;
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
    avatarUrl: resolveAvatarImage(maybeGroup) ?? undefined,
    description:
      typeof maybeGroup.description === "string"
        ? maybeGroup.description.trim() || undefined
        : undefined,
    announcement:
      typeof maybeGroup.announcement === "string"
        ? normalizeGroupAnnouncement(maybeGroup.announcement)
        : undefined,
    announcementVersion:
      typeof maybeGroup.announcementVersion === "number" &&
      Number.isFinite(maybeGroup.announcementVersion)
        ? maybeGroup.announcementVersion
        : undefined,
    notificationsEnabled: maybeGroup.notificationsEnabled !== false,
    soundEnabled: maybeGroup.soundEnabled !== false,
    isUrging: maybeGroup.isUrging === true,
    urgeIntervalMinutes:
      typeof maybeGroup.urgeIntervalMinutes === "number" &&
      Number.isFinite(maybeGroup.urgeIntervalMinutes)
        ? maybeGroup.urgeIntervalMinutes
        : undefined,
    urgeStartedAt:
      typeof maybeGroup.urgeStartedAt === "number" && Number.isFinite(maybeGroup.urgeStartedAt)
        ? maybeGroup.urgeStartedAt
        : undefined,
    urgeCount:
      typeof maybeGroup.urgeCount === "number" && Number.isFinite(maybeGroup.urgeCount)
        ? Math.max(0, Math.floor(maybeGroup.urgeCount))
        : undefined,
    isUrgePaused: maybeGroup.isUrgePaused === true,
    urgeLastCheckedAt:
      typeof maybeGroup.urgeLastCheckedAt === "number" &&
      Number.isFinite(maybeGroup.urgeLastCheckedAt)
        ? maybeGroup.urgeLastCheckedAt
        : undefined,
    members: normalizeMembers(maybeGroup.members),
    leaderId: maybeGroup.leaderId,
    createdAt: maybeGroup.createdAt,
  };
}

function normalizeMessage(item: unknown): GroupChatMessage | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const maybeMessage = item as Partial<GroupChatMessage> & {
    senderAvatar?: unknown;
    senderImage?: unknown;
  };
  const adapted = adaptHistoryMessage(item);
  if (!adapted) {
    return null;
  }

  return {
    ...adapted,
    thinking:
      adapted.thinking ??
      (typeof maybeMessage.thinking === "string"
        ? sanitizeAssistantText(maybeMessage.thinking)
        : undefined),
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
      resolveAvatarImage({
        avatarUrl: maybeMessage.senderAvatarUrl,
        avatar: (maybeMessage as { senderAvatar?: unknown }).senderAvatar,
        image: (maybeMessage as { senderImage?: unknown }).senderImage,
      }) ??
      resolveAvatarImage(maybeMessage) ??
      undefined,
    sessionTargetIds: normalizeSessionTargetIds(
      (maybeMessage as { sessionTargetIds?: unknown }).sessionTargetIds,
    ),
  };
}

function normalizeArchive(item: unknown): GroupArchive | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const maybeArchive = item as Partial<GroupArchive> &
    Record<string, unknown> & {
      archiveId?: unknown;
      archivedAt?: unknown;
      history?: unknown;
      items?: unknown;
      name?: unknown;
      group?: unknown;
    };
  const messagesSource = Array.isArray(maybeArchive.messages)
    ? maybeArchive.messages
    : Array.isArray(maybeArchive.history)
      ? maybeArchive.history
      : Array.isArray(maybeArchive.items)
        ? maybeArchive.items
        : [];
  const normalizedMessages = messagesSource
    .map(normalizeMessage)
    .filter((message): message is GroupChatMessage => message !== null);
  const nestedGroup =
    maybeArchive.group && typeof maybeArchive.group === "object"
      ? (maybeArchive.group as Record<string, unknown>)
      : null;
  const legacyGroupId =
    typeof maybeArchive.groupId === "string" && maybeArchive.groupId.trim()
      ? maybeArchive.groupId.trim()
      : nestedGroup && typeof nestedGroup.id === "string" && nestedGroup.id.trim()
        ? nestedGroup.id.trim()
        : "";
  const id =
    typeof maybeArchive.id === "string" && maybeArchive.id.trim()
      ? maybeArchive.id.trim()
      : typeof maybeArchive.archiveId === "string" && maybeArchive.archiveId.trim()
        ? maybeArchive.archiveId.trim()
        : legacyGroupId
          ? legacyGroupId
          : "";
  const groupId = legacyGroupId || (id ? `legacy-group:${id}` : "");
  const groupName =
    typeof maybeArchive.groupName === "string" && maybeArchive.groupName.trim()
      ? maybeArchive.groupName.trim()
      : typeof maybeArchive.name === "string" && maybeArchive.name.trim()
        ? maybeArchive.name.trim()
        : nestedGroup && typeof nestedGroup.name === "string" && nestedGroup.name.trim()
          ? nestedGroup.name.trim()
          : "项目组归档";
  const groupAvatarUrl =
    resolveAvatarImage({
      avatarUrl:
        typeof maybeArchive.groupAvatarUrl === "string" ? maybeArchive.groupAvatarUrl : undefined,
      avatar: nestedGroup?.avatar,
      image: nestedGroup?.image,
    }) ??
    (nestedGroup ? resolveAvatarImage(nestedGroup) : undefined) ??
    undefined;
  const createdAt =
    typeof maybeArchive.createdAt === "string" && maybeArchive.createdAt.trim()
      ? maybeArchive.createdAt.trim()
      : typeof maybeArchive.archivedAt === "string" && maybeArchive.archivedAt.trim()
        ? maybeArchive.archivedAt.trim()
        : (() => {
            const latestTimestamp = normalizedMessages
              .map((message) => message.timestamp)
              .filter(
                (timestamp): timestamp is number =>
                  typeof timestamp === "number" && Number.isFinite(timestamp),
              )
              .reduce<number | null>(
                (latest, current) => (latest === null || current > latest ? current : latest),
                null,
              );
            return latestTimestamp !== null
              ? new Date(latestTimestamp).toISOString()
              : new Date(0).toISOString();
          })();

  if (!id || !groupId || !createdAt) {
    return null;
  }

  return {
    id,
    groupId,
    groupName,
    groupAvatarUrl,
    title:
      (typeof maybeArchive.title === "string" && maybeArchive.title.trim()) ||
      (typeof maybeArchive.archiveTitle === "string" && maybeArchive.archiveTitle.trim()) ||
      "",
    createdAt,
    messages: normalizedMessages,
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
        selectedArchiveId: null,
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
      ? sortGroupArchivesByNewest(
          hydrateArchiveTitles(
            maybeState.archives
              .map(normalizeArchive)
              .filter((archive): archive is GroupArchive => archive !== null),
            {
              getTitle: (archive) => archive.title,
              getSourceName: (archive) => archive.groupName,
              getArchivedAt: (archive) => archive.createdAt,
              setTitle: (archive, title) => ({
                ...archive,
                title,
              }),
            },
          ),
        )
      : [];
    const selectedGroupId =
      typeof maybeState.selectedGroupId === "string" &&
      groups.some((group) => group.id === maybeState.selectedGroupId)
        ? maybeState.selectedGroupId
        : null;
    const selectedArchiveId =
      typeof maybeState.selectedArchiveId === "string" &&
      archives.some((archive) => archive.id === maybeState.selectedArchiveId)
        ? maybeState.selectedArchiveId
        : null;

    return {
      groups,
      selectedGroupId,
      selectedArchiveId,
      messagesByGroupId,
      archives,
    };
  } catch (error) {
    console.error("[Group] 读取项目组缓存失败:", error);
    return emptyPersistence();
  }
}

function writeStoredState(state: GroupPersistence) {
  return writeGroupStorageSnapshot(state, "写入项目组缓存失败");
}

function toPersistence(
  state: Pick<
    GroupState,
    "groups" | "selectedGroupId" | "selectedArchiveId" | "messagesByGroupId" | "archives"
  >,
): GroupPersistence {
  return {
    groups: state.groups,
    selectedGroupId: state.selectedGroupId,
    selectedArchiveId: state.selectedArchiveId,
    messagesByGroupId: state.messagesByGroupId,
    archives: state.archives,
  };
}

function hasPersistenceChanged(previous: GroupPersistence, next: GroupPersistence) {
  return (
    previous.groups !== next.groups ||
    previous.selectedGroupId !== next.selectedGroupId ||
    previous.selectedArchiveId !== next.selectedArchiveId ||
    previous.messagesByGroupId !== next.messagesByGroupId ||
    previous.archives !== next.archives
  );
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

function buildGroupSessionKey(agentId: string, groupId: string) {
  const normalizedGroupId = encodeURIComponent(groupId.trim().toLowerCase() || "default");
  return `agent:${agentId}:group:${normalizedGroupId}`;
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

function extractMentionTargets(
  text: string,
  members: AgentInfo[],
  excludeMemberIds: string[] = [],
) {
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

function resolveDispatchLogPrefix(type: GroupDispatchSource["type"]) {
  if (type === "announcement") {
    return "[Announce]";
  }

  if (type === "urge") {
    return "[Urge]";
  }

  if (type === "system") {
    return "[System]";
  }

  return "[Group]";
}

function buildAnnouncementBroadcastVisibleMessage(announcement: string) {
  return `📢 群公告已更新：

${announcement}

请所有成员立刻根据公告内容中与你相关的部分采取行动，并在群聊中回复执行结果。如果公告中要求你读取某个文件，请使用 read 工具读取后按要求行动。`;
}

function buildAnnouncementBroadcastDispatchMessage(announcement: string) {
  return `${buildAnnouncementBroadcastVisibleMessage(announcement)}

这是一条群公告同步消息，不要在群里展开讨论。阅读后请仅回复“已知悉公告”。`;
}

function buildUrgeDecisionRequestMessage() {
  return `[系统-督促检查] 请根据群内最近的对话记录，判断当前是否还有未完成的任务或未回复的请求。

请严格以 JSON 格式回答，不要添加任何其他文字：

{
  "needUrge": true或false,
  "targets": ["需要催促的成员名称，不包括群主自己"],
  "reason": "简要说明判断依据"
}

判断标准：

- 如果有成员被分配了任务但还没有回复结果 -> needUrge: true
- 如果所有已知任务都已完成、所有请求都已回复 -> needUrge: false
- 群主自己不需要催自己`;
}

type UrgeDecision = {
  needUrge: boolean;
  targets: string[];
  reason: string;
};

function parseUrgeDecisionReply(text: string): UrgeDecision | null {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return null;
  }

  const codeBlockMatch = normalizedText.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  const candidate = (codeBlockMatch?.[1] ?? normalizedText).trim();
  const jsonMatch = candidate.match(/\{[\s\S]*\}/u);
  if (!jsonMatch) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      needUrge?: unknown;
      targets?: unknown;
      reason?: unknown;
    };
    if (typeof parsed.needUrge !== "boolean" || !Array.isArray(parsed.targets)) {
      return null;
    }

    const targets = parsed.targets
      .filter((target): target is string => typeof target === "string")
      .map((target) => target.replace(/^@/u, "").trim())
      .filter(Boolean);

    return {
      needUrge: parsed.needUrge,
      targets,
      reason: typeof parsed.reason === "string" ? parsed.reason.trim() : "",
    };
  } catch {
    return null;
  }
}

function formatHistoryMessagesForCompact(messages: ChatMessage[]) {
  return messages
    .map((message, index) => {
      const role =
        message.role === "assistant" ? "助手" : message.role === "user" ? "用户" : "系统";
      const content = [
        message.content.trim(),
        message.thinking?.trim() ? `思考：${message.thinking.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      return `${index + 1}. [${role}]\n${content || "（空内容）"}`;
    })
    .join("\n\n");
}

function buildCompactSummaryPrompt(historyText: string) {
  return `请总结以下群聊记录的关键信息，输出一段简洁的摘要（不超过 500 字）。

必须保留：任务分配与责任人、已达成的结论和决策、未完成事项和待办、关键数据和数字。

可以丢弃：寒暄问候、重复讨论、中间过程细节、已完成且不再相关的历史任务。

以下是需要总结的对话记录：

${historyText}`;
}

function buildCompactSeedMessage(summary: string, recentHistoryText: string) {
  return `[系统-上下文压缩同步] 以下是压缩后的群聊上下文，请把它作为后续协作依据。

注意：

- 不要重复执行下面的历史任务
- 不要复述这段上下文
- 只在后续真正收到新消息时继续工作

摘要：

${summary}

最近保留的原始消息：

${recentHistoryText}

如果你已完成上下文同步，请仅回复“已整理”。`;
}

function messageBelongsToAgentSession(message: GroupChatMessage, agentId: string) {
  return message.senderId === agentId || message.sessionTargetIds?.includes(agentId) === true;
}

function cloneGroupRoundState(round: GroupRoundState): GroupRoundState {
  return {
    ...round,
    failedAgentIds: new Set(round.failedAgentIds),
    pendingAgentIds: new Set(round.pendingAgentIds),
    spokenAgentIds: new Set(round.spokenAgentIds),
    remainingAgentIds: [...round.remainingAgentIds],
  };
}

function getGroupRoundState(groupId: string) {
  return groupRoundStates.get(groupId) ?? null;
}

function setGroupRoundState(groupId: string, round: GroupRoundState | null) {
  if (!round) {
    groupRoundStates.delete(groupId);
    return;
  }

  groupRoundStates.set(groupId, round);
}

function clearGroupRelayIdleTimer(groupId: string, reason?: string) {
  if (typeof window === "undefined") {
    return;
  }

  const timerId = groupRelayIdleTimerIds.get(groupId);
  if (timerId === undefined) {
    return;
  }

  window.clearTimeout(timerId);
  groupRelayIdleTimerIds.delete(groupId);

  if (reason) {
    console.log(`[Group] 已清除接力兜底定时器: ${groupId}，原因: ${reason}`);
  }
}

function clearGroupRelaySettleTimer(groupId: string, reason?: string) {
  if (typeof window === "undefined") {
    return;
  }

  const timerId = groupRelaySettleTimerIds.get(groupId);
  if (timerId === undefined) {
    return;
  }

  window.clearTimeout(timerId);
  groupRelaySettleTimerIds.delete(groupId);

  if (reason) {
    console.log(`[Group] 已清除断裂检测定时器: ${groupId}，原因: ${reason}`);
  }
}

function clearGroupUrgeTimer(groupId: string, reason?: string) {
  if (typeof window === "undefined") {
    return;
  }

  const timerId = groupUrgeTimerIds.get(groupId);
  if (timerId === undefined) {
    return;
  }

  window.clearTimeout(timerId);
  groupUrgeTimerIds.delete(groupId);

  if (reason) {
    console.log(`[Urge] 已清除督促定时器: ${groupId}，原因: ${reason}`);
  }
}

function clearGroupCompactingState(groupId: string) {
  const compactingPrefix = `${groupId}:`;
  let removedCount = 0;

  Array.from(compactingAgents).forEach((compactingKey) => {
    if (!compactingKey.startsWith(compactingPrefix)) {
      return;
    }

    compactingAgents.delete(compactingKey);
    removedCount += 1;
  });

  if (removedCount > 0) {
    console.log(`[Compact] 已清理群聊压缩状态: ${groupId}，count=${removedCount}`);
  }
}

function removeGroupCompactionBackups(groupId: string) {
  if (typeof window === "undefined") {
    return;
  }

  const backupPrefix = `compacted:${groupId}:`;
  const backupKeys: string[] = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (typeof key === "string" && key.startsWith(backupPrefix)) {
      backupKeys.push(key);
    }
  }

  backupKeys.forEach((key) => {
    window.localStorage.removeItem(key);
  });

  if (backupKeys.length > 0) {
    console.log(`[Compact] 已移除群聊压缩备份: ${groupId}，count=${backupKeys.length}`);
  }
}

function clearGroupRoundState(groupId: string, reason?: string) {
  clearGroupRelayIdleTimer(groupId, reason);
  clearGroupRelaySettleTimer(groupId, reason);
  setGroupRoundState(groupId, null);

  if (reason) {
    console.log(`[Group] 本轮接力状态已清理: ${groupId}，原因: ${reason}`);
  }
}

function resolveGroupRouteDepthLimit(memberCount: number, interventionLimit: number) {
  return Math.max(
    MAX_GROUP_ROUTE_DEPTH,
    memberCount + interventionLimit + DEFAULT_GROUP_RELAY_FALLBACK_LIMIT,
  );
}

function findMemberById(members: AgentInfo[], memberId: string) {
  return members.find((member) => member.id === memberId) ?? null;
}

function resolveMembersByIds(members: AgentInfo[], memberIds: Iterable<string>) {
  return Array.from(memberIds)
    .map((memberId) => findMemberById(members, memberId))
    .filter((member): member is AgentInfo => member !== null);
}

function describeAgentNames(agents: AgentInfo[] | ThinkingAgent[]) {
  return agents.map((agent) => agent.name).join("、") || "无";
}

function describeIdsAsNames(members: AgentInfo[], memberIds: Iterable<string>) {
  return describeAgentNames(resolveMembersByIds(members, memberIds));
}

function getRoundPendingMembers(round: GroupRoundState, members: AgentInfo[]) {
  return resolveMembersByIds(members, round.pendingAgentIds).filter(
    (member) => !round.failedAgentIds.has(member.id),
  );
}

function getRoundRemainingMembers(round: GroupRoundState, members: AgentInfo[]) {
  return resolveMembersByIds(members, round.remainingAgentIds).filter(
    (member) => !round.failedAgentIds.has(member.id),
  );
}

function getRoundFailedMembers(round: GroupRoundState, members: AgentInfo[]) {
  return resolveMembersByIds(members, round.failedAgentIds);
}

function resolveRoundNextTargetId(round: GroupRoundState) {
  const nextPendingId =
    Array.from(round.pendingAgentIds).find((memberId) => !round.failedAgentIds.has(memberId)) ??
    null;
  if (nextPendingId) {
    return nextPendingId;
  }

  if (!round.allMembersMode) {
    return null;
  }

  return round.remainingAgentIds.find((memberId) => !round.failedAgentIds.has(memberId)) ?? null;
}

function pruneMemberFromRoundState(round: GroupRoundState, memberId: string) {
  round.pendingAgentIds.delete(memberId);
  round.spokenAgentIds.delete(memberId);
  round.failedAgentIds.delete(memberId);
  round.remainingAgentIds = round.remainingAgentIds.filter((id) => id !== memberId);
}

function addPendingMembersToRound(round: GroupRoundState, memberIds: string[]) {
  memberIds.forEach((memberId) => {
    if (!memberId.trim()) {
      return;
    }

    if (round.failedAgentIds.has(memberId)) {
      return;
    }

    if (round.allMembersMode && round.spokenAgentIds.has(memberId)) {
      return;
    }

    round.pendingAgentIds.add(memberId);
  });
}

function removePendingMemberFromRound(round: GroupRoundState, memberId: string) {
  round.pendingAgentIds.delete(memberId);
}

function markMemberSpoken(round: GroupRoundState, memberId: string) {
  round.spokenAgentIds.add(memberId);
  if (round.allMembersMode) {
    round.remainingAgentIds = round.remainingAgentIds.filter((id) => id !== memberId);
  }
}

function markMemberFailed(round: GroupRoundState, memberId: string) {
  removePendingMemberFromRound(round, memberId);
  round.failedAgentIds.add(memberId);
  if (round.allMembersMode) {
    round.remainingAgentIds = round.remainingAgentIds.filter((id) => id !== memberId);
  }
}

function buildLeaderFallbackMessage(params: {
  memberName: string;
  latestReply: string;
  nextMemberName?: string;
  remainingMemberNames: string[];
}) {
  return [
    `[群内接力兜底] 成员「${params.memberName}」已经完成当前环节，但没有 @ 下一位成员，接力中断了。`,
    params.nextMemberName
      ? `请你以群主身份接手，先简短衔接当前进度，再 @${params.nextMemberName} 继续这一轮任务。`
      : "请你以群主身份接手，检查还有谁没完成，并明确安排下一步。",
    params.remainingMemberNames.length > 0
      ? `当前还未完成的成员：${params.remainingMemberNames.join("、")}`
      : "当前看起来所有成员都已完成，请你确认后收尾。",
    "",
    "上一位成员的最新回复：",
    params.latestReply,
  ].join("\n");
}

function buildWatchdogRelayMessage(params: {
  previousMemberName: string;
  latestReply: string;
  triggerText: string;
  remainingMemberNames: string[];
}) {
  return [
    `[群内接力自动续接] 当前正在执行一轮所有成员依次参与的群聊任务，你是下一位需要发言的成员。`,
    `请你现在直接完成自己的部分，然后如果你知道下一位是谁，可以继续 @ 对方。`,
    `原始任务：${params.triggerText}`,
    `上一位成员：${params.previousMemberName}`,
    `当前还未完成的成员：${params.remainingMemberNames.join("、")}`,
    "",
    "上一位成员的最新回复：",
    params.latestReply,
  ].join("\n");
}

function buildFailedRelayMessage(params: {
  failedMemberName: string;
  triggerText: string;
  remainingMemberNames: string[];
}) {
  return [
    `[群内接力自动跳过] 成员「${params.failedMemberName}」响应失败，已跳过。`,
    "你是下一位需要发言的成员，请直接继续当前任务。",
    `原始任务：${params.triggerText}`,
    params.remainingMemberNames.length > 0
      ? `当前还未完成的成员：${params.remainingMemberNames.join("、")}`
      : "当前没有其他待完成成员，请直接收尾。",
  ].join("\n");
}

function buildRemovedRelayMessage(params: {
  removedMemberName: string;
  triggerText: string;
  remainingMemberNames: string[];
}) {
  return [
    `[群内接力成员变更] 成员「${params.removedMemberName}」已被移除，接力顺序已更新。`,
    "你是下一位需要发言的成员，请直接继续当前任务。",
    `原始任务：${params.triggerText}`,
    params.remainingMemberNames.length > 0
      ? `当前还未完成的成员：${params.remainingMemberNames.join("、")}`
      : "当前没有其他待完成成员，请直接收尾。",
  ].join("\n");
}

function buildFailureLeaderSummaryMessage(params: {
  failedMemberNames: string[];
  triggerText: string;
}) {
  return [
    `[群内接力兜底总结] 以下成员响应失败，已被跳过：${params.failedMemberNames.join("、") || "无"}`,
    "请你作为群主直接总结当前结果并给出下一步建议，不再继续点名接力。",
    `原始任务：${params.triggerText}`,
  ].join("\n");
}

function getThinkingAgentsFromBuckets(thinkingAgentsByGroupId: ThinkingBuckets, groupId: string) {
  const thinkingGroup = thinkingAgentsByGroupId.get(groupId) ?? EMPTY_THINKING_GROUP;
  return Array.from(thinkingGroup.values());
}

function getThinkingAgentFromBuckets(
  thinkingAgentsByGroupId: ThinkingBuckets,
  groupId: string,
  agentId: string,
) {
  return thinkingAgentsByGroupId.get(groupId)?.get(agentId) ?? null;
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

function clearThinkingAgentFromBuckets(
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
    thinkingGroup.delete(agentId);
  });

  return {
    thinkingAgentsByGroupId: nextBuckets,
    currentAgents: getThinkingAgentsFromBuckets(nextBuckets, groupId),
    removedAgent,
  };
}

function setThinkingAgentDetailInBuckets(
  thinkingAgentsByGroupId: ThinkingBuckets,
  groupId: string,
  agentId: string,
  detail?: string,
): ThinkingUpdateResult {
  const nextBuckets = withThinkingGroup(thinkingAgentsByGroupId, groupId, (thinkingGroup) => {
    const current = thinkingGroup.get(agentId);
    if (!current) {
      return;
    }

    const nextDetail = detail?.trim() || undefined;
    thinkingGroup.set(agentId, {
      ...current,
      detail: nextDetail,
    });
  });

  return {
    thinkingAgentsByGroupId: nextBuckets,
    currentAgents: getThinkingAgentsFromBuckets(nextBuckets, groupId),
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
    let committed = false;
    set((state) => {
      const patch = updater(state);
      const nextState = { ...state, ...patch };
      const previousPersistence = toPersistence(state);
      const nextPersistence = toPersistence(nextState);
      if (
        hasPersistenceChanged(previousPersistence, nextPersistence) &&
        !writeStoredState(nextPersistence)
      ) {
        return {};
      }

      committed = true;
      return patch;
    });

    return committed;
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

  function restoreActiveGroupUrgings(groups: Group[], reason: string) {
    if (typeof window === "undefined") {
      return;
    }

    const activeGroups = groups.filter((group) => group.isUrging === true);
    if (activeGroups.length === 0) {
      return;
    }

    console.log(`[Urge] 准备恢复全部督促定时器: ${activeGroups.length} 个，原因: ${reason}`);
    queueMicrotask(() => {
      activeGroups.forEach((group) => {
        get().restoreGroupUrging(group.id);
      });
    });
  }

  function compensateAllGroupUrges() {
    const activeGroups = get().groups.filter(
      (group) => group.isUrging === true && group.isUrgePaused !== true,
    );
    if (activeGroups.length === 0) {
      return;
    }

    console.log(`[Urge] 对全部活跃群执行可见性补偿: ${activeGroups.length} 个`);
    activeGroups.forEach((group) => {
      get().compensateGroupUrge(group.id);
    });
  }

  function ensureGroupUrgeRuntimeInitialized() {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    if (groupUrgeVisibilityHandler) {
      return;
    }

    groupUrgeVisibilityHandler = () => {
      if (document.hidden) {
        return;
      }

      compensateAllGroupUrges();
    };
    document.addEventListener("visibilitychange", groupUrgeVisibilityHandler);
    console.log("[Urge] 已初始化全局可见性补偿监听");
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
    clearGroupRoundState(groupId, "取消当前群聊发送");
    updateState((state) => ({
      thinkingAgentsByGroupId: withThinkingGroup(
        state.thinkingAgentsByGroupId,
        groupId,
        (thinkingGroup) => {
          thinkingGroup.clear();
        },
      ),
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

  function clearThinkingAgentInternal(groupId: string, agentId: string) {
    return syncThinkingBuckets((thinkingAgentsByGroupId) =>
      clearThinkingAgentFromBuckets(thinkingAgentsByGroupId, groupId, agentId),
    ) as ThinkingRemoveResult;
  }

  function completeThinkingAgentsInternal(
    groupId: string,
    agentId: string,
    nextAgents: AgentInfo[],
  ) {
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

  function getThinkingAgentDetailInternal(groupId: string, agentId: string) {
    return getThinkingAgentFromBuckets(get().thinkingAgentsByGroupId, groupId, agentId)?.detail;
  }

  function setThinkingAgentDetailInternal(groupId: string, agentId: string, detail?: string) {
    return syncThinkingBuckets((thinkingAgentsByGroupId) =>
      setThinkingAgentDetailInBuckets(thinkingAgentsByGroupId, groupId, agentId, detail),
    );
  }

  function getAnnouncementSyncVersion(groupId: string, agentId: string) {
    const syncedVersion = get().announcementSyncStatus.get(groupId)?.[agentId];
    return typeof syncedVersion === "number" && Number.isFinite(syncedVersion)
      ? syncedVersion
      : undefined;
  }

  function updateAnnouncementSyncStatus(
    groupId: string,
    updater: (current: Record<string, number>) => Record<string, number> | null,
  ) {
    updateState((state) => {
      const nextStatus = new Map(state.announcementSyncStatus);
      const current = state.announcementSyncStatus.get(groupId) ?? {};
      const updated = updater(current);

      if (!updated || Object.keys(updated).length === 0) {
        nextStatus.delete(groupId);
      } else {
        nextStatus.set(groupId, updated);
      }

      return {
        announcementSyncStatus: nextStatus,
      };
    });
  }

  function markAnnouncementSynced(groupId: string, agentIds: string[], version: number) {
    if (!Number.isFinite(version)) {
      return;
    }

    const normalizedIds = Array.from(
      new Set(agentIds.map((agentId) => agentId.trim()).filter(Boolean)),
    );
    if (normalizedIds.length === 0) {
      return;
    }

    updateAnnouncementSyncStatus(groupId, (current) => {
      const next = { ...current };
      normalizedIds.forEach((agentId) => {
        next[agentId] = version;
      });
      return next;
    });
  }

  function clearAnnouncementSyncStatus(groupId: string, agentIds?: string[]) {
    if (!agentIds || agentIds.length === 0) {
      updateAnnouncementSyncStatus(groupId, () => null);
      return;
    }

    const normalizedIds = Array.from(
      new Set(agentIds.map((agentId) => agentId.trim()).filter(Boolean)),
    );
    if (normalizedIds.length === 0) {
      return;
    }

    updateAnnouncementSyncStatus(groupId, (current) => {
      const next = { ...current };
      normalizedIds.forEach((agentId) => {
        delete next[agentId];
      });
      return Object.keys(next).length > 0 ? next : null;
    });
  }

  function isMemberStillInGroup(groupId: string, memberId: string) {
    const group = get().groups.find((item) => item.id === groupId);
    if (!group) {
      return false;
    }

    return group.leaderId === memberId || group.members.some((member) => member.id === memberId);
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

  function writeCompactedSessionBackup(groupId: string, agentId: string, messages: ChatMessage[]) {
    if (typeof window === "undefined" || messages.length === 0) {
      return;
    }

    try {
      const backupKey = `compacted:${groupId}:${agentId}:${Date.now()}`;
      window.localStorage.setItem(
        backupKey,
        JSON.stringify({
          groupId,
          agentId,
          createdAt: new Date().toISOString(),
          messages,
        }),
      );
    } catch (error) {
      console.warn(`[Compact] 写入压缩备份失败: group=${groupId}, agent=${agentId}`, error);
    }
  }

  function replaceVisibleMessagesWithCompactSummary(
    groupId: string,
    member: AgentInfo,
    summary: string,
    sessionMessageCount: number,
  ) {
    const summaryContent = sanitizeAssistantText(`📋 [上下文摘要] ${summary.trim()}`);
    if (!summaryContent.trim()) {
      return;
    }

    updateState((state) => {
      const messages = state.messagesByGroupId[groupId] ?? [];
      const relatedIndexes = messages
        .map((message, index) => ({ message, index }))
        .filter((entry) => messageBelongsToAgentSession(entry.message, member.id))
        .map((entry) => entry.index);

      if (sessionMessageCount <= GROUP_COMPACT_KEEP_RECENT || relatedIndexes.length === 0) {
        return {};
      }

      // 只压缩当前会话里已经落盘的历史消息，保留最近 5 条历史消息以及本次刚追加到界面的新消息。
      const compactCount = Math.max(0, sessionMessageCount - GROUP_COMPACT_KEEP_RECENT);
      const compactIndexes = new Set(relatedIndexes.slice(0, compactCount));
      if (compactIndexes.size === 0) {
        return {};
      }

      const summaryMessage: GroupChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: summaryContent,
        timestamp: Date.now(),
        isLoading: false,
        isNew: true,
        isHistorical: false,
        senderId: member.id,
        senderName: member.name,
        senderEmoji: member.emoji,
        senderAvatarUrl: member.avatarUrl,
        sessionTargetIds: [member.id],
      };

      const nextMessages: GroupChatMessage[] = [];
      let inserted = false;

      messages.forEach((message, index) => {
        const shouldCompact = compactIndexes.has(index);
        if (shouldCompact && !inserted) {
          nextMessages.push(summaryMessage);
          inserted = true;
        }

        if (!shouldCompact) {
          nextMessages.push(message);
          return;
        }

        if (message.senderId === member.id) {
          return;
        }

        if (!message.sessionTargetIds?.includes(member.id)) {
          return;
        }

        const remainingTargetIds = message.sessionTargetIds.filter(
          (targetId) => targetId !== member.id,
        );
        if (remainingTargetIds.length === 0) {
          return;
        }

        nextMessages.push({
          ...message,
          sessionTargetIds: remainingTargetIds,
        });
      });

      if (!inserted) {
        nextMessages.unshift(summaryMessage);
      }

      return {
        messagesByGroupId: {
          ...state.messagesByGroupId,
          [groupId]: nextMessages,
        },
      };
    });
  }

  async function dispatchProgrammaticMessage(params: {
    groupId: string;
    text: string;
    source: GroupDispatchSource;
    targetIds: string[];
    attachments?: GatewayChatAttachmentInput[];
    visibleMessage?: GroupChatMessage;
    showReplyInUi?: boolean;
    showThinkingStatus?: boolean;
    skipAutoCompact?: boolean;
    requireReply?: boolean;
  }) {
    const cleanText = params.text.trim();
    if (!cleanText && (params.attachments?.length ?? 0) === 0) {
      return [] as GroupDispatchResult[];
    }

    const group = get().groups.find((item) => item.id === params.groupId);
    if (!group) {
      return [] as GroupDispatchResult[];
    }

    const agentStore = useAgentStore.getState();
    const members = resolveGroupMembers(group, agentStore.agents);
    const targetIdSet = new Set(
      params.targetIds.map((targetId) => targetId.trim()).filter(Boolean),
    );
    const targets = members.filter((member) => targetIdSet.has(member.id));
    if (targets.length === 0) {
      console.warn(
        `${resolveDispatchLogPrefix(params.source.type)} 程序化消息跳过: 群=${group.name}，没有命中的目标成员`,
      );
      return [] as GroupDispatchResult[];
    }

    const epoch = getGroupEpoch(params.groupId);
    const logPrefix = resolveDispatchLogPrefix(params.source.type);
    console.log(
      `${logPrefix} 发送程序化消息: 群=${group.name}，目标=${targets.map((target) => target.name).join("、")}，可见=${params.visibleMessage ? "是" : "否"}`,
    );

    if (params.visibleMessage) {
      appendGroupVisibleMessage(params.groupId, {
        ...params.visibleMessage,
        sessionTargetIds: targets.map((target) => target.id),
      });
    }

    if (params.showThinkingStatus === true) {
      addThinkingAgentsInternal(params.groupId, targets);
    }

    return queueGroupDispatches(
      params.groupId,
      targets.map((member) => ({
        group,
        member,
        members,
        text: cleanText,
        attachments: params.attachments,
        userSpecifiedTargets: true,
        epoch,
        source: params.source,
        skipRelayDetection: true,
        showReplyInUi: params.showReplyInUi,
        showThinkingStatus: params.showThinkingStatus,
        skipAutoCompact: params.skipAutoCompact,
        requireReply: params.requireReply,
      })),
    );
  }

  async function compactGroupSessionIfNeeded(params: {
    groupId: string;
    member: AgentInfo;
    members: AgentInfo[];
    source: GroupDispatchSource;
    showThinkingStatus: boolean;
    sessionKey: string;
  }) {
    const compactingKey = `${params.groupId}:${params.member.id}`;
    if (compactingAgents.has(compactingKey)) {
      console.log(`[Compact] 跳过重复压缩: group=${params.groupId}, agent=${params.member.name}`);
      return;
    }

    const historyPayload = await gateway.loadHistory(
      params.sessionKey,
      GROUP_COMPACT_HISTORY_LIMIT,
    );
    const sessionMessages = adaptHistoryMessages(historyPayload);
    // 压缩检查发生在发送新消息之前，命中阈值时也要立刻压缩，避免用户再多发一轮才触发。
    if (sessionMessages.length < GROUP_COMPACT_THRESHOLD) {
      return;
    }

    compactingAgents.add(compactingKey);
    const previousDetail = params.showThinkingStatus
      ? getThinkingAgentDetailInternal(params.groupId, params.member.id)
      : undefined;

    if (params.showThinkingStatus) {
      setThinkingAgentDetailInternal(params.groupId, params.member.id, "📋 整理记忆中...");
    }

    try {
      const messagesToCompact = sessionMessages.slice(
        0,
        Math.max(0, sessionMessages.length - GROUP_COMPACT_KEEP_RECENT),
      );
      const recentMessages = sessionMessages.slice(-GROUP_COMPACT_KEEP_RECENT);
      if (messagesToCompact.length === 0) {
        return;
      }

      writeCompactedSessionBackup(params.groupId, params.member.id, messagesToCompact);
      console.log(
        `[Compact] 触发上下文压缩: 群=${params.groupId}，成员=${params.member.name}，历史=${sessionMessages.length}，压缩=${messagesToCompact.length}`,
      );

      let summaryText = "";
      const compactStartedAt = Date.now();

      try {
        const compactResult = await gateway.sendCompactCommand(params.sessionKey);
        if (!compactResult.ok) {
          throw new Error(compactResult.error?.message || "Gateway /compact 失败");
        }

        summaryText =
          (await loadLatestAssistantReply(params.sessionKey, compactStartedAt))?.content.trim() ??
          "";
        if (summaryText) {
          console.log(`[Compact] 已通过 Gateway /compact 压缩: 成员=${params.member.name}`);
        }
      } catch (error) {
        console.warn(
          `[Compact] Gateway /compact 不可用，改走前端兜底: 成员=${params.member.name}`,
          error,
        );
      }

      if (!summaryText) {
        const summaryResults = await dispatchProgrammaticMessage({
          groupId: params.groupId,
          text: buildCompactSummaryPrompt(formatHistoryMessagesForCompact(messagesToCompact)),
          targetIds: [params.member.id],
          source: {
            senderId: params.source.senderId,
            senderName: "系统压缩器",
            depth: 0,
            type: "system",
          },
          showReplyInUi: false,
          showThinkingStatus: false,
          skipAutoCompact: true,
          requireReply: true,
        });
        summaryText = summaryResults[0]?.reply?.content.trim() ?? "";
        if (!summaryText) {
          console.warn(`[Compact] 压缩摘要生成失败: 成员=${params.member.name}`);
          return;
        }

        await gateway.resetSession(params.sessionKey);
        clearAnnouncementSyncStatus(params.groupId, [params.member.id]);

        await dispatchProgrammaticMessage({
          groupId: params.groupId,
          text: buildCompactSeedMessage(
            summaryText,
            formatHistoryMessagesForCompact(recentMessages),
          ),
          targetIds: [params.member.id],
          source: {
            senderId: params.source.senderId,
            senderName: "系统压缩器",
            depth: 0,
            type: "system",
          },
          showReplyInUi: false,
          showThinkingStatus: false,
          skipAutoCompact: true,
          requireReply: false,
        });
      }

      replaceVisibleMessagesWithCompactSummary(
        params.groupId,
        params.member,
        summaryText,
        sessionMessages.length,
      );
      console.log(`[Compact] 压缩完成: 群=${params.groupId}，成员=${params.member.name}`);
    } finally {
      if (params.showThinkingStatus) {
        setThinkingAgentDetailInternal(params.groupId, params.member.id, previousDetail);
      }
      compactingAgents.delete(compactingKey);
    }
  }

  function scheduleRelaySettleCheck(params: {
    groupId: string;
    group: Group;
    members: AgentInfo[];
    epoch: number;
  }) {
    const round = getGroupRoundState(params.groupId);
    if (!round) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    clearGroupRelaySettleTimer(params.groupId, "重新安排断裂检测");
    console.log(
      `[Group] 启动 2.5 秒断裂检测: 群=${params.group.name}，pending=${describeIdsAsNames(params.members, round.pendingAgentIds)}，remaining=${describeIdsAsNames(params.members, round.remainingAgentIds)}`,
    );

    const timerId = window.setTimeout(() => {
      void (async () => {
        groupRelaySettleTimerIds.delete(params.groupId);

        if (getGroupEpoch(params.groupId) !== params.epoch) {
          console.log("[Group] 断裂检测跳过: epoch 已变更");
          return;
        }

        const latestRound = getGroupRoundState(params.groupId);
        if (!latestRound) {
          console.log("[Group] 断裂检测跳过: 当前回合已结束");
          return;
        }

        const thinkingAgents = get().getThinkingAgentsForGroup(params.groupId);
        const pendingMembers = getRoundPendingMembers(latestRound, params.members);
        const remainingMembers = getRoundRemainingMembers(latestRound, params.members);

        console.log(
          `[Group] 断裂检测触发: 群=${params.group.name}，allMembers=${latestRound.allMembersMode}，pending=${describeAgentNames(pendingMembers)}，remaining=${describeAgentNames(remainingMembers)}，thinking=${describeAgentNames(thinkingAgents)}`,
        );

        if (thinkingAgents.length > 0) {
          console.log("[Group] 断裂检测结束: 已有新的 Agent 开始思考");
          return;
        }

        if (pendingMembers.length > 0) {
          console.log("[Group] 断裂检测结束: 当前仍有待发言成员，交给 watchdog 继续观察");
          return;
        }

        if (!latestRound.allMembersMode) {
          console.log("[Group] 断裂检测结束: 非全员接力回合，显式提及链路已结束");
          clearGroupRoundState(params.groupId, "普通回合已自然结束");
          return;
        }

        if (remainingMembers.length === 0) {
          console.log("[Group] 断裂检测结束: 全员接力已完成");
          clearGroupRoundState(params.groupId, "全员接力已完成");
          return;
        }

        if (
          latestRound.lastDispatchSystemReason === "leader_fallback" &&
          latestRound.lastReplyMemberId === latestRound.leaderId
        ) {
          console.log("[Group] 断裂检测结束: 群主兜底刚失败，等待 watchdog 直接续接下一位");
          return;
        }

        if (latestRound.interventionCount >= latestRound.interventionLimit) {
          console.warn(
            `[Group] 断裂检测结束: 自动介入已达上限（${latestRound.interventionLimit} 次），停止自动接力`,
          );
          clearGroupRoundState(params.groupId, "自动介入达到上限");
          return;
        }

        const leaderMember = findMemberById(params.members, latestRound.leaderId);
        const nextRecommendedMember = remainingMembers[0] ?? null;
        if (!leaderMember) {
          console.warn("[Group] 断裂检测结束: 找不到群主成员，停止自动接力");
          clearGroupRoundState(params.groupId, "找不到群主成员");
          return;
        }

        const nextRound = cloneGroupRoundState(latestRound);
        nextRound.interventionCount += 1;
        nextRound.pendingAgentIds.add(leaderMember.id);
        setGroupRoundState(params.groupId, nextRound);

        console.log(
          `[Group] 断裂检测命中: 准备发送群主兜底 -> ${leaderMember.name}，未发言成员=${describeAgentNames(remainingMembers)}，介入=${nextRound.interventionCount}/${nextRound.interventionLimit}`,
        );

        addThinkingAgentsInternal(params.groupId, [leaderMember]);
        await queueGroupDispatches(params.groupId, [
          {
            group: params.group,
            member: leaderMember,
            members: params.members,
            text: buildLeaderFallbackMessage({
              memberName: latestRound.lastReplyMemberName || "上一位成员",
              latestReply: latestRound.lastReplyContent || "",
              nextMemberName: nextRecommendedMember?.name,
              remainingMemberNames: remainingMembers.map((member) => member.name),
            }),
            userSpecifiedTargets: true,
            epoch: params.epoch,
            source: {
              senderId: latestRound.lastReplyMemberId,
              senderName: "群主兜底",
              depth: latestRound.lastReplyDepth + 1,
              type: "system",
              systemReason: "leader_fallback",
            },
          },
        ]);
      })();
    }, GROUP_RELAY_SETTLE_DELAY_MS);

    groupRelaySettleTimerIds.set(params.groupId, timerId);
  }

  function scheduleRelayIdleWatchdog(params: {
    groupId: string;
    group: Group;
    members: AgentInfo[];
    epoch: number;
  }) {
    const round = getGroupRoundState(params.groupId);
    if (!round) {
      console.log(`[Group] 当前回合已结束，不启动 5 秒兜底定时器: ${params.group.name}`);
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    clearGroupRelayIdleTimer(params.groupId, "重新安排接力检测");
    console.log(
      `[Group] 启动 5 秒兜底定时器: 群=${params.group.name}，pending=${describeIdsAsNames(params.members, round.pendingAgentIds)}，remaining=${describeIdsAsNames(params.members, round.remainingAgentIds)}`,
    );

    const timerId = window.setTimeout(() => {
      void (async () => {
        groupRelayIdleTimerIds.delete(params.groupId);

        if (getGroupEpoch(params.groupId) !== params.epoch) {
          console.log(`[Group] 接力兜底定时器取消: epoch 已变更，跳过检查`);
          return;
        }

        const latestRound = getGroupRoundState(params.groupId);
        if (!latestRound) {
          console.log(`[Group] 接力兜底定时器跳过: 当前回合已结束`);
          return;
        }

        const thinkingAgents = get().getThinkingAgentsForGroup(params.groupId);
        const failedThinkingAgents = thinkingAgents.filter((agent) =>
          latestRound.failedAgentIds.has(agent.id),
        );
        if (failedThinkingAgents.length > 0) {
          failedThinkingAgents.forEach((agent) => {
            removeThinkingAgentInternal(params.groupId, agent.id);
          });
          console.warn(
            `[Group] 5 秒接力检查发现失败成员仍在思考队列，已跳过: ${describeAgentNames(failedThinkingAgents)}`,
          );
        }

        const activeThinkingAgents = thinkingAgents.filter(
          (agent) => !latestRound.failedAgentIds.has(agent.id),
        );
        const pendingMembers = getRoundPendingMembers(latestRound, params.members);
        const remainingMembers = getRoundRemainingMembers(latestRound, params.members);

        console.log(
          `[Group] 5 秒接力检查: 群=${params.group.name}，pending=${describeAgentNames(pendingMembers)}，remaining=${describeAgentNames(remainingMembers)}，thinking=${describeAgentNames(activeThinkingAgents)}，intervention=${latestRound.interventionCount}/${latestRound.interventionLimit}`,
        );

        if (activeThinkingAgents.length > 0) {
          console.log(`[Group] 5 秒接力检查结束: 已有成员开始继续接力，不需要强制续接`);
          return;
        }

        const nextTarget =
          pendingMembers[0] ?? (latestRound.allMembersMode ? (remainingMembers[0] ?? null) : null);
        const watchdogReason = pendingMembers.length > 0 ? "pending" : "remaining";

        if (!nextTarget) {
          if (!latestRound.allMembersMode || remainingMembers.length === 0) {
            console.log("[Group] 5 秒接力检查结束: 当前回合已自然完成");
            clearGroupRoundState(params.groupId, "5 秒检查确认回合结束");
          } else {
            console.log("[Group] 5 秒接力检查结束: 暂无可续接目标");
          }
          return;
        }

        if (latestRound.interventionCount >= latestRound.interventionLimit) {
          console.warn(
            `[Group] 5 秒接力检查结束: 自动介入已达上限（${latestRound.interventionLimit} 次），停止自动续接`,
          );
          clearGroupRoundState(params.groupId, "5 秒检查达到自动介入上限");
          return;
        }

        const nextRound = cloneGroupRoundState(latestRound);
        nextRound.interventionCount += 1;
        nextRound.pendingAgentIds.add(nextTarget.id);
        setGroupRoundState(params.groupId, nextRound);

        console.log(
          `[Group] 5 秒无人继续接力，前端强制续接 -> ${nextTarget.name}，来源=${watchdogReason}，介入=${nextRound.interventionCount}/${nextRound.interventionLimit}`,
        );

        addThinkingAgentsInternal(params.groupId, [nextTarget]);
        await queueGroupDispatches(params.groupId, [
          {
            group: params.group,
            member: nextTarget,
            members: params.members,
            text: buildWatchdogRelayMessage({
              previousMemberName: latestRound.lastReplyMemberName || "上一位成员",
              latestReply: latestRound.lastReplyContent || "",
              triggerText: latestRound.triggerText,
              remainingMemberNames: remainingMembers.map((member) => member.name),
            }),
            userSpecifiedTargets: true,
            epoch: params.epoch,
            source: {
              senderId: latestRound.lastReplyMemberId,
              senderName: "群内接力定时器",
              depth: latestRound.lastReplyDepth + 1,
              type: "system",
              systemReason: "watchdog",
            },
          },
        ]);
      })();
    }, GROUP_RELAY_IDLE_TIMEOUT_MS);

    groupRelayIdleTimerIds.set(params.groupId, timerId);
  }

  function syncUrgeReplyToRoundState(params: {
    groupId: string;
    group: Group;
    members: AgentInfo[];
    member: AgentInfo;
    epoch: number;
    source: GroupDispatchSource;
    reply: ChatMessage | null;
  }) {
    if (params.source.type !== "urge" || !params.reply) {
      return false;
    }

    const latestRound = getGroupRoundState(params.groupId);
    if (!latestRound || latestRound.epoch !== params.epoch) {
      return false;
    }

    const isTrackedMember =
      latestRound.pendingAgentIds.has(params.member.id) ||
      latestRound.remainingAgentIds.includes(params.member.id);
    if (!isTrackedMember) {
      return false;
    }

    const nextRound = cloneGroupRoundState(latestRound);
    removePendingMemberFromRound(nextRound, params.member.id);
    markMemberSpoken(nextRound, params.member.id);
    nextRound.lastReplyAt = Date.now();
    nextRound.lastReplyMemberId = params.member.id;
    nextRound.lastReplyMemberName = params.member.name;
    nextRound.lastReplyContent = params.reply.content;
    nextRound.lastReplyDepth = params.source.depth;
    nextRound.lastDispatchSourceType = params.source.type;
    nextRound.lastDispatchSystemReason = params.source.systemReason;

    console.log(
      `[Group] 督促回复已同步到接力状态: 发言人=${params.member.name}，pending=${describeIdsAsNames(params.members, nextRound.pendingAgentIds)}，remaining=${describeIdsAsNames(params.members, nextRound.remainingAgentIds)}，allMembers=${nextRound.allMembersMode}`,
    );

    // 中文注释：督促回复要推进当前 round，但不能把督促文本重新识别成新的接力任务。
    if (
      nextRound.pendingAgentIds.size === 0 &&
      (!nextRound.allMembersMode || nextRound.remainingAgentIds.length === 0)
    ) {
      clearGroupRoundState(
        params.groupId,
        nextRound.allMembersMode ? "督促后全员接力已完成" : "督促后显式提及链路结束",
      );
      return true;
    }

    setGroupRoundState(params.groupId, nextRound);
    scheduleRelaySettleCheck({
      groupId: params.groupId,
      group: params.group,
      members: params.members,
      epoch: params.epoch,
    });
    scheduleRelayIdleWatchdog({
      groupId: params.groupId,
      group: params.group,
      members: params.members,
      epoch: params.epoch,
    });
    return true;
  }

  function appendGroupAssistantMessage(groupId: string, message: GroupChatMessage) {
    const sanitizedMessage = {
      ...message,
      content: sanitizeAssistantText(message.content),
      thinking: message.thinking ? sanitizeAssistantText(message.thinking) : message.thinking,
    };

    updateState((state) => ({
      messagesByGroupId: {
        ...state.messagesByGroupId,
        [groupId]: [...(state.messagesByGroupId[groupId] ?? []), sanitizedMessage],
      },
    }));

    const hasRenderableContent =
      sanitizedMessage.content.trim().length > 0 || Boolean(sanitizedMessage.thinking?.trim());
    const { selectedGroupId, selectedArchiveId } = get();
    const { showDetailFor } = useAgentStore.getState();
    const { selectedDirectArchiveId } = useDirectArchiveStore.getState();
    const isVisible =
      selectedGroupId === groupId &&
      selectedArchiveId === null &&
      selectedDirectArchiveId === null &&
      showDetailFor === null;

    if (sanitizedMessage.senderId !== "system" && hasRenderableContent && !isVisible) {
      incrementSidebarGroupUnreadCount(groupId);
    }
  }

  function appendGroupVisibleMessage(groupId: string, message: GroupChatMessage) {
    updateState((state) => ({
      messagesByGroupId: {
        ...state.messagesByGroupId,
        [groupId]: [...(state.messagesByGroupId[groupId] ?? []), message],
      },
    }));
  }

  function appendGroupSystemMessage(groupId: string, content: string) {
    appendGroupAssistantMessage(groupId, {
      id: crypto.randomUUID(),
      role: "assistant",
      content,
      timestamp: Date.now(),
      isLoading: false,
      isNew: true,
      isHistorical: false,
      senderId: "system",
      senderName: "系统提示",
    });
  }

  function handleRemovedMemberRuntime(groupId: string, removedMember: AgentInfo) {
    const group = get().groups.find((item) => item.id === groupId);
    if (!group) {
      console.warn(`[Member] 成员移除后跳过运行时清理: 找不到项目组 ${groupId}`);
      return;
    }

    clearAnnouncementSyncStatus(groupId, [removedMember.id]);

    const removalNotice = `${removedMember.name} 已被移除`;
    const thinkingResult = clearThinkingAgentInternal(groupId, removedMember.id);
    const round = getGroupRoundState(groupId);

    if (!round) {
      appendGroupSystemMessage(groupId, removalNotice);
      console.log(
        `[Member] 已完成成员移除运行时清理: 群=${group.name}，成员=${removedMember.name}，relay=无，thinking=${thinkingResult.removedAgent ? "已清理" : "无"}`,
      );
      return;
    }

    const nextRound = cloneGroupRoundState(round);
    const removedWasNextTarget = resolveRoundNextTargetId(round) === removedMember.id;
    pruneMemberFromRoundState(nextRound, removedMember.id);

    const members = resolveGroupMembers(group, useAgentStore.getState().agents);
    const activeThinkingAgents = getThinkingAgentsFromBuckets(
      get().thinkingAgentsByGroupId,
      groupId,
    );
    const shouldContinueRelayImmediately =
      removedWasNextTarget && activeThinkingAgents.length === 0;
    let nextRelayTarget: AgentInfo | null = null;

    if (shouldContinueRelayImmediately) {
      nextRelayTarget =
        getRoundPendingMembers(nextRound, members)[0] ??
        (nextRound.allMembersMode
          ? (getRoundRemainingMembers(nextRound, members)[0] ?? null)
          : null);

      if (nextRelayTarget && !nextRound.pendingAgentIds.has(nextRelayTarget.id)) {
        nextRound.pendingAgentIds.add(nextRelayTarget.id);
      }
    }

    const relayEnded =
      nextRound.pendingAgentIds.size === 0 &&
      (!nextRound.allMembersMode || nextRound.remainingAgentIds.length === 0);

    if (relayEnded) {
      clearGroupRoundState(groupId, `成员已移除: ${removedMember.name}`);
    } else {
      setGroupRoundState(groupId, nextRound);
    }

    appendGroupSystemMessage(groupId, removalNotice);
    console.log(
      `[Member] 已完成成员移除运行时清理: 群=${group.name}，成员=${removedMember.name}，pending=${describeIdsAsNames(members, nextRound.pendingAgentIds)}，spoken=${describeIdsAsNames(members, nextRound.spokenAgentIds)}，thinking=${describeAgentNames(activeThinkingAgents)}`,
    );

    if (!shouldContinueRelayImmediately || relayEnded || !nextRelayTarget) {
      return;
    }

    console.log(
      `[Member] 成员移除后重算下一跳: 群=${group.name}，移除=${removedMember.name}，下一位=${nextRelayTarget.name}`,
    );

    addThinkingAgentsInternal(groupId, [nextRelayTarget]);
    void queueGroupDispatches(groupId, [
      {
        group,
        member: nextRelayTarget,
        members,
        text: buildRemovedRelayMessage({
          removedMemberName: removedMember.name,
          triggerText: nextRound.triggerText,
          remainingMemberNames: getRoundRemainingMembers(nextRound, members).map(
            (member) => member.name,
          ),
        }),
        userSpecifiedTargets: true,
        epoch: nextRound.epoch,
        source: {
          senderId: removedMember.id,
          senderName: "成员移除",
          depth: nextRound.lastReplyDepth + 1,
          type: "system",
          systemReason: "member_removed",
        },
      },
    ]);
  }

  async function handleRelayDispatchFailure(params: {
    groupId: string;
    group: Group;
    members: AgentInfo[];
    member: AgentInfo;
    epoch: number;
    source: GroupDispatchSource;
  }) {
    const round = getGroupRoundState(params.groupId);
    if (!round) {
      return false;
    }

    const nextRound = cloneGroupRoundState(round);
    const skipNotice = `${params.member.name} 响应失败，已跳过`;
    markMemberFailed(nextRound, params.member.id);
    appendGroupSystemMessage(params.groupId, skipNotice);
    nextRound.lastReplyAt = Date.now();
    nextRound.lastReplyMemberId = params.member.id;
    nextRound.lastReplyMemberName = params.member.name;
    nextRound.lastReplyContent = skipNotice;
    nextRound.lastReplyDepth = params.source.depth;
    nextRound.lastDispatchSourceType = "system";
    nextRound.lastDispatchSystemReason = "failure_skip";

    const pendingMembers = getRoundPendingMembers(nextRound, params.members);
    const remainingMembers = getRoundRemainingMembers(nextRound, params.members);
    const nextPendingMember = pendingMembers[0] ?? null;
    const nextRemainingMember = nextRound.allMembersMode
      ? (remainingMembers.find((member) => member.id !== nextRound.leaderId) ?? null)
      : null;

    console.warn(
      `[Group] 接力成员失败: ${params.member.name}，pending=${describeAgentNames(pendingMembers)}，remaining=${describeAgentNames(remainingMembers)}`,
    );

    if (nextPendingMember) {
      setGroupRoundState(params.groupId, nextRound);
      addThinkingAgentsInternal(params.groupId, [nextPendingMember]);
      await queueGroupDispatches(params.groupId, [
        {
          group: params.group,
          member: nextPendingMember,
          members: params.members,
          text: buildFailedRelayMessage({
            failedMemberName: params.member.name,
            triggerText: nextRound.triggerText,
            remainingMemberNames: remainingMembers.map((member) => member.name),
          }),
          userSpecifiedTargets: true,
          epoch: params.epoch,
          source: {
            senderId: params.member.id,
            senderName: "系统跳过",
            depth: params.source.depth + 1,
            type: "system",
            systemReason: "failure_skip",
          },
        },
      ]);
      return true;
    }

    if (nextRemainingMember) {
      nextRound.pendingAgentIds.add(nextRemainingMember.id);
      setGroupRoundState(params.groupId, nextRound);
      addThinkingAgentsInternal(params.groupId, [nextRemainingMember]);
      await queueGroupDispatches(params.groupId, [
        {
          group: params.group,
          member: nextRemainingMember,
          members: params.members,
          text: buildFailedRelayMessage({
            failedMemberName: params.member.name,
            triggerText: nextRound.triggerText,
            remainingMemberNames: remainingMembers.map((member) => member.name),
          }),
          userSpecifiedTargets: true,
          epoch: params.epoch,
          source: {
            senderId: params.member.id,
            senderName: "系统跳过",
            depth: params.source.depth + 1,
            type: "system",
            systemReason: "failure_skip",
          },
        },
      ]);
      return true;
    }

    const leaderMember = findMemberById(params.members, nextRound.leaderId);
    if (
      nextRound.allMembersMode &&
      leaderMember &&
      !nextRound.failedAgentIds.has(leaderMember.id)
    ) {
      const failedMemberNames = getRoundFailedMembers(nextRound, params.members).map(
        (member) => member.name,
      );
      clearGroupRoundState(params.groupId, "失败成员已耗尽，转交群主兜底总结");
      addThinkingAgentsInternal(params.groupId, [leaderMember]);
      await queueGroupDispatches(params.groupId, [
        {
          group: params.group,
          member: leaderMember,
          members: params.members,
          text: buildFailureLeaderSummaryMessage({
            failedMemberNames,
            triggerText: nextRound.triggerText,
          }),
          userSpecifiedTargets: true,
          epoch: params.epoch,
          source: {
            senderId: params.member.id,
            senderName: "系统兜底",
            depth: params.source.depth + 1,
            type: "system",
            systemReason: "failure_fallback",
          },
        },
      ]);
      return true;
    }

    clearGroupRoundState(params.groupId, "失败成员已耗尽且无法转交群主");
    return true;
  }

  function getLeaderMember(group: Group, members: AgentInfo[]) {
    return members.find((member) => member.id === group.leaderId) ?? null;
  }

  function resolveLastSpokeAtByAgentId(messages: GroupChatMessage[]) {
    return messages.reduce<Record<string, number>>((summary, message) => {
      if (
        message.role === "assistant" &&
        typeof message.senderId === "string" &&
        message.senderId.trim() &&
        typeof message.timestamp === "number" &&
        Number.isFinite(message.timestamp)
      ) {
        summary[message.senderId] = message.timestamp;
      }

      return summary;
    }, {});
  }

  async function dispatchGroupInput(params: {
    groupId: string;
    text: string;
    displayMessage: GroupChatMessage;
    attachments?: GatewayChatAttachmentInput[];
    source: GroupDispatchSource;
  }) {
    const cleanText = params.text.trim();
    if (!cleanText && (params.attachments?.length ?? 0) === 0) {
      return;
    }

    const group = get().groups.find((item) => item.id === params.groupId);
    if (!group) {
      return;
    }

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

    const epoch = getGroupEpoch(params.groupId);
    clearGroupRoundState(params.groupId, "开始新的群聊回合");
    const intent = inspectSequentialRelayRequest(cleanText, members.length);
    console.log(
      `[Group] 接力识别结果: sequential=${intent.matchedSequentialKeywords.join("、") || "无"}，allMembers=${intent.matchedAllMemberKeywords.join("、") || "无"}，task=${intent.matchedTaskKeywords.join("、") || "无"}`,
    );
    if (params.source.type === "user" && intent.isRelayRequest) {
      const round: GroupRoundState = {
        epoch,
        triggerText: cleanText,
        leaderId: group.leaderId,
        // allMembersMode 就是群聊里的“接力模式”运行时标志，只允许用户原始消息开启。
        allMembersMode: true,
        failedAgentIds: new Set(),
        pendingAgentIds: new Set(targets.map((member) => member.id)),
        spokenAgentIds: new Set(),
        remainingAgentIds: members.map((member) => member.id),
        interventionCount: 0,
        interventionLimit: DEFAULT_GROUP_RELAY_FALLBACK_LIMIT,
        lastReplyAt: Date.now(),
        lastReplyDepth: 0,
        lastDispatchSourceType: params.source.type,
        intent,
      };
      setGroupRoundState(params.groupId, round);

      console.log(
        `[Group] 启动接力模式: 群=${group.name}，pending=${describeIdsAsNames(members, round.pendingAgentIds)}，remaining=${describeIdsAsNames(members, round.remainingAgentIds)}`,
      );
    } else {
      console.log(`[Group] 当前消息不启动接力模式: 群=${group.name}`);
    }
    console.log(
      `[Group] 发送群消息: ${group.name} -> ${targets.map((member) => member.name).join(", ")}`,
    );

    appendGroupVisibleMessage(params.groupId, {
      ...params.displayMessage,
      sessionTargetIds: targets.map((target) => target.id),
    });
    addThinkingAgentsInternal(params.groupId, targets);
    console.log(`[Group] 思考中: ${targets.map((member) => member.name).join(", ")}`);

    await queueGroupDispatches(
      params.groupId,
      targets.map((member) => ({
        group,
        member,
        members,
        text: cleanText,
        attachments: params.attachments,
        userSpecifiedTargets,
        epoch,
        source: params.source,
        showReplyInUi: true,
        showThinkingStatus: true,
        requireReply: true,
      })),
    );
  }

  function scheduleGroupUrgeCheck(groupId: string, delayMs: number, reason: string) {
    if (typeof window === "undefined") {
      return;
    }

    clearGroupUrgeTimer(groupId, "重新安排督促检查");
    const safeDelayMs = Math.max(0, Math.floor(delayMs));
    console.log(`[Urge] 已安排督促检查: group=${groupId}，delayMs=${safeDelayMs}，原因: ${reason}`);

    const timerId = window.setTimeout(() => {
      groupUrgeTimerIds.delete(groupId);
      void performGroupUrgeCheck(groupId, "timer");
    }, safeDelayMs);

    groupUrgeTimerIds.set(groupId, timerId);
  }

  function updateGroupUrgeState(groupId: string, updater: (group: Group) => Group) {
    updateState((state) => ({
      groups: state.groups.map((group) => (group.id === groupId ? updater(group) : group)),
    }));
  }

  function getGroupUrgeState(groupId: string) {
    return get().groups.find((group) => group.id === groupId) ?? null;
  }

  async function sendUrgeMessages(params: {
    groupId: string;
    leader: AgentInfo;
    targets: AgentInfo[];
  }) {
    let sentCount = 0;

    for (const target of params.targets) {
      const urgeMessage = buildUrgeMessage([target.name]);
      if (!urgeMessage) {
        continue;
      }

      const visibleMessage: GroupChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: urgeMessage,
        timestamp: Date.now(),
        isNew: true,
        isHistorical: false,
        senderId: params.leader.id,
        senderName: params.leader.name,
        senderEmoji: params.leader.emoji,
        senderAvatarUrl: params.leader.avatarUrl,
      };

      await dispatchProgrammaticMessage({
        groupId: params.groupId,
        text: urgeMessage,
        targetIds: [target.id],
        visibleMessage,
        source: {
          senderId: params.leader.id,
          senderName: params.leader.name,
          depth: 0,
          type: "urge",
        },
        showReplyInUi: true,
        showThinkingStatus: true,
        requireReply: true,
      });
      sentCount += 1;
    }

    return sentCount;
  }

  async function performGroupUrgeCheck(
    groupId: string,
    trigger: "timer" | "visibility" | "restore",
  ) {
    const group = getGroupUrgeState(groupId);
    if (!group || group.isUrging !== true || group.isUrgePaused === true) {
      clearGroupUrgeTimer(groupId, "督促模式未开启或已暂停");
      return;
    }

    const now = Date.now();
    const intervalMinutes = group.urgeIntervalMinutes ?? 10;
    updateGroupUrgeState(groupId, (current) => ({
      ...current,
      urgeLastCheckedAt: now,
    }));

    const agentStore = useAgentStore.getState();
    const members = resolveGroupMembers(group, agentStore.agents);
    const leader = getLeaderMember(group, members);
    if (!leader) {
      console.error(`[Urge] 找不到督促者，停止督促: ${group.name}`);
      updateGroupUrgeState(groupId, (current) => ({
        ...current,
        isUrging: false,
        isUrgePaused: false,
      }));
      clearGroupUrgeTimer(groupId, "找不到督促者");
      return;
    }

    if (get().isSendingByGroupId[groupId]) {
      console.log(`[Urge] 群聊仍在发送中，延后检查: ${group.name}`);
      scheduleGroupUrgeCheck(groupId, Math.min(15_000, intervalMinutes * 60_000), "群聊仍在发送中");
      return;
    }

    const messages = get().messagesByGroupId[groupId] ?? [];
    const lastSpokeAtByAgentId = resolveLastSpokeAtByAgentId(messages);
    const thinkingAgentIds = get()
      .getThinkingAgentsForGroup(groupId)
      .map((member) => member.id);
    const defaultTargets = resolveUrgeTargets({
      members,
      leaderId: group.leaderId,
      startedAt: group.urgeStartedAt,
      intervalMinutes,
      now,
      thinkingAgentIds,
      lastSpokeAtByAgentId,
    });

    console.log(
      `[Urge] 执行督促检查: 群=${group.name}，触发=${trigger}，间隔=${intervalMinutes}分钟，候选目标=${defaultTargets.map((member) => member.name).join("、") || "无"}`,
    );

    let actualUrgeCount = 0;
    let shouldFallbackToDefault = false;
    let fallbackReason = "";

    console.log("[Urge] 向群主发送督促判断请求");
    const decisionResults = await dispatchProgrammaticMessage({
      groupId,
      text: buildUrgeDecisionRequestMessage(),
      targetIds: [leader.id],
      source: {
        senderId: leader.id,
        senderName: leader.name,
        depth: 0,
        type: "urge",
      },
      showReplyInUi: false,
      showThinkingStatus: false,
      requireReply: true,
    });

    const decision = parseUrgeDecisionReply(decisionResults[0]?.reply?.content ?? "");
    if (decision?.needUrge === true) {
      const resolvedTargets = Array.from(
        new Map(
          decision.targets
            .map(
              (targetName) =>
                members.find(
                  (member) =>
                    member.id !== leader.id &&
                    member.name.trim().toLowerCase() === targetName.trim().toLowerCase(),
                ) ?? null,
            )
            .filter((member): member is AgentInfo => member !== null)
            .map((member) => [member.id, member]),
        ).values(),
      );

      if (resolvedTargets.length === 0) {
        shouldFallbackToDefault = true;
        fallbackReason = "群主返回的 targets 无法匹配到群成员";
      } else {
        console.log(
          `[Urge] 群主判断需要催促: targets=[${resolvedTargets.map((member) => member.name).join(", ")}], reason=${decision.reason || "无"}`,
        );
        actualUrgeCount = await sendUrgeMessages({
          groupId,
          leader,
          targets: resolvedTargets,
        });
      }
    } else if (decision?.needUrge === false) {
      console.log(`[Urge] 群主判断无需催促: reason=${decision.reason || "无"}`);
    } else {
      shouldFallbackToDefault = true;
      fallbackReason = "群主回复格式异常";
    }

    if (shouldFallbackToDefault) {
      console.warn(
        `[Urge] 群主回复格式异常，降级为默认催促${fallbackReason ? `: ${fallbackReason}` : ""}`,
      );
      if (defaultTargets.length > 0) {
        actualUrgeCount = await sendUrgeMessages({
          groupId,
          leader,
          targets: defaultTargets,
        });
      }
    }

    if (actualUrgeCount > 0) {
      updateGroupUrgeState(groupId, (current) => ({
        ...current,
        urgeCount: (current.urgeCount ?? 0) + 1,
      }));
    }

    const latestGroup = getGroupUrgeState(groupId);
    if (!latestGroup || latestGroup.isUrging !== true || latestGroup.isUrgePaused === true) {
      clearGroupUrgeTimer(groupId, "督促状态已结束");
      return;
    }

    scheduleGroupUrgeCheck(
      groupId,
      Math.max(1, intervalMinutes) * 60_000,
      actualUrgeCount > 0 ? "完成一轮督促" : "完成一次空检查",
    );
  }

  async function queueGroupDispatches(groupId: string, requests: GroupDispatchRequest[]) {
    if (requests.length === 0) {
      return [] as GroupDispatchResult[];
    }

    if (!requests.every((request) => request.skipRelayDetection === true)) {
      clearGroupRelaySettleTimer(groupId, "已有新的接力请求开始发送");
      clearGroupRelayIdleTimer(groupId, "已有新的接力请求开始发送");
    }
    beginGroupSend(groupId, requests.length);
    return await Promise.all(
      requests.map((request) =>
        dispatchMessageToTarget({
          groupId,
          group: request.group,
          member: request.member,
          members: request.members,
          text: request.text,
          attachments: request.attachments,
          userSpecifiedTargets: request.userSpecifiedTargets,
          epoch: request.epoch,
          source: request.source,
          skipRelayDetection: request.skipRelayDetection,
          showReplyInUi: request.showReplyInUi,
          showThinkingStatus: request.showThinkingStatus,
          skipAutoCompact: request.skipAutoCompact,
          requireReply: request.requireReply,
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
    attachments?: GatewayChatAttachmentInput[];
    userSpecifiedTargets: boolean;
    epoch: number;
    source: GroupDispatchSource;
    skipRelayDetection?: boolean;
    showReplyInUi?: boolean;
    showThinkingStatus?: boolean;
    skipAutoCompact?: boolean;
    requireReply?: boolean;
  }) {
    const {
      groupId,
      group,
      member,
      members,
      text,
      attachments = [],
      userSpecifiedTargets,
      epoch,
      source,
      skipRelayDetection = false,
      showReplyInUi = true,
      showThinkingStatus = true,
      skipAutoCompact = false,
      requireReply = true,
    } = params;

    try {
      const agentStore = useAgentStore.getState();
      const liveAgent = agentStore.agents.find((agent) => agent.id === member.id);
      const logPrefix = resolveDispatchLogPrefix(source.type);
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

      const payloadText =
        source.type === "assistant" ? buildRelayMessage(source.senderName, text) : text;
      const sessionKey = buildGroupSessionKey(targetMember.id, groupId);
      if (!skipAutoCompact) {
        await compactGroupSessionIfNeeded({
          groupId,
          member: targetMember,
          members,
          source,
          showThinkingStatus,
          sessionKey,
        });
      }

      const liveGroup = get().groups.find((item) => item.id === groupId) ?? group;
      const normalizedAnnouncement = normalizeGroupAnnouncement(liveGroup.announcement);
      const announcementVersion =
        typeof liveGroup.announcementVersion === "number" &&
        Number.isFinite(liveGroup.announcementVersion)
          ? liveGroup.announcementVersion
          : undefined;
      const syncedAnnouncementVersion = getAnnouncementSyncVersion(groupId, targetMember.id);
      const shouldInjectAnnouncement =
        source.type !== "announcement" &&
        Boolean(
          normalizedAnnouncement &&
          announcementVersion !== undefined &&
          syncedAnnouncementVersion !== announcementVersion,
        );
      const shouldMarkAnnouncementSynced =
        Boolean(normalizedAnnouncement && announcementVersion !== undefined) &&
        (source.type === "announcement" || shouldInjectAnnouncement);
      const startedAt = Date.now();
      const outboundMessage = buildGroupAgentRequestMessage({
        groupName: liveGroup.name,
        announcement: shouldInjectAnnouncement ? normalizedAnnouncement : undefined,
        members: toContextMembers(members),
        leaderId: liveGroup.leaderId,
        targetAgentId: targetMember.id,
        userSpecifiedTargets,
        message: payloadText,
      });

      console.log(`${logPrefix} 准备发送群上下文消息:`, {
        groupId: liveGroup.id,
        groupName: liveGroup.name,
        agentName: targetMember.name,
        hasAnnouncement: Boolean(normalizedAnnouncement),
        shouldInjectAnnouncement,
        announcementVersion,
        syncedAnnouncementVersion,
        announcementLength: normalizedAnnouncement?.length ?? 0,
        messageLength: payloadText.length,
        outboundMessageLength: outboundMessage.length,
        sourceType: source.type,
      });

      console.log(
        `${logPrefix} 注入群聊上下文 -> Agent: ${targetMember.name}, 群: ${liveGroup.name}, sessionKey=${sessionKey}`,
      );
      if (attachments.length > 0) {
        const result = await gateway.sendChat(outboundMessage, sessionKey, attachments);
        if (!result.ok) {
          throw new Error(result.error?.message || "群聊附件消息发送失败");
        }
      } else {
        const accepted = await gateway.sendAgentTurn({
          agentId: targetMember.id,
          sessionKey,
          message: outboundMessage,
          deliver: false,
        });
        const runId = accepted.runId?.trim();
        if (!runId) {
          throw new Error("未获取到 Agent runId");
        }

        const waitResult = await gateway.waitForAgentRun(runId, 120000);
        if (waitResult.status !== "ok") {
          throw new Error(
            waitResult.error?.trim() || `Agent 执行未完成，状态：${waitResult.status ?? "unknown"}`,
          );
        }
      }

      if (shouldMarkAnnouncementSynced && announcementVersion !== undefined) {
        markAnnouncementSynced(groupId, [targetMember.id], announcementVersion);
      }

      // 群聊不复用 1v1 的活跃回复桶，直接回拉目标 Agent 的历史拿最终结果。
      const reply = await loadLatestAssistantReply(sessionKey, startedAt);
      if (!reply && requireReply) {
        throw new Error("未获取到 Agent 回复");
      }

      if (reply) {
        useHealthStore.getState().recordAssistantMessage({
          agentId: targetMember.id,
          sessionKey,
          kind: attachments.length > 0 ? "chat.send" : "agent",
          message: {
            model: reply.model,
            usage: reply.usage,
            timestamp: reply.timestamp ?? Date.now(),
          },
        });
      }

      if (getGroupEpoch(groupId) !== epoch) {
        return {
          member: targetMember,
          reply: reply ?? null,
          ok: true,
        } satisfies GroupDispatchResult;
      }

      if (!isMemberStillInGroup(groupId, targetMember.id)) {
        // 成员已被移出群聊时，晚到的 run 结果不能再落消息或继续接力。
        const completionResult = completeThinkingAgentsInternal(groupId, targetMember.id, []);
        console.log(
          `[Member] 已忽略被移除成员的晚到回复: 群=${liveGroup.name}，成员=${targetMember.name}，剩余思考中=${completionResult.remainingAfterComplete.map((item) => item.name).join(", ") || "无"}`,
        );
        return {
          member: targetMember,
          reply: reply ?? null,
          ok: true,
        } satisfies GroupDispatchResult;
      }

      if (reply && showReplyInUi) {
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
          sessionTargetIds: [targetMember.id],
        });
        console.log(`${logPrefix} 群成员回复: ${targetMember.name}`);
      } else if (reply) {
        console.log(`${logPrefix} 已收到隐藏回复: ${targetMember.name}`);
      } else {
        console.log(`${logPrefix} 本次发送无需等待可见回复: ${targetMember.name}`);
      }

      if (skipRelayDetection) {
        syncUrgeReplyToRoundState({
          groupId,
          group,
          members,
          member: targetMember,
          epoch,
          source,
          reply: reply ?? null,
        });
        const completionResult = completeThinkingAgentsInternal(groupId, targetMember.id, []);
        const thinkingNames = completionResult.remainingAfterComplete
          .map((item) => item.name)
          .join(", ");
        console.log(
          `${logPrefix} 程序化消息处理完成: ${targetMember.name}, 剩余思考中: ${thinkingNames || "无"}`,
        );
        return {
          member: targetMember,
          reply: reply ?? null,
          ok: true,
        } satisfies GroupDispatchResult;
      }

      if (!reply) {
        const completionResult = completeThinkingAgentsInternal(groupId, targetMember.id, []);
        const thinkingNames = completionResult.remainingAfterComplete
          .map((item) => item.name)
          .join(", ");
        console.log(
          `[Group] 回复缺失但流程已结束: ${targetMember.name}, 剩余思考中: ${thinkingNames || "无"}`,
        );
        return {
          member: targetMember,
          reply: null,
          ok: true,
        } satisfies GroupDispatchResult;
      }

      const round = getGroupRoundState(groupId);
      const routeDepthLimit = resolveGroupRouteDepthLimit(
        members.length,
        round?.interventionLimit ?? DEFAULT_GROUP_RELAY_FALLBACK_LIMIT,
      );
      if (source.depth >= routeDepthLimit) {
        const completionResult = completeThinkingAgentsInternal(groupId, targetMember.id, []);
        clearGroupRoundState(groupId, "达到自动路由深度上限");
        const remainingNames = completionResult.remainingAfterComplete
          .map((item) => item.name)
          .join(", ");
        console.log(
          `[Group] 回复完成: ${targetMember.name}, 剩余思考中: ${remainingNames || "无"}`,
        );
        console.warn(`[Group] 群内协作转发达到深度上限: ${liveGroup.name}，已停止自动路由`);
        return {
          member: targetMember,
          reply,
          ok: true,
        } satisfies GroupDispatchResult;
      }

      const explicitNextTargets = extractMentionTargets(reply.content, members, [targetMember.id]);
      const explicitNextTargetIds = explicitNextTargets.map((nextTarget) => nextTarget.id);
      let nextTargets: AgentInfo[] = [];
      let roundEnded = false;
      const isRelayMode = round?.allMembersMode === true;

      if (round) {
        const nextRound = cloneGroupRoundState(round);
        removePendingMemberFromRound(nextRound, targetMember.id);
        markMemberSpoken(nextRound, targetMember.id);
        const relayDecision = resolveAssistantRelayTargets({
          isRelayMode: nextRound.allMembersMode,
          mentionedMemberIds: explicitNextTargetIds,
        });
        addPendingMembersToRound(nextRound, relayDecision.nextMemberIds);
        nextRound.lastReplyAt = Date.now();
        nextRound.lastReplyMemberId = targetMember.id;
        nextRound.lastReplyMemberName = targetMember.name;
        nextRound.lastReplyContent = reply.content;
        nextRound.lastReplyDepth = source.depth;
        nextRound.lastDispatchSourceType = source.type;
        nextRound.lastDispatchSystemReason = source.systemReason;

        const pendingNames = describeIdsAsNames(members, nextRound.pendingAgentIds);
        const remainingNames = describeIdsAsNames(members, nextRound.remainingAgentIds);
        console.log(
          `[Group] 回复状态更新: 发言人=${targetMember.name}，显式提及=${describeAgentNames(explicitNextTargets)}，pending=${pendingNames}，remaining=${remainingNames}，allMembers=${nextRound.allMembersMode}`,
        );

        if (!relayDecision.isRelayMode && explicitNextTargets.length > 0) {
          console.log(
            `[Group] 非接力模式，忽略回复中的 @ 转发: 发言人=${targetMember.name}，提及=${describeAgentNames(explicitNextTargets)}`,
          );
        }

        if (nextRound.allMembersMode) {
          nextTargets = explicitNextTargets.filter((nextTarget) =>
            nextRound.pendingAgentIds.has(nextTarget.id),
          );
        }

        if (
          nextRound.pendingAgentIds.size === 0 &&
          (!nextRound.allMembersMode || nextRound.remainingAgentIds.length === 0)
        ) {
          roundEnded = true;
          clearGroupRoundState(
            groupId,
            nextRound.allMembersMode ? "全员接力已完成" : "普通回合显式提及链路结束",
          );
        } else {
          setGroupRoundState(groupId, nextRound);
        }
      } else if (explicitNextTargets.length > 0) {
        console.log(
          `[Group] 非接力模式，忽略回复中的 @ 转发: 发言人=${targetMember.name}，提及=${describeAgentNames(explicitNextTargets)}`,
        );
      }

      const completionResult = completeThinkingAgentsInternal(
        groupId,
        targetMember.id,
        nextTargets,
      );
      const thinkingNames = completionResult.remainingAfterComplete
        .map((item) => item.name)
        .join(", ");
      console.log(`[Group] 回复完成: ${targetMember.name}, 剩余思考中: ${thinkingNames || "无"}`);

      if (completionResult.addedAgents.length > 0) {
        console.log(
          `[Group] 递归路由: ${targetMember.name} 的回复触发 → ${completionResult.addedAgents.map((item) => item.name).join("、")} 加入思考`,
        );
      }

      if (roundEnded) {
        console.log(`[Group] 本轮回复处理结束: ${liveGroup.name} 已结束当前回合`);
        return {
          member: targetMember,
          reply,
          ok: true,
        } satisfies GroupDispatchResult;
      }

      if (!isRelayMode) {
        return {
          member: targetMember,
          reply,
          ok: true,
        } satisfies GroupDispatchResult;
      }

      scheduleRelaySettleCheck({
        groupId,
        group,
        members,
        epoch,
      });
      scheduleRelayIdleWatchdog({
        groupId,
        group,
        members,
        epoch,
      });

      if (nextTargets.length === 0) {
        return {
          member: targetMember,
          reply,
          ok: true,
        } satisfies GroupDispatchResult;
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
          showReplyInUi: true,
          showThinkingStatus: true,
          requireReply: true,
        })),
      );
      return {
        member: targetMember,
        reply,
        ok: true,
      } satisfies GroupDispatchResult;
    } catch (error) {
      const errorText = getErrorMessage(error, "连接 Gateway 失败，请确认服务已启动");
      const logPrefix = resolveDispatchLogPrefix(source.type);
      console.error(`${logPrefix} 群消息发送失败: ${member.name}`, error);
      useHealthStore.getState().recordRequestError({
        agentId: member.id,
        sessionKey: buildGroupSessionKey(member.id, groupId),
        kind: attachments.length > 0 ? "chat.send" : "agent",
        message: errorText,
      });

      const removeResult = removeThinkingAgentInternal(groupId, member.id);
      console.log(
        `${logPrefix} 回复失败移出思考中: ${member.name}, 剩余思考中: ${removeResult.currentAgents.map((item) => item.name).join(", ") || "无"}`,
      );

      if (!isMemberStillInGroup(groupId, member.id)) {
        console.log(`[Member] 已忽略被移除成员的失败结果: 群=${group.name}，成员=${member.name}`);
        return {
          member,
          reply: null,
          ok: false,
        } satisfies GroupDispatchResult;
      }

      if (!skipRelayDetection && getGroupEpoch(groupId) === epoch) {
        const handledByRelay = await handleRelayDispatchFailure({
          groupId,
          group,
          members,
          member,
          epoch,
          source,
        });
        if (!handledByRelay && showReplyInUi) {
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
      } else if (showReplyInUi) {
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
          sessionTargetIds: [member.id],
        });
      }
      return {
        member,
        reply: null,
        ok: false,
      } satisfies GroupDispatchResult;
    } finally {
      finishGroupSend(groupId);
    }
  }

  async function cleanupGroupStateInternal(
    groupId: string,
    options: CleanupGroupStateOptions = {},
  ): Promise<GroupArchiveActionResult> {
    const group = get().groups.find((item) => item.id === groupId);
    if (!group) {
      const error = `找不到项目组 ${groupId}`;
      console.error(`[Group] 清理项目组状态失败: ${error}`);
      return {
        success: false,
        error,
      };
    }

    const archive = options.archive;
    const memberIds = collectGroupSessionMemberIds(group);
    const cleanupReason = archive ? "归档群聊记录" : "重置群聊记录";

    get().stopGroupUrging(groupId);
    cancelGroupPending(groupId);
    console.log(
      `[Group] 开始清理项目组状态: ${group.name}，原因=${cleanupReason}，成员数=${memberIds.length}`,
    );

    try {
      await Promise.all(
        memberIds.map(async (memberId) => {
          const sessionKey = buildGroupSessionKey(memberId, groupId);
          await gateway.resetSession(sessionKey);
        }),
      );

      clearAnnouncementSyncStatus(groupId, memberIds);

      updateState((state) => ({
        archives: archive ? [archive, ...state.archives] : state.archives,
        messagesByGroupId: {
          ...state.messagesByGroupId,
          [groupId]: [],
        },
        isSendingByGroupId: {
          ...state.isSendingByGroupId,
          [groupId]: false,
        },
        selectedArchiveId: null,
      }));
      clearSidebarGroupUnreadCount(groupId);

      console.log(`[Group] 已完成项目组状态清理: ${group.name}，归档=${archive ? "是" : "否"}`);
      return {
        success: true,
        archiveId: archive?.id,
      };
    } catch (error) {
      const message = getErrorMessage(
        error,
        archive ? "归档项目组会话失败，请稍后重试" : "重置项目组会话失败，请稍后重试",
      );
      console.error(`[Group] 项目组状态清理失败: ${group.name}`, error);
      return {
        success: false,
        error: message,
      };
    }
  }

  async function dissolveGroupInternal(groupId: string): Promise<GroupActionResult> {
    const group = get().groups.find((item) => item.id === groupId);
    if (!group) {
      const error = `找不到项目组 ${groupId}`;
      console.error(`[Group] 解散群聊失败: ${error}`);
      return {
        success: false,
        error,
      };
    }

    const memberIds = collectGroupSessionMemberIds(group);
    const sessionKeys = memberIds.map((memberId) => buildGroupSessionKey(memberId, groupId));

    get().stopGroupUrging(groupId);
    cancelGroupPending(groupId);
    clearGroupCompactingState(groupId);
    groupMessageEpochs.delete(groupId);
    pendingGroupSendCounts.delete(groupId);

    console.log(`[Group] 准备解散群聊: ${group.name}，成员数=${memberIds.length}`);

    try {
      await Promise.all(
        sessionKeys.map(async (sessionKey) => {
          try {
            await gateway.abortSession(sessionKey);
          } catch (error) {
            console.warn(`[Group] 取消群聊活跃请求失败: sessionKey=${sessionKey}`, error);
          }

          await gateway.deleteSession(sessionKey);
        }),
      );

      const committed = updateState((state) => {
        const nextGroups = state.groups.filter((item) => item.id !== groupId);
        const nextMessagesByGroupId = { ...state.messagesByGroupId };
        const nextIsSendingByGroupId = { ...state.isSendingByGroupId };
        const nextThinkingAgentsByGroupId = new Map(state.thinkingAgentsByGroupId);
        const nextAnnouncementSyncStatus = new Map(state.announcementSyncStatus);

        delete nextMessagesByGroupId[groupId];
        delete nextIsSendingByGroupId[groupId];
        nextThinkingAgentsByGroupId.delete(groupId);
        nextAnnouncementSyncStatus.delete(groupId);

        return {
          groups: nextGroups,
          selectedGroupId:
            state.selectedGroupId === groupId ? (nextGroups[0]?.id ?? null) : state.selectedGroupId,
          messagesByGroupId: ensureMessageBuckets(nextGroups, nextMessagesByGroupId),
          thinkingAgentsByGroupId: nextThinkingAgentsByGroupId,
          announcementSyncStatus: nextAnnouncementSyncStatus,
          isSendingByGroupId: nextIsSendingByGroupId,
        };
      });

      if (!committed) {
        return {
          success: false,
          error: "解散群聊失败，数据未保存",
        };
      }

      clearSidebarGroupUnreadCount(groupId);
      removeGroupCompactionBackups(groupId);
      console.log(`[Group] 解散群聊: groupId=${groupId}, name=${group.name}`);
      return {
        success: true,
      };
    } catch (error) {
      const message = getErrorMessage(error, "解散群聊失败，请稍后重试");
      console.error(`[Group] 解散群聊失败: ${group.name}`, error);
      return {
        success: false,
        error: message,
      };
    }
  }

  ensureGroupUrgeRuntimeInitialized();
  restoreActiveGroupUrgings(initialState.groups, "初始化项目组 store");

  return {
    ...initialState,
    thinkingAgentsByGroupId: new Map(),
    announcementSyncStatus: new Map(),
    isSendingByGroupId: {},

    fetchGroups: () => {
      const nextState = readStoredState();
      Array.from(groupRoundStates.keys()).forEach((groupId) => {
        clearGroupRoundState(groupId, "刷新项目组列表");
      });
      Array.from(groupUrgeTimerIds.keys()).forEach((groupId) => {
        clearGroupUrgeTimer(groupId, "刷新项目组列表");
      });
      console.log(`[Group] 获取项目组列表: ${nextState.groups.length} 个`);
      set({
        ...nextState,
        thinkingAgentsByGroupId: new Map(),
        announcementSyncStatus: new Map(),
        isSendingByGroupId: {},
      });
      ensureGroupUrgeRuntimeInitialized();
      restoreActiveGroupUrgings(nextState.groups, "刷新项目组列表");
    },

    createGroup: (data) => {
      const name = data.name.trim();
      const avatarUrl = resolveAvatarImage(data.avatarUrl) ?? undefined;
      const description = data.description?.trim() || undefined;
      const members = normalizeMembers(data.members);
      const group: Group = {
        id: crypto.randomUUID(),
        name,
        avatarUrl,
        description,
        announcement: undefined,
        announcementVersion: undefined,
        notificationsEnabled: true,
        soundEnabled: true,
        isUrging: false,
        urgeIntervalMinutes: 10,
        urgeStartedAt: undefined,
        urgeCount: 0,
        isUrgePaused: false,
        urgeLastCheckedAt: undefined,
        members,
        leaderId: data.leaderId,
        createdAt: new Date().toISOString(),
      };

      let createdGroup = group;
      const committed = updateState((state) => {
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
          selectedArchiveId: null,
          messagesByGroupId: ensureMessageBuckets(nextGroups, nextMessagesByGroupId),
        };
      });
      if (!committed) {
        throw new Error("项目组创建失败，数据未保存");
      }
      return createdGroup;
    },

    selectGroup: (groupId) => {
      console.log(`[Group] 选中项目组: ${groupId}`);
      updateState(() => ({
        selectedGroupId: groupId,
        selectedArchiveId: null,
      }));
      useDirectArchiveStore.getState().clearSelectedDirectArchive();
      clearSidebarGroupUnreadCount(groupId);
    },

    clearSelectedGroup: () => {
      console.log("[Group] 清空当前项目组选中态");
      updateState(() => ({
        selectedGroupId: null,
      }));
    },

    selectArchive: (archiveId) => {
      console.log(`[Archive] 选中项目组归档: ${archiveId}`);
      updateState(() => ({
        selectedGroupId: null,
        selectedArchiveId: archiveId,
      }));
      useDirectArchiveStore.getState().clearSelectedDirectArchive();
    },

    clearSelectedArchive: () => {
      console.log("[Archive] 清空当前项目组归档选中态");
      updateState(() => ({
        selectedArchiveId: null,
      }));
    },

    deleteArchive: (archiveId) => {
      const normalizedArchiveId = archiveId.trim();
      if (!normalizedArchiveId) {
        return;
      }

      updateState((state) => {
        const nextArchives = state.archives.filter((archive) => archive.id !== normalizedArchiveId);
        if (nextArchives.length === state.archives.length) {
          return {};
        }

        console.log(`[Archive] 删除项目组归档: ${normalizedArchiveId}`);
        return {
          archives: nextArchives,
          selectedArchiveId:
            state.selectedArchiveId === normalizedArchiveId ? null : state.selectedArchiveId,
        };
      });
    },

    renameArchive: (archiveId, title) => {
      const normalizedArchiveId = archiveId.trim();
      const nextTitle = sanitizeArchiveTitle(title);
      if (!normalizedArchiveId || !nextTitle) {
        return false;
      }

      let previousTitle = "";
      let renamed = false;
      const committed = updateState((state) => {
        const nextArchives = state.archives.map((archive) => {
          if (archive.id !== normalizedArchiveId) {
            return archive;
          }

          const currentTitle = sanitizeArchiveTitle(archive.title);
          if (!currentTitle || currentTitle === nextTitle) {
            return archive;
          }

          previousTitle = currentTitle;
          renamed = true;
          return {
            ...archive,
            title: nextTitle,
          };
        });

        if (!renamed) {
          return {};
        }

        return {
          archives: nextArchives,
        };
      });

      if (!committed || !renamed || !previousTitle) {
        return false;
      }

      console.log(`[Archive] 归档重命名: ${previousTitle} → ${nextTitle}`);
      return true;
    },

    updateGroupInfo: (groupId, payload) => {
      const nextName = payload.name.trim();
      if (!nextName) {
        console.error(`[Group] 更新项目组失败: 名称不能为空 (${groupId})`);
        return;
      }

      const group = get().groups.find((item) => item.id === groupId);
      if (!group) {
        console.error(`[Group] 更新项目组失败: 找不到项目组 ${groupId}`);
        return;
      }

      const nextDescription = payload.description?.trim() || undefined;
      const hasAvatarUpdate = Object.prototype.hasOwnProperty.call(payload, "avatarUrl");
      const nextAvatarUrl = hasAvatarUpdate
        ? (resolveAvatarImage(payload.avatarUrl) ?? undefined)
        : undefined;
      const committed = updateState((state) => ({
        groups: state.groups.map((item) =>
          item.id === groupId
            ? {
                ...item,
                name: nextName,
                avatarUrl: hasAvatarUpdate ? nextAvatarUrl : item.avatarUrl,
                description: nextDescription,
              }
            : item,
        ),
      }));

      if (committed) {
        console.log(`[Group] 已更新项目组信息: ${group.name} -> ${nextName}`);
      }
    },

    removeAgentData: (agentId) => {
      const normalizedAgentId = agentId.trim();
      if (!normalizedAgentId) {
        return;
      }

      const removedGroupIds: string[] = [];
      const touchedGroupIds: string[] = [];
      const committed = updateState((state) => {
        let nextSelectedGroupId = state.selectedGroupId;
        let nextSelectedArchiveId = state.selectedArchiveId;
        const nextMessagesByGroupId = { ...state.messagesByGroupId };
        const nextIsSendingByGroupId = { ...state.isSendingByGroupId };
        const nextThinkingAgentsByGroupId = new Map(state.thinkingAgentsByGroupId);
        const nextAnnouncementSyncStatus = new Map(state.announcementSyncStatus);
        const nextGroups: Group[] = [];

        for (const group of state.groups) {
          const leaderRemoved = group.leaderId === normalizedAgentId;
          const memberRemoved = group.members.some((member) => member.id === normalizedAgentId);
          if (!leaderRemoved && !memberRemoved) {
            nextGroups.push(group);
            continue;
          }

          touchedGroupIds.push(group.id);

          const nextThinkingGroup = nextThinkingAgentsByGroupId.get(group.id);
          if (nextThinkingGroup?.has(normalizedAgentId)) {
            const trimmedThinkingGroup = new Map(nextThinkingGroup);
            trimmedThinkingGroup.delete(normalizedAgentId);
            if (trimmedThinkingGroup.size > 0) {
              nextThinkingAgentsByGroupId.set(group.id, trimmedThinkingGroup);
            } else {
              nextThinkingAgentsByGroupId.delete(group.id);
            }
          }

          const currentAnnouncementSync = nextAnnouncementSyncStatus.get(group.id);
          if (currentAnnouncementSync) {
            const nextGroupSync = { ...currentAnnouncementSync };
            delete nextGroupSync[normalizedAgentId];
            if (Object.keys(nextGroupSync).length > 0) {
              nextAnnouncementSyncStatus.set(group.id, nextGroupSync);
            } else {
              nextAnnouncementSyncStatus.delete(group.id);
            }
          }

          const nextMembers = group.members.filter((member) => member.id !== normalizedAgentId);
          if (leaderRemoved && nextMembers.length === 0) {
            removedGroupIds.push(group.id);
            delete nextMessagesByGroupId[group.id];
            delete nextIsSendingByGroupId[group.id];
            nextThinkingAgentsByGroupId.delete(group.id);
            nextAnnouncementSyncStatus.delete(group.id);
            if (nextSelectedGroupId === group.id) {
              nextSelectedGroupId = null;
            }
            continue;
          }

          nextGroups.push({
            ...group,
            leaderId: leaderRemoved ? (nextMembers[0]?.id ?? group.leaderId) : group.leaderId,
            members: nextMembers,
          });
        }

        const removedGroupIdSet = new Set(removedGroupIds);
        const nextArchives = state.archives.filter(
          (archive) => !removedGroupIdSet.has(archive.groupId),
        );
        if (
          nextSelectedArchiveId &&
          !nextArchives.some((archive) => archive.id === nextSelectedArchiveId)
        ) {
          nextSelectedArchiveId = null;
        }

        return {
          groups: nextGroups,
          selectedGroupId: nextSelectedGroupId,
          selectedArchiveId: nextSelectedArchiveId,
          messagesByGroupId: ensureMessageBuckets(nextGroups, nextMessagesByGroupId),
          archives: nextArchives,
          thinkingAgentsByGroupId: nextThinkingAgentsByGroupId,
          announcementSyncStatus: nextAnnouncementSyncStatus,
          isSendingByGroupId: nextIsSendingByGroupId,
        };
      });

      if (!committed) {
        return;
      }

      touchedGroupIds.forEach((groupId) => {
        clearGroupRoundState(groupId, `员工已删除: ${normalizedAgentId}`);
      });
      removedGroupIds.forEach((groupId) => {
        clearGroupUrgeTimer(groupId, `项目组已删除: ${normalizedAgentId}`);
        clearSidebarGroupUnreadCount(groupId);
      });

      console.log(
        `[Group] 已清理员工关联项目组数据: ${normalizedAgentId}，影响项目组=${touchedGroupIds.length}，删除项目组=${removedGroupIds.length}`,
      );
    },

    updateGroupAnnouncement: (groupId, announcement) => {
      const normalizedAnnouncement = normalizeGroupAnnouncement(announcement);
      const group = get().groups.find((item) => item.id === groupId);
      if (!group) {
        console.error(`[Announce] 保存群公告失败: 找不到项目组 ${groupId}`);
        return;
      }

      const announcementVersion = normalizedAnnouncement ? Date.now() : undefined;

      const committed = updateState((state) => ({
        groups: state.groups.map((item) =>
          item.id === groupId
            ? {
                ...item,
                announcement: normalizedAnnouncement,
                announcementVersion,
              }
            : item,
        ),
      }));

      if (!committed) {
        return;
      }

      clearAnnouncementSyncStatus(groupId);
      console.log(
        normalizedAnnouncement
          ? `[Announce] 已保存群公告: ${group.name}，version=${announcementVersion}`
          : `[Announce] 已清空群公告: ${group.name}`,
      );

      if (!normalizedAnnouncement || announcementVersion === undefined) {
        return;
      }

      const latestGroup = get().groups.find((item) => item.id === groupId);
      if (!latestGroup) {
        return;
      }

      const members = resolveGroupMembers(latestGroup, useAgentStore.getState().agents);
      const leader = getLeaderMember(latestGroup, members);
      if (!leader || members.length === 0) {
        console.warn(`[Announce] 群公告广播跳过: ${group.name} 缺少可用成员或群主`);
        return;
      }

      const visibleMessage: GroupChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: buildAnnouncementBroadcastVisibleMessage(normalizedAnnouncement),
        timestamp: Date.now(),
        isNew: true,
        isHistorical: false,
        senderId: leader.id,
        senderName: leader.name,
        senderEmoji: leader.emoji,
        senderAvatarUrl: leader.avatarUrl,
      };

      void dispatchProgrammaticMessage({
        groupId,
        text: buildAnnouncementBroadcastDispatchMessage(normalizedAnnouncement),
        targetIds: members.map((member) => member.id),
        visibleMessage,
        source: {
          senderId: leader.id,
          senderName: leader.name,
          depth: 0,
          type: "announcement",
        },
        showReplyInUi: true,
        showThinkingStatus: false,
        requireReply: false,
      })
        .then((results) => {
          const syncedAgentIds = results
            .filter((result) => result.ok)
            .map((result) => result.member.id);
          if (syncedAgentIds.length > 0) {
            markAnnouncementSynced(groupId, syncedAgentIds, announcementVersion);
          }
          console.log(
            `[Announce] 群公告广播完成: ${group.name}，已同步=${syncedAgentIds.length}/${members.length}`,
          );
        })
        .catch((error) => {
          console.error(`[Announce] 群公告广播失败: ${group.name}`, error);
        });
    },

    setGroupNotificationsEnabled: (groupId, enabled) => {
      const group = get().groups.find((item) => item.id === groupId);
      if (!group) {
        console.error(`[Notify] 更新消息提醒失败: 找不到项目组 ${groupId}`);
        return;
      }

      const committed = updateState((state) => ({
        groups: state.groups.map((item) =>
          item.id === groupId
            ? {
                ...item,
                notificationsEnabled: enabled,
              }
            : item,
        ),
      }));

      if (committed) {
        console.log(`[Notify] ${enabled ? "开启" : "关闭"}消息提醒: ${group.name}`);
      }
    },

    setGroupSoundEnabled: (groupId, enabled) => {
      const group = get().groups.find((item) => item.id === groupId);
      if (!group) {
        console.error(`[Notify] 更新音效失败: 找不到项目组 ${groupId}`);
        return;
      }

      const committed = updateState((state) => ({
        groups: state.groups.map((item) =>
          item.id === groupId
            ? {
                ...item,
                soundEnabled: enabled,
              }
            : item,
        ),
      }));

      if (committed) {
        console.log(`[Notify] ${enabled ? "开启" : "关闭"}音效: ${group.name}`);
      }
    },

    startGroupUrging: (groupId, intervalMinutes) => {
      const group = getGroupUrgeState(groupId);
      if (!group) {
        return;
      }

      ensureGroupUrgeRuntimeInitialized();
      const now = Date.now();
      const safeInterval = Math.max(1, Math.floor(intervalMinutes));
      updateGroupUrgeState(groupId, (current) => ({
        ...current,
        isUrging: true,
        urgeIntervalMinutes: safeInterval,
        urgeStartedAt: now,
        urgeCount: 0,
        isUrgePaused: false,
        urgeLastCheckedAt: now,
      }));
      console.log(`[Urge] 已开启督促模式: ${group.name}，间隔=${safeInterval}分钟`);
      scheduleGroupUrgeCheck(groupId, safeInterval * 60_000, "开启督促模式");
    },

    pauseGroupUrging: (groupId) => {
      const group = getGroupUrgeState(groupId);
      if (!group || group.isUrging !== true) {
        return;
      }

      clearGroupUrgeTimer(groupId, "暂停督促模式");
      updateGroupUrgeState(groupId, (current) => ({
        ...current,
        isUrgePaused: true,
      }));
      console.log(`[Urge] 已暂停督促模式: ${group.name}`);
    },

    resumeGroupUrging: (groupId) => {
      const group = getGroupUrgeState(groupId);
      if (!group || group.isUrging !== true) {
        return;
      }

      ensureGroupUrgeRuntimeInitialized();
      const now = Date.now();
      const intervalMinutes = group.urgeIntervalMinutes ?? 10;
      updateGroupUrgeState(groupId, (current) => ({
        ...current,
        isUrgePaused: false,
        urgeLastCheckedAt: now,
      }));
      console.log(`[Urge] 已恢复督促模式: ${group.name}`);
      scheduleGroupUrgeCheck(groupId, intervalMinutes * 60_000, "恢复督促模式");
    },

    stopGroupUrging: (groupId) => {
      const group = getGroupUrgeState(groupId);
      if (!group) {
        return;
      }

      clearGroupUrgeTimer(groupId, "关闭督促模式");
      updateGroupUrgeState(groupId, (current) => ({
        ...current,
        isUrging: false,
        urgeIntervalMinutes: current.urgeIntervalMinutes ?? 10,
        urgeStartedAt: undefined,
        urgeCount: 0,
        isUrgePaused: false,
        urgeLastCheckedAt: undefined,
      }));
      console.log(`[Urge] 已关闭督促模式: ${group.name}`);
    },

    restoreGroupUrging: (groupId) => {
      const group = getGroupUrgeState(groupId);
      if (!group || group.isUrging !== true || group.isUrgePaused === true) {
        clearGroupUrgeTimer(groupId, "恢复时发现未开启或已暂停");
        return;
      }

      ensureGroupUrgeRuntimeInitialized();
      const now = Date.now();
      const delayMs = resolveUrgeNextDelayMs({
        intervalMinutes: group.urgeIntervalMinutes ?? 10,
        lastCheckedAt: group.urgeLastCheckedAt ?? group.urgeStartedAt ?? now,
        now,
      });
      console.log(
        `[Urge] 恢复督促定时器: ${group.name}，delayMs=${delayMs}，count=${group.urgeCount ?? 0}`,
      );

      if (delayMs === 0) {
        void performGroupUrgeCheck(groupId, "restore");
        return;
      }

      scheduleGroupUrgeCheck(groupId, delayMs, "恢复督促模式");
    },

    clearGroupUrgeRuntime: (groupId, reason) => {
      clearGroupUrgeTimer(groupId, reason ?? "清理督促运行时");
    },

    compensateGroupUrge: (groupId) => {
      const group = getGroupUrgeState(groupId);
      if (!group || group.isUrging !== true || group.isUrgePaused === true) {
        return;
      }

      const now = Date.now();
      const delayMs = resolveUrgeNextDelayMs({
        intervalMinutes: group.urgeIntervalMinutes ?? 10,
        lastCheckedAt: group.urgeLastCheckedAt ?? group.urgeStartedAt ?? now,
        now,
      });

      if (delayMs > 0) {
        console.log(`[Urge] 可见性补偿检查跳过: ${group.name}，remainingMs=${delayMs}`);
        return;
      }

      console.log(`[Urge] 可见性补偿触发: ${group.name}`);
      void performGroupUrgeCheck(groupId, "visibility");
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

    handleMemberRemoved: (groupId, member) => {
      handleRemovedMemberRuntime(groupId, member);
    },

    cleanupGroupState: cleanupGroupStateInternal,

    sendGroupMessage: async (groupId, text, attachments = []) => {
      const cleanText = text.trim();
      if (!cleanText && attachments.length === 0) {
        return;
      }
      const outboundText =
        cleanText || (attachments.length > 0 ? "请查看我刚上传的附件并继续回复。" : "");

      const group = get().groups.find((item) => item.id === groupId);
      if (!group) {
        return;
      }

      const userMessage: GroupChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: cleanText || `发送了 ${attachments.length} 个附件`,
        timestamp: Date.now(),
        isNew: true,
        isHistorical: false,
      };
      await dispatchGroupInput({
        groupId,
        text: outboundText,
        attachments,
        displayMessage: userMessage,
        source: {
          senderName: "用户",
          depth: 0,
          type: "user",
        },
      });
    },

    mirrorCronReplyToGroup: ({ groupId, agentId, jobId, message }) => {
      const normalizedGroupId = groupId.trim();
      const normalizedAgentId = agentId.trim();
      if (!normalizedGroupId || !normalizedAgentId) {
        return;
      }

      const existingMessages = get().messagesByGroupId[normalizedGroupId] ?? [];
      if (existingMessages.some((item) => item.id === message.id)) {
        return;
      }

      const agent = useAgentStore.getState().agents.find((item) => item.id === normalizedAgentId);
      appendGroupAssistantMessage(normalizedGroupId, {
        ...message,
        id: message.id,
        role: "assistant",
        isLoading: false,
        isNew: true,
        isHistorical: false,
        senderId: normalizedAgentId,
        senderName: agent?.name?.trim() || normalizedAgentId,
        senderEmoji: agent?.emoji?.trim() || undefined,
        senderAvatarUrl: (resolveAvatarImage(agent) ?? agent?.avatarUrl?.trim()) || undefined,
      });

      console.log(
        `[Cron] mirror group reply: groupId=${normalizedGroupId}, agentId=${normalizedAgentId}, jobId=${jobId}`,
      );
    },

    archiveGroupMessages: async (groupId, title) => {
      const group = get().groups.find((item) => item.id === groupId);
      const messages = get().messagesByGroupId[groupId] ?? [];
      if (!group || messages.length === 0) {
        return {
          success: false,
          error: group ? "当前没有可归档的群聊记录" : `找不到项目组 ${groupId}`,
        };
      }

      console.log(`[Archive] 准备归档项目组会话: ${group.name}`);
      return cleanupGroupStateInternal(groupId, {
        archive: createGroupArchive(group, messages, get().archives, sanitizeArchiveTitle(title)),
      });
    },

    archiveGroupSession: async (groupId, title) => {
      return get().archiveGroupMessages(groupId, title);
    },

    resetGroupMessages: async (groupId) => {
      return cleanupGroupStateInternal(groupId);
    },

    dissolveGroup: dissolveGroupInternal,
  };
});

export async function cleanupGroupState(groupId: string, options?: CleanupGroupStateOptions) {
  return useGroupStore.getState().cleanupGroupState(groupId, options);
}

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
