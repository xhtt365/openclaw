// 复制自 openclaw 3.13 原版 ui/src/ui/views/chat.ts、ui/src/ui/controllers/chat.ts、ui/src/ui/app-render.ts，用于二开定制

"use client";

import { html, render as renderLit } from "lit";
import { memo, startTransition, useEffect, useMemo, useRef, useState } from "react";
import {
  adaptGroupMessagesToSurfaceMessages,
  buildGroupSurfaceSessionKey,
  buildGroupSurfaceSessions,
} from "@/components/chat/groupSurfaceAdapter";
import {
  handleAgentEvent,
  type CompactionStatus,
  type FallbackStatus,
  type ToolStreamEntry,
} from "@/components/chat/original/app-tool-stream";
import {
  buildAgentNamesById,
  mergeSessionsWithKnownAgents,
  resolveSessionAgentId,
} from "@/components/chat/original/chat-sessions";
import { renderOriginalChatShell } from "@/components/chat/original/chat-shell";
import { extractText } from "@/components/chat/original/chat/message-extract";
import { shouldHideSystemToolMessage } from "@/components/chat/original/chat/system-message-filter";
import {
  abortChatRun,
  handleChatEvent,
  loadChatHistory,
  sendChatMessage,
  type ChatState,
} from "@/components/chat/original/controllers/chat";
import type { SessionsListResult } from "@/components/chat/original/types";
import type { ChatAttachment, ChatQueueItem } from "@/components/chat/original/ui-types";
import {
  cleanupChatModuleState,
  renderChat,
  toggleChatSearch,
  type CompactionIndicatorStatus,
  type FallbackIndicatorStatus,
} from "@/components/chat/original/views/chat";
import type { Employee } from "@/components/layout/EmployeeList";
import { useTheme } from "@/components/layout/useTheme";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { EditGroupModal } from "@/components/modals/EditGroupModal";
import { GroupAnnouncementModal } from "@/components/modals/GroupAnnouncementModal";
import { GroupMemberManageModal } from "@/components/modals/GroupMemberManageModal";
import { GroupUrgeModal } from "@/components/modals/GroupUrgeModal";
import { toast } from "@/components/ui/use-toast";
import { gateway, type GatewayChatEventPayload } from "@/services/gateway";
import { useAgentStore, type Agent } from "@/stores/agentStore";
import { useChatStore } from "@/stores/chatStore";
import {
  getGroupContextMetrics,
  useGroupStore,
  type AgentInfo,
  type Group,
  type GroupChatMessage,
} from "@/stores/groupStore";
import type { ModelProviderGroup } from "@/types/model";
import { getAgentAvatarInfo } from "@/utils/agentAvatar";
import {
  findActiveGroupMention,
  insertGroupMention,
  matchesGroupMentionQuery,
} from "@/utils/groupMention";
import {
  buildGroupMemberAvatarCache,
  decorateGroupHtmlMentions,
  getGroupMemberCount,
  renderGroupMentionPreviewHtml,
  resolveGroupAvatarUrl,
  resolveGroupMemberAvatarUrl,
  resolveInitialAvatarText,
  resolveGroupMembersForSurface,
} from "@/utils/groupSurface";
import { adaptSidebarSyncMessages } from "@/utils/messageAdapter";
import { getUserProfile, subscribeToUserProfile, type UserProfile } from "@/utils/userProfile";
import "@/styles/openclaw-chat.css";

type ToolStreamMessage = Record<string, unknown>;

type ChatModelCatalogEntry = {
  id: string;
  provider?: string;
};

type ChatRuntimeState = ChatState & {
  chatToolMessages: ToolStreamMessage[];
  chatStreamSegments: Array<{ text: string; ts: number }>;
  toolStreamById: Map<string, ToolStreamEntry>;
  toolStreamOrder: string[];
  toolStreamSyncTimer: number | null;
  compactionStatus: CompactionStatus | null;
  compactionClearTimer: number | null;
  fallbackStatus: FallbackStatus | null;
  fallbackClearTimer: number | null;
  newSessionLoading: boolean;
};

type PendingNewSessionState = {
  sessionKey: string;
};

type QuickActionKind = "compact" | "archive" | "reset";

type OpenClawChatSurfaceProps = {
  employee: Employee;
  group?: Group | null;
  isChatFullscreen: boolean;
  onChatFullscreenChange: (nextValue: boolean) => void;
  onSelectEmployee?: (employee: Employee) => void;
};

const EMPTY_GROUP_MESSAGES: GroupChatMessage[] = [];
const CHAT_AVATAR_COLORS = [
  "var(--color-avatar-1)",
  "var(--color-avatar-2)",
  "var(--color-avatar-3)",
  "var(--color-avatar-4)",
  "var(--color-avatar-5)",
  "var(--color-avatar-6)",
] as const;
const LOGGED_GROUP_MEMBER_AVATAR_FALLBACK = new Set<string>();

function buildSessionKey(agentId: string, mainKey: string) {
  return `agent:${agentId}:${mainKey}`;
}

function hashText(value: string) {
  return Array.from(value).reduce((total, char) => total + char.charCodeAt(0), 0);
}

function resolveChatAvatarColor(agentId: string) {
  return CHAT_AVATAR_COLORS[hashText(agentId) % CHAT_AVATAR_COLORS.length];
}

function buildEmployeeFromAgent(agent: Agent) {
  const avatarInfo = getAgentAvatarInfo(agent.id, agent.avatarUrl ?? agent.emoji, agent.name);
  const avatarText =
    avatarInfo.type === "image" ? resolveInitialAvatarText(agent.name) : avatarInfo.value;

  return {
    id: agent.id,
    name: agent.name,
    role: agent.role?.trim() || "",
    status: "online" as const,
    lastMessage: "",
    timestamp: "",
    avatarColor: resolveChatAvatarColor(agent.id),
    avatarText,
    avatarUrl: avatarInfo.type === "image" ? avatarInfo.value : undefined,
    emoji: avatarInfo.type === "emoji" ? avatarInfo.value : agent.emoji,
  } satisfies Employee;
}

function resolveMemberAvatarText(member: Pick<AgentInfo, "id" | "name" | "emoji" | "avatarUrl">) {
  const avatarInfo = getAgentAvatarInfo(member.id, member.avatarUrl ?? member.emoji, member.name);
  return avatarInfo.type === "image" ? resolveInitialAvatarText(member.name) : avatarInfo.value;
}

function resolvePreviewAgentId(sessionKey: string, fallbackAgentId: string) {
  return resolveSessionAgentId(sessionKey) ?? fallbackAgentId;
}

function createChatClient() {
  return {
    request<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>) {
      // Fix: 问题11 - chat.send 只等 accepted 回执，但仍给较长 RPC 超时，避免偶发慢回执被前端误判。
      const timeoutMs = method === "chat.send" ? 30000 : undefined;
      return gateway.sendRequest<T>(method, params ?? {}, timeoutMs);
    },
  };
}

function createChatRuntime(sessionKey: string, connected: boolean): ChatRuntimeState {
  return {
    client: createChatClient(),
    connected,
    sessionKey,
    chatLoading: false,
    chatMessages: [],
    chatThinkingLevel: null,
    chatSending: false,
    chatMessage: "",
    chatAttachments: [],
    chatRunId: null,
    chatStream: null,
    chatStreamStartedAt: null,
    lastError: null,
    chatToolMessages: [],
    chatStreamSegments: [],
    toolStreamById: new Map<string, ToolStreamEntry>(),
    toolStreamOrder: [],
    toolStreamSyncTimer: null,
    compactionStatus: null,
    compactionClearTimer: null,
    fallbackStatus: null,
    fallbackClearTimer: null,
    newSessionLoading: false,
  };
}

function syncGroupRuntimeState(
  runtime: ChatRuntimeState,
  messages: GroupChatMessage[],
  members: AgentInfo[],
  sending: boolean,
  connected: boolean,
) {
  runtime.connected = connected;
  runtime.chatLoading = false;
  runtime.chatThinkingLevel = null;
  runtime.chatMessages = adaptGroupMessagesToSurfaceMessages(messages, members);
  runtime.chatSending = sending;
  runtime.newSessionLoading = false;

  if (!sending) {
    runtime.chatRunId = null;
    runtime.chatStream = null;
    runtime.chatStreamStartedAt = null;
  }
}

function isChatBusy(runtime: ChatRuntimeState) {
  return Boolean(runtime.chatRunId || runtime.chatStream !== null);
}

