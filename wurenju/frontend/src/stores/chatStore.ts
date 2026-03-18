import { create } from "zustand";
import { gateway, type GatewayMessage, type GatewayMessageMeta } from "@/services/gateway";
import { useAgentStore } from "@/stores/agentStore";
import { useDirectArchiveStore } from "@/stores/directArchiveStore";
import { useGroupStore } from "@/stores/groupStore";
import {
  adaptHistoryMessages,
  adaptRealtimeMessage,
  type ChatMessage,
  type ChatUsage,
} from "@/utils/messageAdapter";
import type { SessionRuntimeState } from "@/utils/sessionRuntime";
import {
  clearSidebarDirectUnreadCount,
  incrementSidebarDirectUnreadCount,
  readSidebarDirectArchives,
  writeSidebarDirectArchives,
  type SidebarDirectArchive,
} from "@/utils/sidebarPersistence";
import { deriveCurrentContextUsed } from "@/utils/usage";

type MessageBuckets = Map<string, ChatMessage[]>;
type BooleanBuckets = Map<string, boolean>;
type UsageBuckets = Map<string, ChatUsage>;
type NumberBuckets = Map<string, number>;
type SessionActionResult = { success: boolean; error?: string; releasedTokens?: number };

interface ChatState {
  messagesByAgentId: MessageBuckets;
  usageByAgentId: UsageBuckets;
  contextWindowSizeByAgentId: NumberBuckets;
  currentContextUsedByAgentId: NumberBuckets;
  historyLoadedByAgentId: BooleanBuckets;
  historyLoadingByAgentId: BooleanBuckets;
  activeReplyAgentId: string | null;
  status: "connecting" | "connected" | "disconnected";

  connect: () => void;
  disconnect: () => void;
  switchAgent: (agentId: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  refreshTokenUsage: () => Promise<SessionActionResult>;
  compactCurrentSession: () => Promise<SessionActionResult>;
  resetCurrentSession: () => Promise<SessionActionResult>;
  archiveCurrentSession: () => Promise<SessionActionResult>;
  removeAgentLocalState: (agentId: string) => void;
  getMessagesForAgent: (agentId: string) => ChatMessage[];
  getUsageForAgent: (agentId: string) => ChatUsage;
  getContextWindowSizeForAgent: (agentId: string) => number;
  getCurrentContextUsedForAgent: (agentId: string) => number;
  hasHistoryLoadedForAgent: (agentId: string) => boolean;
  isHistoryLoadingForAgent: (agentId: string) => boolean;
  isSendingForAgent: (agentId: string) => boolean;
  isAnySending: () => boolean;
}

const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_USAGE: ChatUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
};

function getMessages(map: MessageBuckets, agentId: string) {
  return map.get(agentId) ?? EMPTY_MESSAGES;
}

function getUsage(map: UsageBuckets, agentId: string) {
  return map.get(agentId) ?? EMPTY_USAGE;
}

function getNumber(map: NumberBuckets, agentId: string) {
  return map.get(agentId) ?? 0;
}

function isTrue(map: BooleanBuckets, agentId: string) {
  return map.get(agentId) === true;
}

function cloneArchivedMessages(messages: ChatMessage[]) {
  return messages
    .filter((message) => !message.isLoading)
    .map((message) => ({
      ...message,
      usage: message.usage
        ? {
            ...message.usage,
            cost: message.usage.cost ? { ...message.usage.cost } : undefined,
          }
        : undefined,
      isLoading: false,
      isNew: false,
      isHistorical: true,
    }));
}

function buildDirectArchivePreview(messages: ChatMessage[]) {
  const latestVisibleMessage = [...messages]
    .toReversed()
    .find((message) => message.content.trim().length > 0);

  if (!latestVisibleMessage) {
    return "已归档，可稍后回看";
  }

  const previewText = latestVisibleMessage.content.replace(/\s+/g, " ").trim();
  return latestVisibleMessage.role === "user" ? `你：${previewText}` : previewText;
}