function clearRuntimeTimers(runtime: ChatRuntimeState | null) {
  if (!runtime) {
    return;
  }

  if (runtime.toolStreamSyncTimer !== null) {
    window.clearTimeout(runtime.toolStreamSyncTimer);
    runtime.toolStreamSyncTimer = null;
  }
  if (runtime.compactionClearTimer !== null) {
    window.clearTimeout(runtime.compactionClearTimer);
    runtime.compactionClearTimer = null;
  }
  if (runtime.fallbackClearTimer !== null) {
    window.clearTimeout(runtime.fallbackClearTimer);
    runtime.fallbackClearTimer = null;
  }
}

function createQueuedItem(
  text: string,
  attachments: ChatAttachment[],
  localCommandName?: string,
): ChatQueueItem {
  return {
    id: crypto.randomUUID(),
    text,
    createdAt: Date.now(),
    attachments,
    localCommandName,
  };
}

function hasRenderableAssistantText(messages: unknown[]) {
  return messages.some((message) => {
    if (!message || typeof message !== "object") {
      return false;
    }
    if (shouldHideSystemToolMessage(message)) {
      return false;
    }

    const entry = message as Record<string, unknown>;
    const role = typeof entry.role === "string" ? entry.role.toLowerCase() : "";
    if (role !== "assistant") {
      return false;
    }

    const text = extractText(message);
    return typeof text === "string" && text.trim().length > 0;
  });
}

function hasRenderableAssistantStream(runtime: Pick<ChatRuntimeState, "chatStream">) {
  return typeof runtime.chatStream === "string" && runtime.chatStream.trim().length > 0;
}

function syncSidebarPreview(agentId: string, rawMessages: unknown[]) {
  const mappedMessages = adaptSidebarSyncMessages(rawMessages);

  useChatStore.setState((state) => {
    const nextMessagesByAgentId = new Map(state.messagesByAgentId);
    nextMessagesByAgentId.set(agentId, mappedMessages);

    const nextLoadedByAgentId = new Map(state.historyLoadedByAgentId);
    nextLoadedByAgentId.set(agentId, true);

    const nextLoadingByAgentId = new Map(state.historyLoadingByAgentId);
    nextLoadingByAgentId.set(agentId, false);

    return {
      messagesByAgentId: nextMessagesByAgentId,
      historyLoadedByAgentId: nextLoadedByAgentId,
      historyLoadingByAgentId: nextLoadingByAgentId,
    };
  });
}

function flattenModelCatalog(modelGroups: ModelProviderGroup[]): ChatModelCatalogEntry[] {
  const seen = new Set<string>();
  const entries: ChatModelCatalogEntry[] = [];

  for (const group of modelGroups) {
    for (const model of group.models) {
      const modelId = model.id.trim();
      if (!modelId) {
        continue;
      }

      const key = modelId.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      entries.push({
        id: modelId,
        provider: group.provider.trim() || undefined,
      });
    }
  }

  return entries;
}

function withChatModelOverride(
  overrides: Record<string, string | null>,
  sessionKey: string,
  value: string | null | undefined,
) {
  const next = { ...overrides };
  if (value === undefined) {
    delete next[sessionKey];
  } else {
    next[sessionKey] = value;
  }
  return next;
}

function isCronSessionKey(key: string) {
  const normalized = key.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith("cron:")) {
    return true;
  }
  if (!normalized.startsWith("agent:")) {
    return false;
  }
  const parts = normalized.split(":").filter(Boolean);
  if (parts.length < 3) {
    return false;
  }
  return parts.slice(2).join(":").startsWith("cron:");
}

function countHiddenCronSessions(sessionKey: string, sessions: SessionsListResult | null) {
  return (
    sessions?.sessions?.filter((row) => isCronSessionKey(row.key) && row.key !== sessionKey)
      .length ?? 0
  );
}

function resolveCurrentSessionRow(sessionKey: string, sessions: SessionsListResult | null) {
  return sessions?.sessions?.find((row) => row.key === sessionKey);
}

function resolveCurrentChatModelValue(
  sessionKey: string,
  sessions: SessionsListResult | null,
  overrides: Record<string, string | null>,
) {
  const override = overrides[sessionKey];
  if (typeof override === "string") {
    return override.trim();
  }
  if (override === null) {
    return "";
  }

  const session = resolveCurrentSessionRow(sessionKey, sessions);
  return typeof session?.model === "string" ? session.model.trim() : "";
}

function resolveDefaultChatModel(sessions: SessionsListResult | null) {
  return typeof sessions?.defaults?.model === "string" ? sessions.defaults.model.trim() : "";
}

function buildChatModelOptions(
  catalog: ChatModelCatalogEntry[],
  currentModelValue: string,
  defaultModelValue: string,
) {
  const seen = new Set<string>();
  const options: Array<{ value: string; label: string }> = [];
  const addOption = (value: string, label?: string) => {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return;
    }

    const key = normalizedValue.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    options.push({ value: normalizedValue, label: label ?? normalizedValue });
  };

  for (const model of catalog) {
    addOption(model.id, model.provider ? `${model.id} · ${model.provider}` : model.id);
  }

  addOption(currentModelValue);
  addOption(defaultModelValue);
  return options;
}