function createSidebarDirectArchive(agentId: string, messages: ChatMessage[]) {
  const agent = useAgentStore.getState().agents.find((entry) => entry.id === agentId);
  const agentName = agent?.name?.trim() || agentId;
  const archivedMessages = cloneArchivedMessages(messages);

  return {
    id: crypto.randomUUID(),
    agentId,
    agentName,
    agentRole: agent?.role?.trim() || undefined,
    agentAvatarUrl: agent?.avatarUrl?.trim() || undefined,
    agentAvatarText: agentName.charAt(0).toUpperCase() || "A",
    agentEmoji: agent?.emoji?.trim() || undefined,
    preview: buildDirectArchivePreview(archivedMessages),
    archivedAt: new Date().toISOString(),
    messages: archivedMessages,
  } satisfies SidebarDirectArchive;
}

function isDirectConversationVisible(agentId: string) {
  const { currentAgentId, showDetailFor } = useAgentStore.getState();
  const { selectedGroupId, selectedArchiveId } = useGroupStore.getState();
  const { selectedDirectArchiveId } = useDirectArchiveStore.getState();

  return (
    currentAgentId === agentId &&
    showDetailFor === null &&
    selectedGroupId === null &&
    selectedArchiveId === null &&
    selectedDirectArchiveId === null
  );
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const baseMessages = current.filter((message) => !message.isLoading);
  return [...baseMessages, ...incoming];
}

function withMessages(
  map: MessageBuckets,
  agentId: string,
  updater: (current: ChatMessage[]) => ChatMessage[],
) {
  const next = new Map(map);
  next.set(agentId, updater(getMessages(map, agentId)));
  return next;
}

function withBoolean(map: BooleanBuckets, agentId: string, value: boolean) {
  const next = new Map(map);
  next.set(agentId, value);
  return next;
}

function withUsage(map: UsageBuckets, agentId: string, value: ChatUsage) {
  const next = new Map(map);
  next.set(agentId, value);
  return next;
}

function withNumber(map: NumberBuckets, agentId: string, value: number) {
  const next = new Map(map);
  next.set(agentId, Math.max(0, Math.floor(value)));
  return next;
}

function removeBucketEntry<T>(map: Map<string, T>, agentId: string) {
  const next = new Map(map);
  next.delete(agentId);
  return next;
}

function resetMessages(map: MessageBuckets, agentId: string) {
  const next = new Map(map);
  next.set(agentId, []);
  return next;
}

function buildSessionKey(agentId: string, mainKey: string) {
  return `agent:${agentId}:${mainKey}`;
}

function resolveAgentIdFromSessionKey(sessionKey: string | null | undefined) {
  if (typeof sessionKey !== "string" || !sessionKey.startsWith("agent:")) {
    return null;
  }

  const parts = sessionKey.split(":");
  if (parts.length < 3) {
    return null;
  }

  const agentId = parts[1]?.trim() || "";
  return agentId || null;
}

function isGroupSessionKey(sessionKey: string | null | undefined) {
  return typeof sessionKey === "string" && sessionKey.includes(":group:");
}

function summarizeUsage(messages: ChatMessage[]): ChatUsage {
  return messages.reduce<ChatUsage>(
    (summary, message) => {
      if (message.role !== "assistant" || !message.usage) {
        return summary;
      }

      const nextInput = summary.input + (message.usage.input ?? 0);
      const nextOutput = summary.output + (message.usage.output ?? 0);
      const nextCacheRead = summary.cacheRead + (message.usage.cacheRead ?? 0);
      const nextCacheWrite = summary.cacheWrite + (message.usage.cacheWrite ?? 0);
      return {
        input: nextInput,
        output: nextOutput,
        cacheRead: nextCacheRead,
        cacheWrite: nextCacheWrite,
        totalTokens: nextInput + nextOutput + nextCacheRead + nextCacheWrite,
      };
    },
    { ...EMPTY_USAGE },
  );
}

function resolveCurrentContextUsedFromMessages(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant" || message.isLoading || !message.usage) {
      continue;
    }

    const currentContextUsed = deriveCurrentContextUsed(message.usage);
    if (currentContextUsed !== undefined) {
      return currentContextUsed;
    }
  }

  return undefined;
}

function updateMessagesAndUsage(
  messagesByAgentId: MessageBuckets,
  usageByAgentId: UsageBuckets,
  currentContextUsedByAgentId: NumberBuckets,
  agentId: string,
  updater: (current: ChatMessage[]) => ChatMessage[],
) {
  const nextMessages = updater(getMessages(messagesByAgentId, agentId));
  console.log("[Store] messages updated for", agentId, `count=${nextMessages.length}`);
  const nextContextUsed = resolveCurrentContextUsedFromMessages(nextMessages);
  return {
    messagesByAgentId: withMessages(messagesByAgentId, agentId, () => nextMessages),
    usageByAgentId: withUsage(usageByAgentId, agentId, summarizeUsage(nextMessages)),
    currentContextUsedByAgentId:
      nextContextUsed === undefined
        ? currentContextUsedByAgentId
        : withNumber(currentContextUsedByAgentId, agentId, nextContextUsed),
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

function isProxyUpstreamError(message: string) {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes("502") ||
    normalized.includes("bad gateway") ||
    normalized.includes("upstream request failed") ||
    normalized.includes("upstream")
  );
}

function isUnauthorizedUpstreamError(message: string) {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes("401") ||
    normalized.includes("unauthorized") ||
    normalized.includes("invalid api key") ||
    normalized.includes("incorrect api key")
  );
}

function isRedactedConfigError(message: string) {
  const normalized = message.trim();
  return normalized.includes("__OPENCLAW_REDACTED__") || normalized.includes("OPENCLAW_REDACTED");
}

function formatFriendlyChatError(errorText: string) {
  if (isRedactedConfigError(errorText)) {
    return [
      "当前模型配置里仍有被 Gateway 脱敏的占位符，导致这次配置写入被拒绝。",
      "这通常发生在把 config.get 返回的隐藏 API Key 原样写回配置时。",
      "现在请重新打开“配置模型”弹窗，用自定义 provider 名重新新增一次第三方 OpenAI 兼容 responses 模型。",
      `原始错误：${errorText}`,
    ].join("\n");
  }

  if (isUnauthorizedUpstreamError(errorText)) {
    return [
      "当前模型连接失败（401）。这通常是上游鉴权被拒绝。",
      "如果你在用第三方 OpenAI 兼容 responses 中转站，不要把 provider 写成 openai；建议改成站点名这类自定义 provider 后重新添加模型。",
      "同时请再确认 API Key、baseUrl 和 api=openai-responses 是否正确。",
      `原始错误：${errorText}`,
    ].join("\n");
  }

  if (isProxyUpstreamError(errorText)) {
    return [
      "当前模型连接失败（502）。如果你在用 OpenAI 兼容中转站，请检查 API Key、baseUrl 和 API 协议；也可以先切回其他模型。",
      `原始错误：${errorText}`,
    ].join("\n");
  }

  return `连接错误：${errorText}`;
}