function OpenClawChatSurfaceInner({
  employee,
  group = null,
  isChatFullscreen,
  onChatFullscreenChange,
  onSelectEmployee,
}: OpenClawChatSurfaceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<ChatRuntimeState | null>(null);
  const queueRef = useRef<ChatQueueItem[]>([]);
  const stickToBottomRef = useRef(true);
  const pendingContentChangeRef = useRef(false);
  const activeAgentIdRef = useRef(employee.id);
  const sessionKeyRef = useRef<string | null>(null);
  const processingQueueRef = useRef(false);
  const pendingNewSessionRef = useRef<PendingNewSessionState | null>(null);
  const [renderNonce, setRenderNonce] = useState(0);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionsListResult | null>(null);
  const [queue, setQueue] = useState<ChatQueueItem[]>([]);
  const [showThinking, setShowThinking] = useState(true);
  const [hideCronSessions, setHideCronSessions] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarContent, setSidebarContent] = useState<string | null>(null);
  const [sidebarError, setSidebarError] = useState<string | null>(null);
  const [splitRatio, setSplitRatio] = useState(0.6);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const [chatModelCatalog, setChatModelCatalog] = useState<ChatModelCatalogEntry[]>([]);
  const [chatModelsLoading, setChatModelsLoading] = useState(false);
  const [chatModelOverrides, setChatModelOverrides] = useState<Record<string, string | null>>({});
  const [isAnnouncementModalOpen, setIsAnnouncementModalOpen] = useState(false);
  const [announcementDraft, setAnnouncementDraft] = useState("");
  const [isUrgeModalOpen, setIsUrgeModalOpen] = useState(false);
  const [urgeIntervalDraft, setUrgeIntervalDraft] = useState(group?.urgeIntervalMinutes ?? 10);
  const [isEditGroupModalOpen, setIsEditGroupModalOpen] = useState(false);
  const [isMemberManageModalOpen, setIsMemberManageModalOpen] = useState(false);
  const [pendingQuickAction, setPendingQuickAction] = useState<QuickActionKind | null>(null);
  const [isQuickActionLoading, setIsQuickActionLoading] = useState(false);
  const [groupCaretPosition, setGroupCaretPosition] = useState(0);
  const [isGroupInputFocused, setIsGroupInputFocused] = useState(false);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [dismissedMentionSignature, setDismissedMentionSignature] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile>(() => getUserProfile());
  const [agentAvatarVersion, setAgentAvatarVersion] = useState(0);
  const gatewayStatus = useChatStore((state) => state.status);
  const switchAgent = useChatStore((state) => state.switchAgent);
  const compactCurrentSession = useChatStore((state) => state.compactCurrentSession);
  const resetCurrentSession = useChatStore((state) => state.resetCurrentSession);
  const archiveCurrentSession = useChatStore((state) => state.archiveCurrentSession);
  const agents = useAgentStore((state) => state.agents);
  const mainKey = useAgentStore((state) => state.mainKey);
  const closeDetail = useAgentStore((state) => state.closeDetail);
  const allGroups = useGroupStore((state) => state.groups);
  const clearSelectedArchive = useGroupStore((state) => state.clearSelectedArchive);
  const clearSelectedGroup = useGroupStore((state) => state.clearSelectedGroup);
  const groupId = group?.id ?? "";
  const groupMessages = useGroupStore(
    (state) => state.messagesByGroupId[groupId] ?? EMPTY_GROUP_MESSAGES,
  );
  const isGroupSending = useGroupStore((state) => state.isSendingByGroupId[groupId]);
  const sendGroupMessage = useGroupStore((state) => state.sendGroupMessage);
  const archiveGroupSession = useGroupStore((state) => state.archiveGroupSession);
  const resetGroupMessages = useGroupStore((state) => state.resetGroupMessages);
  const selectGroup = useGroupStore((state) => state.selectGroup);
  const updateGroupAnnouncement = useGroupStore((state) => state.updateGroupAnnouncement);
  const setGroupNotificationsEnabled = useGroupStore((state) => state.setGroupNotificationsEnabled);
  const setGroupSoundEnabled = useGroupStore((state) => state.setGroupSoundEnabled);
  const startGroupUrging = useGroupStore((state) => state.startGroupUrging);
  const pauseGroupUrging = useGroupStore((state) => state.pauseGroupUrging);
  const resumeGroupUrging = useGroupStore((state) => state.resumeGroupUrging);
  const stopGroupUrging = useGroupStore((state) => state.stopGroupUrging);
  const { theme, setTheme } = useTheme();
  const pendingMentionSelectionRef = useRef<number | null>(null);

  const requestRender = () => {
    startTransition(() => {
      setRenderNonce((current) => current + 1);
    });
  };

  function clearPendingNewSession() {
    pendingNewSessionRef.current = null;
  }

  const isGroupMode = group !== null;
  const connected = gatewayStatus === "connected";
  const activeAgentId = isGroupMode ? group.leaderId : employee.id;
  const groupMetrics = useMemo(() => getGroupContextMetrics(groupMessages), [groupMessages]);
  const groupSessionKey = useMemo(
    () => (group ? buildGroupSurfaceSessionKey(group) : null),
    [group],
  );
  const groupSessions = useMemo(
    () =>
      group
        ? buildGroupSurfaceSessions({
            group,
            messages: groupMessages,
            contextTokens: groupMetrics.total,
          })
        : null,
    [group, groupMessages, groupMetrics.total],
  );
  const sessionAgentId = useMemo(() => resolveSessionAgentId(sessionKey), [sessionKey]);
  const displayedAgentId = sessionAgentId ?? activeAgentId;
  const activeAgent = useMemo(
    () =>
      agents.find((agent) => agent.id === displayedAgentId) ??
      agents.find((agent) => agent.id === activeAgentId) ??
      null,
    [activeAgentId, agents, displayedAgentId],
  );
  const agentNamesById = useMemo(() => {
    const names = buildAgentNamesById(agents);
    if (group) {
      names[group.leaderId] = group.name;
    }
    return names;
  }, [agents, group]);
  const defaultSessionKey = useMemo(
    () =>
      isGroupMode ? groupSessionKey : mainKey ? buildSessionKey(activeAgentId, mainKey) : null,
    [activeAgentId, groupSessionKey, isGroupMode, mainKey],
  );
  const assistantName = isGroupMode
    ? group.name
    : activeAgent?.name?.trim() || employee.name || "Assistant";
  const groupAvatarUrl = useMemo(
    () => (group ? resolveGroupAvatarUrl(group) : null),
    [group, agentAvatarVersion],
  );
  const assistantAvatarInfo = useMemo(
    () =>
      getAgentAvatarInfo(
        displayedAgentId,
        activeAgent?.avatarUrl ?? activeAgent?.emoji ?? employee.avatarUrl ?? employee.emoji,
        assistantName,
      ),
    [
      activeAgent?.avatarUrl,
      activeAgent?.emoji,
      assistantName,
      displayedAgentId,
      employee.avatarUrl,
      employee.emoji,
      agentAvatarVersion,
    ],
  );
  const assistantAvatarUrl = isGroupMode
    ? groupAvatarUrl
    : assistantAvatarInfo.type === "image"
      ? assistantAvatarInfo.value
      : null;
  const assistantAvatar = isGroupMode ? groupAvatarUrl : assistantAvatarInfo.value;
  const assistantAvatarText = useMemo(
    () =>
      isGroupMode
        ? group?.name.trim().charAt(0).toUpperCase() || "组"
        : assistantAvatarInfo.type === "image"
          ? assistantName.charAt(0).toUpperCase() || "A"
          : assistantAvatarInfo.value,
    [assistantAvatarInfo, assistantName, group, isGroupMode],
  );
  const assistantAvatarColor = useMemo(
    () => (isGroupMode ? resolveChatAvatarColor(group?.id ?? assistantName) : employee.avatarColor),
    [assistantName, employee.avatarColor, group?.id, isGroupMode],
  );
  const currentModelValue = useMemo(() => {
    if (isGroupMode) {
      return "";
    }

    return sessionKey ? resolveCurrentChatModelValue(sessionKey, sessions, chatModelOverrides) : "";
  }, [chatModelOverrides, isGroupMode, sessionKey, sessions]);
  const defaultModelValue = useMemo(
    () => (isGroupMode ? "项目组会话" : resolveDefaultChatModel(sessions)),
    [isGroupMode, sessions],
  );
  const chatModelOptions = useMemo(
    () =>
      isGroupMode
        ? []
        : buildChatModelOptions(chatModelCatalog, currentModelValue, defaultModelValue),
    [chatModelCatalog, currentModelValue, defaultModelValue, isGroupMode],
  );
  const hiddenCronCount = useMemo(
    () => (sessionKey ? countHiddenCronSessions(sessionKey, sessions) : 0),
    [sessionKey, sessions],
  );
  const memberOptions = useMemo(
    () =>
      agents.map((agent) => ({
        id: agent.id,
        name: agent.name?.trim() || agent.id,
      })),
    [agents],
  );
  const groupOptions = useMemo(
    () =>
      [...allGroups]
        .toSorted(
          (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
        )
        .map((item) => ({
          id: item.id,
          name: item.name,
        })),
    [allGroups],
  );
  const currentDraft = runtimeRef.current?.chatMessage ?? "";
  const groupMembersForSurface = useMemo(
    () =>
      group
        ? resolveGroupMembersForSurface(group, agents).map((member) => {
            const avatarInfo = getAgentAvatarInfo(
              member.id,
              member.avatarUrl ?? member.emoji,
              member.name,
            );

            return {
              ...member,
              avatarUrl: avatarInfo.type === "image" ? avatarInfo.value : undefined,
              emoji: avatarInfo.type === "emoji" ? avatarInfo.value : member.emoji,
            };
          })
        : [],
    [agentAvatarVersion, agents, group],
  );
  const groupMemberAvatarCache = useMemo(
    () => buildGroupMemberAvatarCache(groupMessages),
    [groupMessages],
  );
  const groupMemberNames = useMemo(
    () => groupMembersForSurface.map((member) => member.name),
    [groupMembersForSurface],
  );
  const groupHeader = useMemo(
    () =>
      group
        ? {
            name: group.name,
            avatarText: assistantAvatarText,
            avatarUrl: groupAvatarUrl,
            members: groupMembersForSurface.map((member) => ({
              id: member.id,
              name: member.name,
              avatarText: resolveMemberAvatarText(member),
              avatarUrl:
                member.avatarUrl ??
                resolveGroupMemberAvatarUrl(member, groupMemberAvatarCache) ??
                undefined,
            })),
            memberCount: getGroupMemberCount(group),
          }
        : null,
    [assistantAvatarText, group, groupAvatarUrl, groupMemberAvatarCache, groupMembersForSurface],
  );
  const groupLeaderName =
    groupMembersForSurface.find((member) => member.id === group?.leaderId)?.name ??
    groupMembersForSurface[0]?.name ??
    "群主";
  const activeGroupMention = useMemo(
    () => (isGroupMode ? findActiveGroupMention(currentDraft, groupCaretPosition) : null),
    [currentDraft, groupCaretPosition, isGroupMode],
  );
  const activeGroupMentionSignature = activeGroupMention
    ? `${activeGroupMention.start}:${activeGroupMention.end}:${activeGroupMention.query}`
    : null;
  const groupMentionCandidates = useMemo(() => {
    if (!activeGroupMention) {
      return [] as AgentInfo[];
    }

    return groupMembersForSurface.filter((member) =>
      matchesGroupMentionQuery(member.name, activeGroupMention.query),
    );
  }, [activeGroupMention, groupMembersForSurface]);
  const normalizedMentionIndex =
    groupMentionCandidates.length > 0
      ? Math.min(activeMentionIndex, groupMentionCandidates.length - 1)
      : 0;
  const isGroupMentionOpen =
    isGroupMode &&
    isGroupInputFocused &&
    activeGroupMention !== null &&
    dismissedMentionSignature !== activeGroupMentionSignature;
  const groupPreviewHtml = useMemo(
    () => renderGroupMentionPreviewHtml(currentDraft, groupMemberNames),
    [currentDraft, groupMemberNames],
  );

  useEffect(() => {
    if (!group || groupMembersForSurface.length === 0) {
      return;
    }

    const hasMemberAvatar = groupMembersForSurface.some((member) =>
      Boolean(resolveGroupMemberAvatarUrl(member, groupMemberAvatarCache)),
    );
    if (hasMemberAvatar) {
      LOGGED_GROUP_MEMBER_AVATAR_FALLBACK.delete(group.id);
      return;
    }

    if (LOGGED_GROUP_MEMBER_AVATAR_FALLBACK.has(group.id)) {
      return;
    }

    // Gateway 还没把成员头像 URL 透给前端时，这里先保留首字母 fallback，等字段补齐后可直接显示真实头像。
    console.log("[xiaban] group member avatar URL not found in member data, using fallback");
    LOGGED_GROUP_MEMBER_AVATAR_FALLBACK.add(group.id);
  }, [group, groupMemberAvatarCache, groupMembersForSurface]);

  async function refreshSessions(nextSessionKey: string) {
    if (isGroupMode) {
      setSessions(groupSessions);
      if (!groupSessionKey || nextSessionKey !== groupSessionKey) {
        setSessionKey(groupSessionKey);
      }
      return;
    }

    try {
      const payload = await gateway.sendRequest<SessionsListResult>("sessions.list", {
        includeGlobal: true,
        includeUnknown: true,
        limit: 200,
      });
      // Fix: 问题6 - 恢复原版全量 sessions.list，并补齐每个员工默认 1v1 main 会话。
      const mergedSessions = mergeSessionsWithKnownAgents(payload, agents, mainKey);
      setSessions(mergedSessions);

      if (!mergedSessions?.sessions?.some((row) => row.key === nextSessionKey)) {
        setSessionKey(nextSessionKey);
      }
    } catch (error) {
      const runtime = runtimeRef.current;
      if (runtime) {
        runtime.lastError =
          error instanceof Error && error.message.trim() ? error.message.trim() : String(error);
      }
      requestRender();
    }
  }

  async function refreshModelCatalog() {
    if (isGroupMode) {
      setChatModelsLoading(true);
      setChatModelCatalog([]);
      return;
    }

    if (!connected) {
      setChatModelsLoading(false);
      setChatModelCatalog([]);
      return;
    }

    setChatModelsLoading(true);
    try {
      const groups = await gateway.listModels();
      setChatModelCatalog(flattenModelCatalog(groups));
    } catch {
      setChatModelCatalog([]);
    } finally {
      setChatModelsLoading(false);
    }
  }

  async function refreshChatHistory(nextSessionKey: string) {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }

    runtime.sessionKey = nextSessionKey;
    runtime.lastError = null;

    if (isGroupMode) {
      syncGroupRuntimeState(runtime, groupMessages, groupMembersForSurface, false, connected);
    } else {
      runtime.connected = connected;
      requestRender();
      await loadChatHistory(runtime);
      syncSidebarPreview(
        resolvePreviewAgentId(nextSessionKey, activeAgentIdRef.current),
        runtime.chatMessages,
      );
    }

    pendingContentChangeRef.current = true;
    requestRender();
  }

  async function refreshCurrentSession(nextSessionKey: string) {
    await Promise.all([refreshSessions(nextSessionKey), refreshChatHistory(nextSessionKey)]);
  }

  function handleSelectMember(nextAgentId: string) {
    const nextAgent = agents.find((agent) => agent.id === nextAgentId);
    if (!nextAgent) {
      return;
    }

    // Fix: 问题4 - 顶部成员下拉直接复用侧栏员工切换逻辑，统一到当前 1v1 会话。
    clearSelectedGroup();
    clearSelectedArchive();
    closeDetail();
    onSelectEmployee?.(buildEmployeeFromAgent(nextAgent));
    void switchAgent(nextAgent.id);
  }

  function handleSelectProjectGroup(nextGroupId: string) {
    if (!allGroups.some((item) => item.id === nextGroupId)) {
      return;
    }

    // Fix: 问题4 - 顶部项目组下拉只切项目组群聊，和左侧项目组入口保持同一套 store 状态。
    clearSelectedArchive();
    closeDetail();
    selectGroup(nextGroupId);
  }

  function handleOpenAnnouncementModal() {
    if (!group) {
      return;
    }

    // GroupChat: 问题4 - 群公告按钮直接复用旧 GroupChatArea 的弹窗与草稿保存逻辑。
    setAnnouncementDraft(group.announcement ?? "");
    setIsAnnouncementModalOpen(true);
  }

  function requestBrowserNotificationPermission() {
    if (typeof window === "undefined" || typeof Notification === "undefined") {
      return;
    }

    if (Notification.permission !== "default") {
      return;
    }

    void Notification.requestPermission().catch(() => undefined);
  }

  function handleToggleNotifications() {
    if (!group) {
      return;
    }

    const nextEnabled = group.notificationsEnabled === false;
    setGroupNotificationsEnabled(group.id, nextEnabled);
    if (nextEnabled) {
      requestBrowserNotificationPermission();
    }
  }

  function handleToggleSound() {
    if (!group) {
      return;
    }

    const nextEnabled = group.soundEnabled === false;
    setGroupSoundEnabled(group.id, nextEnabled);
  }

  function handleSaveAnnouncement() {
    if (!group) {
      return;
    }

    updateGroupAnnouncement(group.id, announcementDraft);
    setIsAnnouncementModalOpen(false);
  }

  function handleOpenUrgeModal() {
    if (!group) {
      return;
    }

    // GroupChat: 问题4 - 督促模式按钮复用旧 GroupChatArea 的开启/暂停/恢复/关闭流程。
    setUrgeIntervalDraft(group.urgeIntervalMinutes ?? 10);
    setIsUrgeModalOpen(true);
  }

  function handleOpenEditGroupModal() {
    if (!group) {
      return;
    }

    setIsEditGroupModalOpen(true);
  }

  function handleOpenMemberManageModal() {
    if (!group) {
      return;
    }

    setIsMemberManageModalOpen(true);
  }

  function openQuickActionConfirm(action: QuickActionKind) {
    if (action === "compact" && isGroupMode) {
      return;
    }

    setPendingQuickAction(action);
  }

  function closeQuickActionConfirm() {
    if (isQuickActionLoading) {
      return;
    }

    setPendingQuickAction(null);
  }

  function handleOpenResetConversationConfirm() {
    openQuickActionConfirm("reset");
  }

  function handleOpenArchiveConversationConfirm() {
    openQuickActionConfirm("archive");
  }

  async function handleConfirmQuickAction() {
    if (!pendingQuickAction) {
      return;
    }

    const action = pendingQuickAction;
    const runtime = runtimeRef.current;
    setIsQuickActionLoading(true);

    try {
      if (runtime) {
        runtime.lastError = null;
      }

      if (action === "compact") {
        if (isGroupMode || !sessionKey) {
          return;
        }

        const result = await compactCurrentSession();
        if (!result.success) {
          throw new Error(result.error || "压缩 1v1 对话失败");
        }

        await refreshCurrentSession(sessionKey);
        toast({
          title: "已压缩当前 1v1 对话",
          description:
            typeof result.releasedTokens === "number" && result.releasedTokens > 0
              ? `约释放了 ${result.releasedTokens} 个 Token 上下文。`
              : "已精简历史上下文，后续对话会更轻量。",
        });
      } else if (action === "archive") {
        if (isGroupMode) {
          if (!group) {
            return;
          }

          const result = await archiveGroupSession(group.id);
          if (!result.success) {
            throw new Error(result.error || "归档项目组对话失败");
          }

          toast({
            title: "已归档当前项目组对话",
            description: "可在左侧项目组归档中随时回看。",
          });
        } else {
          if (!sessionKey) {
            return;
          }

          const result = await archiveCurrentSession();
          if (!result.success) {
            throw new Error(result.error || "归档 1v1 会话失败");
          }

          await refreshCurrentSession(sessionKey);
          toast({
            title: "已归档当前 1v1 会话",
            description: "可在左侧“1v1 归档”中随时回看。",
          });
        }
      } else if (isGroupMode) {
        if (!group) {
          return;
        }

        const result = await resetGroupMessages(group.id);
        if (!result.success) {
          throw new Error(result.error || "重置项目组对话失败");
        }

        toast({
          title: "已重置当前项目组对话",
          description: "当前消息已清空，全部成员会话上下文已重新开始。",
        });
      } else {
        if (!sessionKey) {
          return;
        }

        const result = await resetCurrentSession();
        if (!result.success) {
          throw new Error(result.error || "重置 1v1 对话失败");
        }

        await refreshCurrentSession(sessionKey);
        toast({
          title: "已重置当前 1v1 对话",
          description: "当前消息已清空，后续将从新的上下文继续。",
        });
      }

      setPendingQuickAction(null);
      pendingContentChangeRef.current = true;
      requestRender();
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : action === "compact"
            ? "压缩会话失败"
            : action === "archive"
              ? "归档会话失败"
              : "重置会话失败";

      if (runtime) {
        runtime.lastError = message;
      }

      toast({
        title: action === "compact" ? "压缩失败" : action === "archive" ? "归档失败" : "重置失败",
        description: message,
        variant: "destructive",
      });
      requestRender();
    } finally {
      setIsQuickActionLoading(false);
    }
  }

  function handleInsertMention(memberId: string) {
    if (!group || !runtimeRef.current) {
      return;
    }

    const member =
      groupMentionCandidates.find((item) => item.id === memberId) ??
      groupMembersForSurface.find((item) => item.id === memberId);
    if (!member) {
      return;
    }

    const fallbackCaret = groupCaretPosition;
    const nextMention = insertGroupMention(
      runtimeRef.current.chatMessage,
      member.name,
      activeGroupMention,
      fallbackCaret,
    );

    // GroupChat: 问题5 - 继续复用旧 @ 插入逻辑，把成员名写回统一聊天输入框，并保持光标位置。
    runtimeRef.current.chatMessage = nextMention.value;
    pendingMentionSelectionRef.current = nextMention.caret;
    setGroupCaretPosition(nextMention.caret);
    setDismissedMentionSignature(null);
    setActiveMentionIndex(0);
    requestRender();
  }

  async function updateSessionModel(nextModel: string) {
    if (isGroupMode) {
      return;
    }

    const currentSessionKey = sessionKeyRef.current;
    if (!currentSessionKey || !connected) {
      return;
    }

    const runtime = runtimeRef.current;
    const previousOverride = chatModelOverrides[currentSessionKey];
    const currentValue = resolveCurrentChatModelValue(
      currentSessionKey,
      sessions,
      chatModelOverrides,
    );
    if (currentValue === nextModel) {
      return;
    }

    if (runtime) {
      runtime.lastError = null;
    }

    setChatModelOverrides((current) =>
      withChatModelOverride(current, currentSessionKey, nextModel || null),
    );

    try {
      await gateway.sendRequest("sessions.patch", {
        key: currentSessionKey,
        model: nextModel || null,
      });
      await refreshSessions(currentSessionKey);
    } catch (error) {
      setChatModelOverrides((current) =>
        withChatModelOverride(current, currentSessionKey, previousOverride),
      );
      if (runtime) {
        runtime.lastError = `Failed to set model: ${String(error)}`;
      }
      requestRender();
    }
  }

  async function startNewDirectSession(runtime: ChatRuntimeState, currentSessionKey: string) {
    const pendingNewSession: PendingNewSessionState = {
      sessionKey: currentSessionKey,
    };

    clearPendingNewSession();
    pendingNewSessionRef.current = pendingNewSession;
    runtime.lastError = null;
    runtime.chatLoading = false;
    runtime.newSessionLoading = true;
    runtime.chatThinkingLevel = null;
    runtime.chatSending = false;
    runtime.chatMessages = [];
    runtime.chatStream = null;
    runtime.chatRunId = null;
    runtime.chatStreamStartedAt = null;
    runtime.chatToolMessages = [];
    runtime.chatStreamSegments = [];
    runtime.toolStreamById.clear();
    runtime.toolStreamOrder = [];
    pendingContentChangeRef.current = true;
    requestRender();

    try {
      const result = await gateway.sendChat("/new", currentSessionKey);
      if (!result.ok) {
        throw new Error(result.error?.message || "新建会话失败");
      }
    } catch (error) {
      runtime.lastError =
        error instanceof Error && error.message.trim() ? error.message.trim() : "新建会话失败";
      runtime.newSessionLoading = false;
    } finally {
      runtime.chatLoading = false;
      await refreshSessions(currentSessionKey);
      if (
        pendingNewSessionRef.current === pendingNewSession &&
        (hasRenderableAssistantStream(runtime) || hasRenderableAssistantText(runtime.chatMessages))
      ) {
        pendingNewSessionRef.current = null;
        runtime.newSessionLoading = false;
      }
      pendingContentChangeRef.current = true;
      requestRender();
      await processQueuedMessages();
    }
  }

  async function processQueuedMessages() {
    if (processingQueueRef.current) {
      return;
    }

    const runtime = runtimeRef.current;
    if (!runtime || runtime.chatSending || runtime.newSessionLoading || isChatBusy(runtime)) {
      return;
    }

    const nextItem = queueRef.current[0];
    if (!nextItem) {
      return;
    }

    processingQueueRef.current = true;
    queueRef.current = queueRef.current.slice(1);
    setQueue(queueRef.current);

    const nextText = nextItem.localCommandName ?? nextItem.text;
    try {
      if (isGroupMode) {
        if (!group) {
          return;
        }

        if ((nextItem.attachments?.length ?? 0) > 0) {
          runtime.chatSending = false;
          runtime.chatRunId = null;
          runtime.lastError = "项目组聊天暂不支持附件发送";
        } else if (nextText === "/new") {
          await resetGroupMessages(group.id);
        } else {
          runtime.chatSending = true;
          runtime.chatRunId = `group:${Date.now()}`;
          runtime.lastError = null;
          await sendGroupMessage(group.id, nextText);
        }
      } else {
        if (nextText === "/new") {
          await startNewDirectSession(runtime, runtime.sessionKey);
        } else {
          await sendChatMessage(runtime, nextText, nextItem.attachments);
        }
        syncSidebarPreview(
          resolvePreviewAgentId(runtime.sessionKey, activeAgentIdRef.current),
          runtime.chatMessages,
        );
      }
    } finally {
      pendingContentChangeRef.current = true;
      processingQueueRef.current = false;
      requestRender();
    }
  }

  useEffect(() => {
    activeAgentIdRef.current = activeAgentId;
  }, [activeAgentId]);

  useEffect(() => subscribeToUserProfile(setUserProfile), []);

  useEffect(() => {
    const handleAvatarRefresh = () => {
      setAgentAvatarVersion((current) => current + 1);
    };

    window.addEventListener("xiaban-agent-avatar-updated", handleAvatarRefresh);
    window.addEventListener("storage", handleAvatarRefresh);
    return () => {
      window.removeEventListener("xiaban-agent-avatar-updated", handleAvatarRefresh);
      window.removeEventListener("storage", handleAvatarRefresh);
    };
  }, []);

  useEffect(() => {
    if (!group) {
      setIsAnnouncementModalOpen(false);
      setIsUrgeModalOpen(false);
      setAnnouncementDraft("");
      setGroupCaretPosition(0);
      setIsGroupInputFocused(false);
      setActiveMentionIndex(0);
      setDismissedMentionSignature(null);
      pendingMentionSelectionRef.current = null;
      return;
    }

    setUrgeIntervalDraft(group.urgeIntervalMinutes ?? 10);
  }, [group]);

  useEffect(() => {
    if (!group?.id) {
      return;
    }

    setGroupCaretPosition(0);
    setIsGroupInputFocused(false);
    setActiveMentionIndex(0);
    setDismissedMentionSignature(null);
    pendingMentionSelectionRef.current = null;
  }, [group?.id]);

  useEffect(() => {
    if (!isGroupMode || groupMentionCandidates.length > 0) {
      return;
    }

    setActiveMentionIndex(0);
  }, [groupMentionCandidates.length, isGroupMode]);

  useEffect(() => {
    if (!defaultSessionKey) {
      return;
    }

    sessionKeyRef.current = defaultSessionKey;
    setSessionKey(defaultSessionKey);
  }, [defaultSessionKey]);

  useEffect(() => {
    if (!sessionKey) {
      return;
    }

    clearPendingNewSession();
    clearRuntimeTimers(runtimeRef.current);
    cleanupChatModuleState();

    const runtime = createChatRuntime(sessionKey, connected);
    runtimeRef.current = runtime;
    sessionKeyRef.current = sessionKey;
    queueRef.current = [];
    setQueue([]);
    setSidebarOpen(false);
    setSidebarContent(null);
    setSidebarError(null);
    setShowNewMessages(false);
    pendingContentChangeRef.current = true;
    requestRender();

    if (isGroupMode || connected) {
      void refreshCurrentSession(sessionKey);
    }

    return () => {
      clearRuntimeTimers(runtime);
      clearPendingNewSession();
    };
  }, [connected, isGroupMode, sessionKey]);

  useEffect(() => {
    if (!sessionKey) {
      return;
    }

    if (isGroupMode) {
      setSessions(groupSessions);
      return;
    }

    if (!connected) {
      return;
    }

    void refreshSessions(sessionKey);
  }, [activeAgentId, agents, connected, groupSessions, isGroupMode, mainKey, sessionKey]);

  useEffect(() => {
    if (isGroupMode) {
      setSessions(groupSessions);
      return;
    }

    setSessions((current) => mergeSessionsWithKnownAgents(current, agents, mainKey));
  }, [agents, groupSessions, isGroupMode, mainKey]);

  useEffect(() => {
    void refreshModelCatalog();
  }, [connected, isGroupMode]);

  useEffect(() => {
    if (!isGroupMode) {
      return;
    }

    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }

    syncGroupRuntimeState(
      runtime,
      groupMessages,
      groupMembersForSurface,
      isGroupSending,
      connected,
    );
    pendingContentChangeRef.current = true;
    requestRender();

    if (!isGroupSending) {
      void processQueuedMessages();
    }
  }, [connected, groupMembersForSurface, groupMessages, isGroupMode, isGroupSending]);

  useEffect(() => {
    if (isGroupMode) {
      return;
    }

    const unsubscribe = gateway.addEventHandler((eventName, payload) => {
      const runtime = runtimeRef.current;
      const currentSessionKey = sessionKeyRef.current;
      if (!runtime || !currentSessionKey) {
        return;
      }

      let shouldRender = false;

      if (eventName === "chat") {
        const chatPayload = payload as GatewayChatEventPayload;
        const resolvedSessionKey = chatPayload.sessionKey ?? currentSessionKey;
        const chatState = chatPayload.state ?? "error";
        const pendingNewSession = pendingNewSessionRef.current;
        const shouldReloadFinalHistory =
          resolvedSessionKey === currentSessionKey && chatState === "final" && !chatPayload.message;
        handleChatEvent(runtime, {
          runId: chatPayload.runId ?? runtime.chatRunId ?? "",
          sessionKey: resolvedSessionKey,
          state: chatState,
          message: chatPayload.message,
          errorMessage: chatPayload.errorMessage,
        });
        syncSidebarPreview(
          resolvePreviewAgentId(resolvedSessionKey, activeAgentIdRef.current),
          runtime.chatMessages,
        );
        if (
          pendingNewSession?.sessionKey === resolvedSessionKey &&
          (hasRenderableAssistantStream(runtime) ||
            hasRenderableAssistantText(runtime.chatMessages))
        ) {
          runtime.newSessionLoading = false;
          clearPendingNewSession();
          void processQueuedMessages();
        }
        if (
          pendingNewSession?.sessionKey === resolvedSessionKey &&
          (chatState === "error" || chatState === "aborted")
        ) {
          runtime.newSessionLoading = false;
          clearPendingNewSession();
          void processQueuedMessages();
        }
        pendingContentChangeRef.current = true;
        shouldRender = true;

        if (shouldReloadFinalHistory) {
          // Fix: 问题11 - 某些 final 事件不带 message，主动回拉历史，避免转圈结束后没有回复。
          void loadChatHistory(runtime).then(() => {
            syncSidebarPreview(
              resolvePreviewAgentId(runtime.sessionKey, activeAgentIdRef.current),
              runtime.chatMessages,
            );
            pendingContentChangeRef.current = true;
            requestRender();
          });
        }

        if (chatState === "final" || chatState === "aborted" || chatState === "error") {
          void refreshSessions(currentSessionKey);
          void processQueuedMessages();
        }
      }

      if (eventName === "agent") {
        handleAgentEvent(runtime, payload as Parameters<typeof handleAgentEvent>[1]);
        pendingContentChangeRef.current = true;
        shouldRender = true;
      }

      if (shouldRender) {
        requestRender();
      }
    });

    return unsubscribe;
  }, [isGroupMode]);

  function handleToggleFocusMode() {
    const nextFocusMode = !isChatFullscreen;
    if (nextFocusMode) {
      // Fix: 问题5 - 进入全屏时同步收起右侧 Markdown 侧栏，避免左栏隐藏后仍保留空白分栏。
      setSidebarOpen(false);
      setSidebarContent(null);
      setSidebarError(null);
      setShowNewMessages(false);
    }
    onChatFullscreenChange(nextFocusMode);
  }

  useEffect(() => {
    const host = hostRef.current;
    const runtime = runtimeRef.current;
    if (!host || !runtime || !sessionKey) {
      return;
    }

    renderLit(
      renderOriginalChatShell({
        activeAgentId: displayedAgentId,
        assistantName,
        headerTitle: isGroupMode ? (group?.name ?? assistantName) : employee.name,
        isGroupMode,
        groupHeader,
        hasAnnouncement: Boolean(group?.announcement?.trim().length),
        isUrging: group?.isUrging === true,
        isUrgePaused: group?.isUrgePaused === true,
        connected,
        loading: runtime.chatLoading,
        sending: runtime.chatSending,
        busy: isChatBusy(runtime),
        themeMode: theme,
        error: runtime.lastError,
        showThinking,
        focusMode: isChatFullscreen,
        hideCronSessions,
        hiddenCronCount,
        sessions,
        sessionKey,
        modelValue: currentModelValue,
        defaultModelValue,
        modelOptions: chatModelOptions,
        modelsLoading: chatModelsLoading,
        members: memberOptions,
        groups: groupOptions,
        currentGroupId: group?.id ?? null,
        onToggleSearch: () => {
          // Fix: 问题1 - 点击顶部搜索后自动展开并聚焦搜索栏，恢复原版交互反馈。
          const isSearchOpen = toggleChatSearch();
          requestRender();
          if (isSearchOpen) {
            window.requestAnimationFrame(() => {
              hostRef.current
                ?.querySelector<HTMLInputElement>('[data-chat-search-input="true"]')
                ?.focus();
            });
          }
        },
        onThemeModeChange: (mode) => {
          setTheme(mode);
        },
        agentNamesById,
        onMemberSelect: (nextAgentId) => {
          handleSelectMember(nextAgentId);
        },
        onGroupSelect: (nextGroupId) => {
          handleSelectProjectGroup(nextGroupId);
        },
        onSessionSelect: (nextSessionKey) => {
          if (nextSessionKey !== sessionKey) {
            setSessionKey(nextSessionKey);
          }
        },
        onModelSelect: (nextModel) => {
          void updateSessionModel(nextModel);
        },
        onAnnouncementClick: () => {
          handleOpenAnnouncementModal();
        },
        onUrgeClick: () => {
          handleOpenUrgeModal();
        },
        notificationsEnabled: group?.notificationsEnabled !== false,
        soundEnabled: group?.soundEnabled !== false,
        onToggleNotifications: () => {
          handleToggleNotifications();
        },
        onToggleSound: () => {
          handleToggleSound();
        },
        onEditGroupClick: () => {
          handleOpenEditGroupModal();
        },
        onManageMembersClick: () => {
          handleOpenMemberManageModal();
        },
        onArchiveConversationClick: () => {
          handleOpenArchiveConversationConfirm();
        },
        onResetConversationClick: () => {
          handleOpenResetConversationConfirm();
        },
        onRefresh: () => {
          void refreshCurrentSession(sessionKey);
        },
        onToggleThinking: () => {
          setShowThinking((current) => !current);
        },
        onToggleFocusMode: () => {
          handleToggleFocusMode();
        },
        onToggleHideCronSessions: () => {
          setHideCronSessions((current) => !current);
        },
        body: renderChat({
          sessionKey,
          conversationMode: isGroupMode ? "group" : "direct",
          onSessionKeyChange: (nextSessionKey) => {
            if (nextSessionKey !== sessionKey) {
              setSessionKey(nextSessionKey);
            }
          },
          thinkingLevel: runtime.chatThinkingLevel,
          showThinking,
          loading: runtime.chatLoading,
          newSessionLoading: runtime.newSessionLoading,
          sending: runtime.chatSending,
          canAbort: isGroupMode ? false : Boolean(runtime.chatRunId),
          compactionStatus: runtime.compactionStatus as CompactionIndicatorStatus | null,
          fallbackStatus: runtime.fallbackStatus as FallbackIndicatorStatus | null,
          messages: runtime.chatMessages,
          toolMessages: runtime.chatToolMessages,
          streamSegments: runtime.chatStreamSegments,
          stream: runtime.chatStream,
          streamStartedAt: runtime.chatStreamStartedAt,
          assistantAvatarUrl,
          assistantAvatarText,
          assistantAvatarColor,
          userAvatar: userProfile.avatar,
          userName: userProfile.name,
          draft: runtime.chatMessage,
          inputPlaceholder: isGroupMode ? "输入消息，按 @ 提及成员" : undefined,
          messageTextDecorator:
            isGroupMode && groupMemberNames.length > 0
              ? (renderedHtml) => decorateGroupHtmlMentions(renderedHtml, groupMemberNames)
              : undefined,
          queue,
          connected,
          canSend: connected,
          disabledReason: connected ? null : "连接 Gateway 后即可开始聊天…",
          error: runtime.lastError,
          sessions,
          focusMode: isChatFullscreen,
          sidebarOpen,
          sidebarContent,
          sidebarError,
          splitRatio,
          assistantName,
          assistantAvatar,
          attachments: runtime.chatAttachments,
          hideAttachmentButton: false,
          groupCompose: isGroupMode
            ? {
                previewHtml: groupPreviewHtml,
                mentionQuery: activeGroupMention?.query ?? "",
                mentionOpen: isGroupMentionOpen,
                mentionActiveIndex: normalizedMentionIndex,
                mentionMembers: groupMentionCandidates.map((member) => ({
                  id: member.id,
                  name: member.name,
                  avatarText: resolveMemberAvatarText(member),
                  avatarUrl:
                    member.avatarUrl ??
                    resolveGroupMemberAvatarUrl(member, groupMemberAvatarCache) ??
                    undefined,
                  avatarColor: resolveChatAvatarColor(member.id || member.name),
                  role: member.role,
                })),
                quickMentionMembers: groupMembersForSurface.map((member) => ({
                  id: member.id,
                  name: member.name,
                })),
                onMentionSelect: (memberId) => {
                  handleInsertMention(memberId);
                },
                onMentionNavigate: (direction) => {
                  if (groupMentionCandidates.length === 0) {
                    return;
                  }

                  setActiveMentionIndex((current) => {
                    if (direction === "next") {
                      return (current + 1) % groupMentionCandidates.length;
                    }

                    return current <= 0 ? groupMentionCandidates.length - 1 : current - 1;
                  });
                },
                onMentionActiveIndexChange: (index) => {
                  setActiveMentionIndex(index);
                },
                onMentionDismiss: () => {
                  if (!activeGroupMentionSignature) {
                    return;
                  }

                  setDismissedMentionSignature(activeGroupMentionSignature);
                  setActiveMentionIndex(0);
                },
              }
            : undefined,
          onAttachmentsChange: (attachments) => {
            runtime.chatAttachments = attachments;
            requestRender();
          },
          showNewMessages,
          onScrollToBottom: () => {
            const thread = host.querySelector<HTMLElement>(".chat-thread");
            if (!thread) {
              return;
            }
            thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
            stickToBottomRef.current = true;
            setShowNewMessages(false);
          },
          onRefresh: () => {
            void refreshCurrentSession(sessionKey);
          },
          onToggleFocusMode: () => {
            handleToggleFocusMode();
          },
          getDraft: () => runtime.chatMessage,
          onDraftChange: (next, selectionStart) => {
            runtime.chatMessage = next;
            if (isGroupMode) {
              setGroupCaretPosition(selectionStart ?? next.length);
              setDismissedMentionSignature(null);
            }
            requestRender();
          },
          onDraftSelectionChange: (selectionStart) => {
            if (!isGroupMode) {
              return;
            }

            setGroupCaretPosition(selectionStart);
          },
          onDraftFocusChange: (focused) => {
            if (!isGroupMode) {
              return;
            }

            setIsGroupInputFocused(focused);
          },
          onRequestUpdate: requestRender,
          onSend: () => {
            const draft = runtime.chatMessage;
            const attachments = [...runtime.chatAttachments];

            if (runtime.newSessionLoading || isChatBusy(runtime)) {
              queueRef.current = [...queueRef.current, createQueuedItem(draft, attachments)];
              setQueue(queueRef.current);
              runtime.chatMessage = "";
              runtime.chatAttachments = [];
              if (isGroupMode) {
                setGroupCaretPosition(0);
                setActiveMentionIndex(0);
                setDismissedMentionSignature(null);
              }
              requestRender();
              return;
            }

            runtime.chatMessage = "";
            runtime.chatAttachments = [];
            if (isGroupMode) {
              setGroupCaretPosition(0);
              setActiveMentionIndex(0);
              setDismissedMentionSignature(null);
              pendingMentionSelectionRef.current = 0;
            }
            pendingContentChangeRef.current = true;
            requestRender();
            if (isGroupMode) {
              if (!group) {
                runtime.lastError = "当前项目组不存在";
                runtime.chatSending = false;
                runtime.chatRunId = null;
                requestRender();
                return;
              }

              runtime.lastError = null;
              runtime.chatSending = true;
              runtime.chatRunId = `group:${Date.now()}`;
              void sendGroupMessage(group.id, draft, attachments)
                .catch((error) => {
                  runtime.lastError =
                    error instanceof Error && error.message.trim()
                      ? error.message.trim()
                      : "项目组消息发送失败";
                  runtime.chatSending = false;
                  runtime.chatRunId = null;
                  requestRender();
                })
                .finally(() => {
                  void processQueuedMessages();
                });
              return;
            }

            void sendChatMessage(runtime, draft, attachments).then(() => {
              syncSidebarPreview(
                resolvePreviewAgentId(runtime.sessionKey, activeAgentIdRef.current),
                runtime.chatMessages,
              );
              requestRender();
            });
          },
          onAbort: () => {
            if (isGroupMode) {
              return;
            }

            void abortChatRun(runtime).then(() => {
              requestRender();
            });
          },
          onQueueRemove: (id) => {
            queueRef.current = queueRef.current.filter((item) => item.id !== id);
            setQueue(queueRef.current);
          },
          onCompactSession: () => {
            openQuickActionConfirm("compact");
          },
          onArchiveSession: () => {
            openQuickActionConfirm("archive");
          },
          onResetSession: () => {
            openQuickActionConfirm("reset");
          },
          quickActionDisabled: isQuickActionLoading,
          onNewSession: () => {
            if (runtime.newSessionLoading || isChatBusy(runtime)) {
              queueRef.current = [...queueRef.current, createQueuedItem("/new", [], "/new")];
              setQueue(queueRef.current);
              requestRender();
              return;
            }

            pendingContentChangeRef.current = true;
            if (isGroupMode) {
              if (!group) {
                runtime.lastError = "当前项目组不存在";
                requestRender();
                return;
              }

              runtime.chatSending = true;
              runtime.chatRunId = `group:new:${Date.now()}`;
              void resetGroupMessages(group.id)
                .catch((error) => {
                  runtime.lastError =
                    error instanceof Error && error.message.trim()
                      ? error.message.trim()
                      : "重置项目组会话失败";
                  runtime.chatSending = false;
                  runtime.chatRunId = null;
                  requestRender();
                })
                .finally(() => {
                  void processQueuedMessages();
                });
              return;
            }

            void startNewDirectSession(runtime, sessionKey).then(() => {
              syncSidebarPreview(
                resolvePreviewAgentId(runtime.sessionKey, activeAgentIdRef.current),
                runtime.chatMessages,
              );
              requestRender();
            });
          },
          onClearHistory: async () => {
            if (isGroupMode) {
              if (!group) {
                throw new Error("当前项目组不存在");
              }

              const result = await resetGroupMessages(group.id);
              if (!result.success) {
                throw new Error(result.error || "重置项目组会话失败");
              }
              return;
            }

            await gateway.resetSession(sessionKey);
            await refreshCurrentSession(sessionKey);
          },
          agentsList: {
            agents: agents.map((agent) => {
              const avatarInfo = getAgentAvatarInfo(
                agent.id,
                agent.avatarUrl ?? agent.emoji,
                agent.name,
              );
              return {
                id: agent.id,
                name: agent.name,
                identity: {
                  name: agent.name,
                  avatarUrl: avatarInfo.type === "image" ? avatarInfo.value : undefined,
                },
              };
            }),
            defaultId: displayedAgentId,
          },
          currentAgentId: displayedAgentId,
          onAgentChange: () => undefined,
          onSessionSelect: (nextSessionKey) => {
            if (nextSessionKey !== sessionKey) {
              setSessionKey(nextSessionKey);
            }
          },
          onOpenSidebar: (content) => {
            setSidebarOpen(true);
            setSidebarContent(content);
            setSidebarError(null);
          },
          onCloseSidebar: () => {
            setSidebarOpen(false);
          },
          onSplitRatioChange: (ratio) => {
            setSplitRatio(ratio);
          },
          onChatScroll: (event) => {
            const thread = event.currentTarget as HTMLElement;
            const distanceToBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
            const nearBottom = distanceToBottom < 48;
            stickToBottomRef.current = nearBottom;

            if (nearBottom) {
              setShowNewMessages(false);
            }
          },
          basePath: "",
        }),
      }),
      host,
    );

    if (!pendingContentChangeRef.current) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const thread = host.querySelector<HTMLElement>(".chat-thread");
      if (!thread) {
        return;
      }

      if (stickToBottomRef.current) {
        thread.scrollTo({ top: thread.scrollHeight, behavior: "auto" });
        setShowNewMessages(false);
      } else {
        setShowNewMessages(true);
      }

      pendingContentChangeRef.current = false;
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    activeAgentId,
    assistantAvatarColor,
    assistantAvatarText,
    assistantAvatarUrl,
    assistantName,
    agentNamesById,
    agents,
    connected,
    displayedAgentId,
    employee.name,
    currentModelValue,
    defaultModelValue,
    chatModelOptions,
    chatModelsLoading,
    activeGroupMentionSignature,
    groupHeader,
    group?.id,
    group?.announcement,
    group?.isUrgePaused,
    group?.isUrging,
    group?.name,
    groupLeaderName,
    groupMentionCandidates,
    groupMembersForSurface,
    groupOptions,
    groupPreviewHtml,
    hiddenCronCount,
    hideCronSessions,
    isGroupMentionOpen,
    isQuickActionLoading,
    memberOptions,
    normalizedMentionIndex,
    queue,
    renderNonce,
    sessionKey,
    sessions,
    showNewMessages,
    showThinking,
    sidebarContent,
    sidebarError,
    sidebarOpen,
    splitRatio,
    theme,
    isChatFullscreen,
    userProfile.avatar,
    userProfile.name,
  ]);

  useEffect(() => {
    if (!isGroupMode) {
      return;
    }

    const caret = pendingMentionSelectionRef.current;
    if (caret === null) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const textarea = hostRef.current?.querySelector<HTMLTextAreaElement>(".agent-chat__textarea");
      if (!textarea) {
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(caret, caret);
      pendingMentionSelectionRef.current = null;
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isGroupMode, renderNonce, sessionKey]);

  useEffect(() => {
    return () => {
      clearRuntimeTimers(runtimeRef.current);
      clearPendingNewSession();
      cleanupChatModuleState();
      if (hostRef.current) {
        renderLit(html``, hostRef.current);
      }
    };
  }, []);

  const quickActionModalConfig = useMemo(() => {
    if (!pendingQuickAction) {
      return null;
    }

    if (pendingQuickAction === "compact") {
      return {
        icon: "🗜️",
        iconBgColor: "bg-[var(--color-bg-brand-soft)]",
        iconTextColor: "text-[var(--color-brand)]",
        title: "压缩上下文",
        subtitle: "精简对话历史",
        description:
          "AI 会总结当前对话的核心内容，压缩冗余信息，保留关键上下文，让后续对话更高效。",
        confirmText: "开始压缩",
        confirmColor: "bg-[var(--color-brand)] hover:brightness-110",
      };
    }

    if (pendingQuickAction === "archive") {
      return group
        ? {
            icon: "🗂️",
            iconBgColor: "bg-[var(--color-bg-brand-soft)]",
            iconTextColor: "text-[var(--color-brand)]",
            title: "归档项目组对话",
            subtitle: "保存历史，释放空间",
            description:
              "当前项目组对话会被归档保存，方便之后回看，同时释放上下文空间，降低后续对话成本。",
            confirmText: "确认归档",
            confirmColor: "bg-[var(--color-brand)] hover:brightness-110",
          }
        : {
            icon: "🗄️",
            iconBgColor: "bg-[var(--color-bg-brand-soft)]",
            iconTextColor: "text-[var(--color-brand)]",
            title: "归档 1v1 对话",
            subtitle: "保存历史，释放空间",
            description:
              "当前 1v1 对话会被归档保存，方便之后回看，同时释放上下文空间，降低后续对话成本。",
            confirmText: "确认归档",
            confirmColor: "bg-[var(--color-brand)] hover:brightness-110",
          };
    }

    return group
      ? {
          icon: "🔄",
          iconBgColor: "bg-[var(--danger-subtle)]",
          iconTextColor: "text-[var(--danger)]",
          title: "重置项目组对话",
          subtitle: "清空消息，释放上下文",
          description:
            "将清空当前项目组的所有消息，并重置全部成员的上下文记忆。这样能释放 Token 空间，但 AI 不会再记得之前的内容。",
          confirmText: "确认重置",
          confirmColor: "bg-[var(--danger)] hover:brightness-110",
        }
      : {
          icon: "🔄",
          iconBgColor: "bg-[var(--danger-subtle)]",
          iconTextColor: "text-[var(--danger)]",
          title: "重置 1v1 对话",
          subtitle: "清空消息，释放上下文",
          description:
            "将清空当前 1v1 对话的所有消息，并重置 AI 的上下文记忆。这样能释放 Token 空间，但 AI 不会再记得之前的内容。",
          confirmText: "确认重置",
          confirmColor: "bg-[var(--danger)] hover:brightness-110",
        };
  }, [group, pendingQuickAction]);

  if (!sessionKey) {
    return (
      <div className="openclaw-chat-shell openclaw-chat-shell--loading">
        <div className="content content--chat openclaw-chat-shell__content">
          <section className="card chat">
            <div className="agent-chat__empty">正在加载会话...</div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <>
      <div ref={hostRef} className="openclaw-chat-host h-full min-h-0" />

      {group ? (
        <>
          <GroupAnnouncementModal
            open={isAnnouncementModalOpen}
            groupName={group.name}
            value={announcementDraft}
            onChange={setAnnouncementDraft}
            onClose={() => {
              setIsAnnouncementModalOpen(false);
            }}
            onSave={handleSaveAnnouncement}
          />
          <EditGroupModal
            key={`edit-${group.id}-${isEditGroupModalOpen ? "open" : "closed"}`}
            open={isEditGroupModalOpen}
            group={group}
            onClose={() => {
              setIsEditGroupModalOpen(false);
            }}
          />
          <GroupMemberManageModal
            key={`members-${group.id}-${isMemberManageModalOpen ? "open" : "closed"}`}
            open={isMemberManageModalOpen}
            group={group}
            onClose={() => {
              setIsMemberManageModalOpen(false);
            }}
          />
          <GroupUrgeModal
            open={isUrgeModalOpen}
            groupName={group.name}
            leaderName={groupLeaderName}
            isUrging={group.isUrging === true}
            isPaused={group.isUrgePaused === true}
            intervalMinutes={group.urgeIntervalMinutes ?? 10}
            urgeCount={group.urgeCount ?? 0}
            selectedInterval={urgeIntervalDraft}
            onSelectInterval={setUrgeIntervalDraft}
            onClose={() => {
              setIsUrgeModalOpen(false);
            }}
            onStart={() => {
              // GroupChat: 问题4 - 督促模式弹窗动作直接复用旧 store 行为。
              startGroupUrging(group.id, urgeIntervalDraft);
              setIsUrgeModalOpen(false);
            }}
            onPause={() => {
              pauseGroupUrging(group.id);
            }}
            onResume={() => {
              resumeGroupUrging(group.id);
            }}
            onStop={() => {
              stopGroupUrging(group.id);
              setIsUrgeModalOpen(false);
            }}
          />
        </>
      ) : null}

      {quickActionModalConfig ? (
        <ConfirmModal
          open={Boolean(pendingQuickAction)}
          onClose={closeQuickActionConfirm}
          onConfirm={() => {
            void handleConfirmQuickAction();
          }}
          loading={isQuickActionLoading}
          icon={quickActionModalConfig.icon}
          iconBgColor={quickActionModalConfig.iconBgColor}
          iconTextColor={quickActionModalConfig.iconTextColor}
          title={quickActionModalConfig.title}
          subtitle={quickActionModalConfig.subtitle}
          description={quickActionModalConfig.description}
          confirmText={quickActionModalConfig.confirmText}
          confirmColor={quickActionModalConfig.confirmColor}
        />
      ) : null}
    </>
  );
}

export const OpenClawChatSurface = memo(OpenClawChatSurfaceInner);
OpenClawChatSurface.displayName = "OpenClawChatSurface";