export const useChatStore = create<ChatState>((set, get) => {
  async function loadSessionRuntimeState(agentId: string, sessionKey: string) {
    try {
      const runtimeState = await gateway.getSessionRuntimeState(sessionKey, agentId);
      console.log(
        `[Store] loadSessionRuntimeState: agent=${agentId}, contextWindowSize=${runtimeState.contextWindowSize}, currentContextUsed=${runtimeState.currentContextUsed ?? 0}, fresh=${runtimeState.currentContextUsedFresh}, sessionFound=${runtimeState.sessionFound}`,
      );
      return runtimeState;
    } catch (error) {
      console.error(`[Store] loadSessionRuntimeState failed: agent=${agentId}`, error);
      return null;
    }
  }

  async function syncSessionRuntimeState(agentId: string, sessionKey: string) {
    const runtimeState = await loadSessionRuntimeState(agentId, sessionKey);
    if (!runtimeState) {
      return;
    }

    set((state) => {
      const nextContextWindowSize =
        runtimeState.contextWindowSize > 0
          ? runtimeState.contextWindowSize
          : getNumber(state.contextWindowSizeByAgentId, agentId);
      const nextCurrentContextUsed =
        runtimeState.currentContextUsedFresh && runtimeState.currentContextUsed !== null
          ? runtimeState.currentContextUsed
          : getNumber(state.currentContextUsedByAgentId, agentId);

      return {
        contextWindowSizeByAgentId: withNumber(
          state.contextWindowSizeByAgentId,
          agentId,
          nextContextWindowSize,
        ),
        currentContextUsedByAgentId: withNumber(
          state.currentContextUsedByAgentId,
          agentId,
          nextCurrentContextUsed,
        ),
      };
    });

    console.log(
      `[Store] syncSessionRuntimeState: agent=${agentId}, contextWindowSize=${runtimeState.contextWindowSize}, currentContextUsed=${runtimeState.currentContextUsed ?? 0}, fresh=${runtimeState.currentContextUsedFresh}`,
    );
  }

  // 注册 Gateway 回调，将最终回复落到当前待回复的 Agent 会话桶。
  gateway.setHandlers(
    (msgs: GatewayMessage[], meta?: GatewayMessageMeta) => {
      // 群聊成员回复复用 agent:xxx:group:yyy 的 sessionKey，这里要拦住，避免污染 1v1 会话和未读数。
      if (isGroupSessionKey(meta?.sessionKey)) {
        console.log(
          `[Store] ignore group session reply in direct store: sessionKey=${meta?.sessionKey}`,
        );
        return;
      }

      const replyAgentId =
        resolveAgentIdFromSessionKey(meta?.sessionKey) ?? get().activeReplyAgentId;
      if (!replyAgentId) {
        console.log("[Store] AI reply received, but no agent could be resolved");
        return;
      }

      const newMessages = msgs.map((message) => adaptRealtimeMessage(message));
      const latestAssistantMessage = [...newMessages]
        .toReversed()
        .find((message) => message.role === "assistant");
      const unreadAssistantCount = newMessages.filter(
        (message) => message.role === "assistant" && message.content.trim().length > 0,
      ).length;
      if (latestAssistantMessage?.usage) {
        const currentContextUsed = deriveCurrentContextUsed(latestAssistantMessage.usage) ?? 0;
        console.log(
          `[Store] AI reply usage: input=${latestAssistantMessage.usage.input}, cacheRead=${latestAssistantMessage.usage.cacheRead}, cacheWrite=${latestAssistantMessage.usage.cacheWrite}, totalTokens=${latestAssistantMessage.usage.totalTokens}, currentContextUsed=${currentContextUsed}`,
        );
      }

      set((state) => ({
        ...updateMessagesAndUsage(
          state.messagesByAgentId,
          state.usageByAgentId,
          state.currentContextUsedByAgentId,
          replyAgentId,
          (current) => mergeMessages(current, newMessages),
        ),
        activeReplyAgentId:
          state.activeReplyAgentId === replyAgentId ? null : state.activeReplyAgentId,
      }));

      console.log(
        `[Store] AI reply received: agent=${replyAgentId}, sessionKey=${meta?.sessionKey || "unknown"}, total=${get().getMessagesForAgent(replyAgentId).length}`,
      );

      if (unreadAssistantCount > 0 && !isDirectConversationVisible(replyAgentId)) {
        incrementSidebarDirectUnreadCount(replyAgentId, unreadAssistantCount);
      }

      const mainKey = useAgentStore.getState().mainKey;
      const runtimeSessionKey =
        resolveAgentIdFromSessionKey(meta?.sessionKey) === replyAgentId
          ? meta?.sessionKey
          : mainKey
            ? buildSessionKey(replyAgentId, mainKey)
            : null;
      if (runtimeSessionKey) {
        void syncSessionRuntimeState(replyAgentId, runtimeSessionKey);
      }
    },
    (status) => {
      set({ status });
    },
  );

  function resolveCurrentSessionTarget() {
    const { currentAgentId, mainKey } = useAgentStore.getState();
    if (!currentAgentId || !mainKey) {
      return null;
    }

    return {
      agentId: currentAgentId,
      sessionKey: buildSessionKey(currentAgentId, mainKey),
    };
  }

  async function loadCurrentContextUsed(
    agentId: string,
    messages: ChatMessage[],
    runtimeState: SessionRuntimeState | null,
  ) {
    if (runtimeState?.currentContextUsedFresh && runtimeState.currentContextUsed !== null) {
      console.log(
        `[Store] loadCurrentContextUsed: agent=${agentId}, source=sessions.list, currentContextUsed=${runtimeState.currentContextUsed}`,
      );
      return runtimeState.currentContextUsed;
    }

    if (messages.length === 0) {
      console.log(
        `[Store] loadCurrentContextUsed: agent=${agentId}, source=empty-history, currentContextUsed=0`,
      );
      return 0;
    }

    const fromMessages = resolveCurrentContextUsedFromMessages(messages);
    if (fromMessages !== undefined) {
      console.log(
        `[Store] loadCurrentContextUsed: agent=${agentId}, source=message, currentContextUsed=${fromMessages}`,
      );
      return fromMessages;
    }

    const fallback = getNumber(get().currentContextUsedByAgentId, agentId);

    console.log(
      `[Store] loadCurrentContextUsed: agent=${agentId}, source=fallback, currentContextUsed=${fallback}`,
    );
    return fallback;
  }

  async function reloadSessionHistory(
    agentId: string,
    sessionKey: string,
  ): Promise<SessionActionResult> {
    set((state) => ({
      historyLoadingByAgentId: withBoolean(state.historyLoadingByAgentId, agentId, true),
    }));

    try {
      const [history, runtimeState] = await Promise.all([
        gateway.loadHistory(sessionKey),
        loadSessionRuntimeState(agentId, sessionKey),
      ]);
      if (!history) {
        const error = "刷新会话历史失败";
        set((state) => ({
          historyLoadingByAgentId: withBoolean(state.historyLoadingByAgentId, agentId, false),
        }));
        console.error(`[Store] refreshTokenUsage failed: ${error}, agent=${agentId}`);
        return {
          success: false,
          error,
        };
      }

      const mappedMessages = adaptHistoryMessages(history);
      const fallbackContextWindowSize = getNumber(get().contextWindowSizeByAgentId, agentId);
      const contextWindowSize =
        runtimeState?.contextWindowSize && runtimeState.contextWindowSize > 0
          ? runtimeState.contextWindowSize
          : fallbackContextWindowSize;
      const currentContextUsed = await loadCurrentContextUsed(
        agentId,
        mappedMessages,
        runtimeState,
      );
      set((state) => ({
        messagesByAgentId: withMessages(state.messagesByAgentId, agentId, () => mappedMessages),
        usageByAgentId: withUsage(state.usageByAgentId, agentId, summarizeUsage(mappedMessages)),
        contextWindowSizeByAgentId: withNumber(
          state.contextWindowSizeByAgentId,
          agentId,
          contextWindowSize,
        ),
        currentContextUsedByAgentId: withNumber(
          state.currentContextUsedByAgentId,
          agentId,
          currentContextUsed,
        ),
        historyLoadedByAgentId: withBoolean(state.historyLoadedByAgentId, agentId, true),
        historyLoadingByAgentId: withBoolean(state.historyLoadingByAgentId, agentId, false),
      }));

      console.log(
        `[Store] refreshTokenUsage: history ready for ${agentId}, messages=${mappedMessages.length}, contextWindowSize=${contextWindowSize}, currentContextUsed=${currentContextUsed}`,
      );
      return { success: true };
    } catch (error) {
      const message = getErrorMessage(error, "刷新会话历史失败");
      set((state) => ({
        historyLoadingByAgentId: withBoolean(state.historyLoadingByAgentId, agentId, false),
      }));
      console.error("[Store] refreshTokenUsage failed:", error);
      return {
        success: false,
        error: message,
      };
    }
  }

  return {
    messagesByAgentId: new Map(),
    usageByAgentId: new Map(),
    contextWindowSizeByAgentId: new Map(),
    currentContextUsedByAgentId: new Map(),
    historyLoadedByAgentId: new Map(),
    historyLoadingByAgentId: new Map(),
    activeReplyAgentId: null,
    status: "disconnected",

    connect: () => {
      gateway.connect();
    },

    disconnect: () => {
      gateway.disconnect();
    },

    switchAgent: async (agentId: string) => {
      const agentStore = useAgentStore.getState();
      const previousAgentId = agentStore.currentAgentId;
      agentStore.setCurrentAgent(agentId);

      const sessionKey = useAgentStore.getState().getCurrentSessionKey();
      console.log(
        `[Store] switchAgent: agent=${agentId}, previous=${previousAgentId || "none"}, sessionKey=${sessionKey}`,
      );
      useDirectArchiveStore.getState().clearSelectedDirectArchive();
      clearSidebarDirectUnreadCount(agentId);
      await reloadSessionHistory(agentId, sessionKey);
    },

    sendMessage: async (text: string) => {
      const agentStore = useAgentStore.getState();
      const agentId = agentStore.currentAgentId;
      if (!agentId) {
        throw new Error("current agent is not ready");
      }

      const sessionKey = agentStore.getCurrentSessionKey();
      console.log(`[Store] sendMessage: agent=${agentId}, sessionKey=${sessionKey}, text=${text}`);

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: Date.now(),
        isNew: true,
        isHistorical: false,
      };

      const loadingMsg: ChatMessage = {
        id: `loading:${agentId}`,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        isLoading: true,
        isNew: true,
        isHistorical: false,
      };

      set((state) => ({
        ...updateMessagesAndUsage(
          state.messagesByAgentId,
          state.usageByAgentId,
          state.currentContextUsedByAgentId,
          agentId,
          (current) => [...current.filter((message) => !message.isLoading), userMsg, loadingMsg],
        ),
        historyLoadedByAgentId: withBoolean(state.historyLoadedByAgentId, agentId, true),
        activeReplyAgentId: agentId,
      }));

      console.log(
        `[Store] sendMessage: user msg added, agent=${agentId}, total=${get().getMessagesForAgent(agentId).length}`,
      );

      try {
        const currentModelRef =
          agentStore.agents.find((agent) => agent.id === agentId)?.modelName?.trim() ||
          agentStore.currentAgentModel?.trim() ||
          agentStore.defaultModelLabel?.trim() ||
          "";
        if (currentModelRef && currentModelRef.startsWith("openai/")) {
          console.log(`[Store] sendMessage: 发送前检查模型运行时配置 ${currentModelRef}`);
          await agentStore.ensureModelRuntimeConfig(agentId, currentModelRef);
        }

        const result = await gateway.sendChat(text, sessionKey);
        if (!result.ok) {
          const errorText = result.error?.message?.trim() || "连接 Gateway 失败，请确认服务已启动";
          console.error("[Store] send failed:", errorText);

          set((state) => ({
            ...updateMessagesAndUsage(
              state.messagesByAgentId,
              state.usageByAgentId,
              state.currentContextUsedByAgentId,
              agentId,
              (current) => [
                ...current.filter((message) => !message.isLoading),
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: formatFriendlyChatError(errorText),
                  timestamp: Date.now(),
                  isNew: true,
                  isHistorical: false,
                },
              ],
            ),
            activeReplyAgentId: null,
          }));
        }
      } catch (error) {
        console.error("[GW] error:", error);
        const errorText =
          error instanceof Error && error.message.trim()
            ? error.message
            : "连接 Gateway 失败，请确认服务已启动";
        console.error("[Store] send failed:", errorText);

        set((state) => ({
          ...updateMessagesAndUsage(
            state.messagesByAgentId,
            state.usageByAgentId,
            state.currentContextUsedByAgentId,
            agentId,
            (current) => [
              ...current.filter((message) => !message.isLoading),
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: formatFriendlyChatError(errorText),
                timestamp: Date.now(),
                isNew: true,
                isHistorical: false,
              },
            ],
          ),
          activeReplyAgentId: null,
        }));
      }
    },

    refreshTokenUsage: async () => {
      const target = resolveCurrentSessionTarget();
      console.log(
        `[Store] refreshTokenUsage: agent=${target?.agentId || "none"}, sessionKey=${target?.sessionKey || "none"}`,
      );

      if (!target) {
        const error = "当前 Agent 未就绪";
        console.error(`[Store] refreshTokenUsage failed: ${error}`);
        return {
          success: false,
          error,
        };
      }

      return reloadSessionHistory(target.agentId, target.sessionKey);
    },

    compactCurrentSession: async () => {
      const target = resolveCurrentSessionTarget();
      console.log(
        `[Store] compactCurrentSession: agent=${target?.agentId || "none"}, sessionKey=${target?.sessionKey || "none"}`,
      );

      if (!target) {
        const error = "当前 Agent 未就绪";
        console.error(`[Store] compactCurrentSession failed: ${error}`);
        return {
          success: false,
          error,
        };
      }

      try {
        const beforeContextUsed = get().getCurrentContextUsedForAgent(target.agentId);
        console.log(
          `[Store] compactCurrentSession: before compact agent=${target.agentId}, currentContextUsed=${beforeContextUsed}`,
        );
        const compactResult = await gateway.sendCompactCommand(target.sessionKey);
        if (!compactResult.ok) {
          throw new Error(compactResult.error?.message || "压缩命令执行失败");
        }
        console.log(
          `[Store] compactCurrentSession: compact command ok agent=${target.agentId}, payload=${JSON.stringify(compactResult.payload ?? {})}`,
        );
        const refreshResult = await reloadSessionHistory(target.agentId, target.sessionKey);
        if (!refreshResult.success) {
          return refreshResult;
        }
        const afterContextUsed = get().getCurrentContextUsedForAgent(target.agentId);
        const releasedTokens = Math.max(0, beforeContextUsed - afterContextUsed);

        console.log(
          `[Store] compactCurrentSession: after compact agent=${target.agentId}, currentContextUsed=${afterContextUsed}, releasedTokens=${releasedTokens}`,
        );
        return { success: true, releasedTokens };
      } catch (error) {
        console.error("[Store] compactCurrentSession failed:", error);
        return {
          success: false,
          error: getErrorMessage(error, "压缩会话失败"),
        };
      }
    },

    resetCurrentSession: async () => {
      const target = resolveCurrentSessionTarget();
      console.log(
        `[Store] resetCurrentSession: agent=${target?.agentId || "none"}, sessionKey=${target?.sessionKey || "none"}`,
      );

      if (!target) {
        const error = "当前 Agent 未就绪";
        console.error(`[Store] resetCurrentSession failed: ${error}`);
        return {
          success: false,
          error,
        };
      }

      try {
        await gateway.resetSession(target.sessionKey);
        set((state) => ({
          messagesByAgentId: resetMessages(state.messagesByAgentId, target.agentId),
          usageByAgentId: withUsage(state.usageByAgentId, target.agentId, { ...EMPTY_USAGE }),
          currentContextUsedByAgentId: withNumber(
            state.currentContextUsedByAgentId,
            target.agentId,
            0,
          ),
          historyLoadedByAgentId: withBoolean(state.historyLoadedByAgentId, target.agentId, true),
          historyLoadingByAgentId: withBoolean(
            state.historyLoadingByAgentId,
            target.agentId,
            false,
          ),
          activeReplyAgentId:
            state.activeReplyAgentId === target.agentId ? null : state.activeReplyAgentId,
        }));
        clearSidebarDirectUnreadCount(target.agentId);
        console.log(`[Store] resetCurrentSession: messages cleared for ${target.agentId}`);
        return { success: true };
      } catch (error) {
        console.error("[Store] resetCurrentSession failed:", error);
        return {
          success: false,
          error: getErrorMessage(error, "重置会话失败"),
        };
      }
    },

    archiveCurrentSession: async () => {
      const target = resolveCurrentSessionTarget();
      console.log(
        `[Store] archiveCurrentSession: agent=${target?.agentId || "none"}, sessionKey=${target?.sessionKey || "none"}`,
      );

      if (!target) {
        const error = "当前 Agent 未就绪";
        console.error(`[Store] archiveCurrentSession failed: ${error}`);
        return {
          success: false,
          error,
        };
      }

      try {
        const currentMessages = get().getMessagesForAgent(target.agentId);
        if (currentMessages.filter((message) => !message.isLoading).length === 0) {
          return {
            success: false,
            error: "当前没有可归档的 1v1 记录",
          };
        }

        const archive = createSidebarDirectArchive(target.agentId, currentMessages);
        const previousArchives = readSidebarDirectArchives();
        writeSidebarDirectArchives([archive, ...previousArchives]);

        try {
          await gateway.deleteSession(target.sessionKey);
        } catch (error) {
          writeSidebarDirectArchives(previousArchives);
          throw error;
        }

        set((state) => ({
          messagesByAgentId: resetMessages(state.messagesByAgentId, target.agentId),
          usageByAgentId: withUsage(state.usageByAgentId, target.agentId, { ...EMPTY_USAGE }),
          currentContextUsedByAgentId: withNumber(
            state.currentContextUsedByAgentId,
            target.agentId,
            0,
          ),
          historyLoadedByAgentId: withBoolean(state.historyLoadedByAgentId, target.agentId, true),
          historyLoadingByAgentId: withBoolean(
            state.historyLoadingByAgentId,
            target.agentId,
            false,
          ),
          activeReplyAgentId:
            state.activeReplyAgentId === target.agentId ? null : state.activeReplyAgentId,
        }));
        clearSidebarDirectUnreadCount(target.agentId);
        console.log(
          `[Store] archiveCurrentSession: archived ${target.sessionKey}, next chat.send will create a new session`,
        );
        return { success: true };
      } catch (error) {
        console.error("[Store] archiveCurrentSession failed:", error);
        return {
          success: false,
          error: getErrorMessage(error, "归档会话失败"),
        };
      }
    },

    removeAgentLocalState: (agentId) => {
      const normalizedAgentId = agentId.trim();
      if (!normalizedAgentId) {
        return;
      }

      set((state) => ({
        messagesByAgentId: removeBucketEntry(state.messagesByAgentId, normalizedAgentId),
        usageByAgentId: removeBucketEntry(state.usageByAgentId, normalizedAgentId),
        contextWindowSizeByAgentId: removeBucketEntry(
          state.contextWindowSizeByAgentId,
          normalizedAgentId,
        ),
        currentContextUsedByAgentId: removeBucketEntry(
          state.currentContextUsedByAgentId,
          normalizedAgentId,
        ),
        historyLoadedByAgentId: removeBucketEntry(state.historyLoadedByAgentId, normalizedAgentId),
        historyLoadingByAgentId: removeBucketEntry(
          state.historyLoadingByAgentId,
          normalizedAgentId,
        ),
        activeReplyAgentId:
          state.activeReplyAgentId === normalizedAgentId ? null : state.activeReplyAgentId,
      }));
      clearSidebarDirectUnreadCount(normalizedAgentId);
      console.log(`[Store] 已清理员工本地会话状态: ${normalizedAgentId}`);
    },

    getMessagesForAgent: (agentId) => {
      if (!agentId) {
        return EMPTY_MESSAGES;
      }

      return getMessages(get().messagesByAgentId, agentId);
    },

    getUsageForAgent: (agentId) => {
      if (!agentId) {
        return EMPTY_USAGE;
      }

      return getUsage(get().usageByAgentId, agentId);
    },

    getContextWindowSizeForAgent: (agentId) => {
      if (!agentId) {
        return 0;
      }

      return getNumber(get().contextWindowSizeByAgentId, agentId);
    },

    getCurrentContextUsedForAgent: (agentId) => {
      if (!agentId) {
        return 0;
      }

      return getNumber(get().currentContextUsedByAgentId, agentId);
    },

    hasHistoryLoadedForAgent: (agentId) => {
      if (!agentId) {
        return false;
      }

      return isTrue(get().historyLoadedByAgentId, agentId);
    },

    isHistoryLoadingForAgent: (agentId) => {
      if (!agentId) {
        return false;
      }

      return isTrue(get().historyLoadingByAgentId, agentId);
    },

    isSendingForAgent: (agentId) => {
      if (!agentId) {
        return false;
      }

      return get().activeReplyAgentId === agentId;
    },

    isAnySending: () => {
      return get().activeReplyAgentId !== null;
    },
  };
});
