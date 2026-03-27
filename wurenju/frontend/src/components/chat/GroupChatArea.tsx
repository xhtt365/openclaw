import {
  Archive,
  ChevronDown,
  ChevronUp,
  Download,
  RotateCcw,
  Search,
  Send,
  X,
  Zap,
} from "lucide-react";
import { memo, type WheelEvent, useEffect, useMemo, useRef, useState } from "react";
import { GroupChatHeader } from "@/components/chat/GroupChatHeader";
import { GroupThinkingStatus } from "@/components/chat/GroupThinkingStatus";
import { GroupWelcomeView } from "@/components/chat/GroupWelcomeView";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { matchesMessageSearch } from "@/components/chat/messageSearch";
import { UserProfilePopover } from "@/components/chat/UserProfilePopover";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { EditGroupModal } from "@/components/modals/EditGroupModal";
import { GroupAnnouncementModal } from "@/components/modals/GroupAnnouncementModal";
import { GroupMemberManageModal } from "@/components/modals/GroupMemberManageModal";
import { GroupUrgeModal } from "@/components/modals/GroupUrgeModal";
import { ContextRing } from "@/components/ui/ContextRing";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/agentStore";
import {
  getGroupContextMetrics,
  useGroupStore,
  type Group,
  type GroupChatMessage,
  type ThinkingAgent,
} from "@/stores/groupStore";
import {
  getScrollBottomTop,
  getShouldStickToBottomOnWheel,
  isScrollNearBottom,
} from "@/utils/chatScroll";
import { resolveDisplayAgentMembers } from "@/utils/groupMembers";
import { findActiveGroupMention, insertGroupMention } from "@/utils/groupMention";
import { buildGroupExportFilename, formatGroupTranscript } from "@/utils/groupTranscript";
import { getUserProfile, subscribeToUserProfile } from "@/utils/userProfile";

const EMPTY_GROUP_MESSAGES: GroupChatMessage[] = [];
const EMPTY_THINKING_AGENTS: Map<string, ThinkingAgent> = new Map();

type GroupChatAreaProps = {
  group: Group;
};

type ActionFeedback = {
  tone: "success" | "error";
  message: string;
};

const compactTokenFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function hashText(value: string) {
  return Array.from(value).reduce((total, char) => total + char.charCodeAt(0), 0);
}

function getAvatarColor(value: string) {
  const colors = [
    "var(--color-avatar-1)",
    "var(--color-avatar-2)",
    "var(--color-avatar-3)",
    "var(--color-avatar-4)",
    "var(--color-avatar-5)",
    "var(--color-avatar-6)",
  ] as const;

  return colors[hashText(value) % colors.length];
}

function resolveAgentName(message: GroupChatMessage, group: Group) {
  if (message.senderName?.trim()) {
    return message.senderName.trim();
  }

  const leader = group.members.find((member) => member.id === group.leaderId);
  return leader?.name ?? group.name;
}

function resolveAgentAvatarText(message: GroupChatMessage, group: Group) {
  const senderName = resolveAgentName(message, group);
  return message.senderEmoji?.trim() || senderName.trim().charAt(0).toUpperCase() || "#";
}

function formatCompactTokens(value: number) {
  return compactTokenFormatter.format(Math.max(0, Math.floor(value)));
}

function playGroupNotificationTone() {
  if (typeof window === "undefined") {
    return;
  }

  const AudioContextConstructor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) {
    return;
  }

  const context = new AudioContextConstructor();
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, now);
  oscillator.frequency.exponentialRampToValueAtTime(660, now + 0.18);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.045, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.22);
  oscillator.addEventListener("ended", () => {
    void context.close().catch(() => undefined);
  });
}

function showGroupDesktopNotification(group: Group, message: GroupChatMessage) {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return false;
  }

  if (Notification.permission !== "granted") {
    return false;
  }

  const senderName = resolveAgentName(message, group);
  const notification = new Notification(`${group.name} · ${senderName}`, {
    body: message.content.trim().slice(0, 96) || "你有一条新的群消息",
    tag: `group-${group.id}`,
  });
  notification.addEventListener("click", () => {
    window.focus();
    notification.close();
  });
  return true;
}

function MentionChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group-mention-chip">
      <span>@{label}</span>
    </button>
  );
}

const MemoMentionChip = memo(MentionChip);
MemoMentionChip.displayName = "MentionChip";

function GroupChatAreaInner({ group }: GroupChatAreaProps) {
  const agents = useAgentStore((state) => state.agents);
  const messages = useGroupStore(
    (state) => state.messagesByGroupId[group.id] ?? EMPTY_GROUP_MESSAGES,
  );
  const isSending = useGroupStore((state) => state.isSendingByGroupId[group.id]);
  const thinkingAgentMap = useGroupStore(
    (state) => state.thinkingAgentsByGroupId.get(group.id) ?? EMPTY_THINKING_AGENTS,
  );
  const sendGroupMessage = useGroupStore((state) => state.sendGroupMessage);
  const archiveGroupSession = useGroupStore((state) => state.archiveGroupSession);
  const resetGroupMessages = useGroupStore((state) => state.resetGroupMessages);
  const updateGroupAnnouncement = useGroupStore((state) => state.updateGroupAnnouncement);
  const setGroupNotificationsEnabled = useGroupStore((state) => state.setGroupNotificationsEnabled);
  const setGroupSoundEnabled = useGroupStore((state) => state.setGroupSoundEnabled);
  const startGroupUrging = useGroupStore((state) => state.startGroupUrging);
  const pauseGroupUrging = useGroupStore((state) => state.pauseGroupUrging);
  const resumeGroupUrging = useGroupStore((state) => state.resumeGroupUrging);
  const stopGroupUrging = useGroupStore((state) => state.stopGroupUrging);

  const [input, setInput] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const [isAnnouncementModalOpen, setIsAnnouncementModalOpen] = useState(false);
  const [isEditGroupModalOpen, setIsEditGroupModalOpen] = useState(false);
  const [isMemberManageModalOpen, setIsMemberManageModalOpen] = useState(false);
  const [isArchiveConfirmOpen, setIsArchiveConfirmOpen] = useState(false);
  const [isArchiveLoading, setIsArchiveLoading] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [isResetLoading, setIsResetLoading] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [isUrgeModalOpen, setIsUrgeModalOpen] = useState(false);
  const [announcementDraft, setAnnouncementDraft] = useState("");
  const [urgeIntervalDraft, setUrgeIntervalDraft] = useState(group.urgeIntervalMinutes ?? 10);
  const [userProfile, setUserProfile] = useState(() => getUserProfile());
  const [popoverAnchorRect, setPopoverAnchorRect] = useState<DOMRect | null>(null);
  const [caretPosition, setCaretPosition] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageViewportRef = useRef<HTMLDivElement>(null);
  const messageContentRef = useRef<HTMLDivElement>(null);
  const messageElementRefs = useRef(new Map<string, HTMLDivElement>());
  const hasInitializedNotificationRef = useRef(false);
  const seenAssistantMessageIdsRef = useRef(new Set<string>());
  const copyTimerRef = useRef<number | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const hasAutoScrolledRef = useRef(false);

  const metrics = useMemo(() => getGroupContextMetrics(messages), [messages]);
  const thinkingAgents = useMemo(() => Array.from(thinkingAgentMap.values()), [thinkingAgentMap]);
  const agentMembers = useMemo(() => resolveDisplayAgentMembers(group, agents), [agents, group]);
  const hasMessages = messages.length > 0;
  const hasAnnouncement = Boolean(group.announcement?.trim());
  const isUrging = group.isUrging === true;
  const isUrgePaused = group.isUrgePaused === true;
  const urgeCount = group.urgeCount ?? 0;
  const leaderName =
    group.members.find((member) => member.id === group.leaderId)?.name ??
    group.members[0]?.name ??
    "群主";
  const contextIndicatorLabel = `${formatCompactTokens(metrics.currentUsed)}/${formatCompactTokens(metrics.total)}`;
  const trimmedSearchQuery = searchQuery.trim();
  const matchedMessageIds = useMemo(() => {
    if (!trimmedSearchQuery) {
      return [] as string[];
    }

    return messages
      .filter((message) =>
        matchesMessageSearch(
          [message.content, message.thinking ?? ""].filter(Boolean).join("\n"),
          trimmedSearchQuery,
        ),
      )
      .map((message) => message.id);
  }, [messages, trimmedSearchQuery]);
  const normalizedSearchIndex =
    matchedMessageIds.length > 0 ? Math.min(activeSearchIndex, matchedMessageIds.length - 1) : 0;
  const activeMatchedMessageId =
    matchedMessageIds.length > 0 ? (matchedMessageIds[normalizedSearchIndex] ?? null) : null;

  function autoResize() {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
  }

  function syncCaretPosition(nextCaret?: number) {
    if (typeof nextCaret === "number") {
      setCaretPosition(nextCaret);
      return;
    }

    const textarea = textareaRef.current;
    setCaretPosition(textarea?.selectionStart ?? input.length);
  }

  function insertMention(name: string) {
    const textarea = textareaRef.current;
    const fallbackCaret = textarea?.selectionStart ?? caretPosition;
    const activeMention = findActiveGroupMention(input, fallbackCaret);
    const nextMention = insertGroupMention(input, name, activeMention, fallbackCaret);

    setInput(nextMention.value);
    setCaretPosition(nextMention.caret);

    window.requestAnimationFrame(() => {
      textarea?.focus();
      if (textarea) {
        textarea.setSelectionRange(nextMention.caret, nextMention.caret);
      }
      autoResize();
    });

    console.log(`[Group] 插入成员提及: @${name}`);
  }

  function showActionFeedback(tone: ActionFeedback["tone"], message: string) {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }

    setActionFeedback({ tone, message });
    feedbackTimerRef.current = window.setTimeout(() => {
      setActionFeedback((current) => (current?.message === message ? null : current));
    }, 2400);
  }

  function closeSearchPanel() {
    setIsSearchOpen(false);
    setSearchQuery("");
    setActiveSearchIndex(0);
    console.log(`[Search] 已关闭消息搜索: ${group.name}`);
  }

  function handleToggleSearch() {
    if (isSearchOpen) {
      closeSearchPanel();
      return;
    }

    setIsSearchOpen(true);
    setActiveSearchIndex(0);
    console.log(`[Search] 打开消息搜索: ${group.name}`);
  }

  function handleSearchStep(direction: "prev" | "next") {
    if (matchedMessageIds.length === 0) {
      return;
    }

    setActiveSearchIndex((current) => {
      if (direction === "prev") {
        return current <= 0 ? matchedMessageIds.length - 1 : current - 1;
      }

      return (current + 1) % matchedMessageIds.length;
    });
    console.log(`[Search] 切换搜索结果: ${group.name} -> ${direction}`);
  }

  function requestBrowserNotificationPermission() {
    if (typeof window === "undefined" || typeof Notification === "undefined") {
      return;
    }

    if (Notification.permission !== "default") {
      return;
    }

    void Notification.requestPermission()
      .then((permission) => {
        console.log(`[Notify] 浏览器通知权限: ${permission}`);
      })
      .catch((error) => {
        console.error("[Notify] 请求浏览器通知权限失败:", error);
      });
  }

  function handleToggleNotifications() {
    const nextEnabled = group.notificationsEnabled === false;
    setGroupNotificationsEnabled(group.id, nextEnabled);
    if (nextEnabled) {
      requestBrowserNotificationPermission();
    }
    showActionFeedback("success", nextEnabled ? "消息提醒已开启" : "消息提醒已关闭");
  }

  function handleToggleSound() {
    const nextEnabled = group.soundEnabled === false;
    setGroupSoundEnabled(group.id, nextEnabled);
    showActionFeedback("success", nextEnabled ? "群聊音效已开启" : "群聊音效已关闭");
  }

  function handleSend() {
    const text = input.trim();
    if (!text || isSending) {
      return;
    }

    shouldStickToBottomRef.current = true;
    void sendGroupMessage(group.id, text);
    setInput("");
    setCaretPosition(0);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    window.requestAnimationFrame(() => {
      scrollMessagesToBottom("auto");
    });
  }

  function scrollMessagesToBottom(behavior: ScrollBehavior) {
    const viewport = messageViewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollTo({
      top: getScrollBottomTop(viewport),
      behavior,
    });
  }

  function handleMessageViewportScroll() {
    const viewport = messageViewportRef.current;
    if (!viewport) {
      return;
    }

    shouldStickToBottomRef.current = isScrollNearBottom(viewport);
  }

  function handleMessageViewportWheel(event: WheelEvent<HTMLDivElement>) {
    const viewport = messageViewportRef.current;
    if (!viewport) {
      return;
    }

    shouldStickToBottomRef.current = getShouldStickToBottomOnWheel(viewport, event.deltaY);
  }

  async function handleCopyMessage(message: GroupChatMessage) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);

      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }

      copyTimerRef.current = window.setTimeout(() => {
        setCopiedMessageId((current) => (current === message.id ? null : current));
      }, 1000);
    } catch (error) {
      console.error("[Group] 复制群消息失败:", error);
    }
  }

  function handleDownloadMessage(message: GroupChatMessage) {
    const blob = new Blob([message.content], { type: "text/plain;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${group.name}-${message.id}.txt`;
    anchor.click();
    window.URL.revokeObjectURL(url);
    console.log("[Group] 导出单条消息");
  }

  function handleRefreshMessage(message: GroupChatMessage) {
    console.log(`[Group] 刷新消息占位: ${message.id}`);
  }

  function handleExportHistory() {
    if (!hasMessages) {
      return;
    }

    const exportDate = new Date();
    const blob = new Blob([formatGroupTranscript(messages, group)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = buildGroupExportFilename(group.name, exportDate);
    anchor.click();
    window.URL.revokeObjectURL(url);
    console.log(`[Group] 导出群聊记录: ${group.name}`);
    showActionFeedback("success", "群聊记录已导出");
  }

  async function handleArchiveHistoryConfirm() {
    setIsArchiveLoading(true);
    const result = await archiveGroupSession(group.id);
    setIsArchiveLoading(false);

    if (!result.success) {
      showActionFeedback("error", result.error || "归档失败，请稍后重试");
      return;
    }

    setIsArchiveConfirmOpen(false);
    console.log(`[Group] 已归档群聊记录: ${group.name}`);
    showActionFeedback("success", "群聊记录已归档，当前会话已重置");
  }

  async function handleResetHistoryConfirm() {
    setIsResetLoading(true);
    const result = await resetGroupMessages(group.id);
    setIsResetLoading(false);

    if (!result.success) {
      showActionFeedback("error", result.error || "重置失败，请稍后重试");
      return;
    }

    setIsResetConfirmOpen(false);
    console.log(`[Group] 已重置群聊记录: ${group.name}`);
    showActionFeedback("success", "已清空消息并重置全部成员会话");
  }

  function handleOpenAnnouncementModal() {
    console.log(`[Announce] 打开群公告弹窗: ${group.name}`);
    setAnnouncementDraft(group.announcement ?? "");
    setIsAnnouncementModalOpen(true);
  }

  function handleCloseAnnouncementModal() {
    setIsAnnouncementModalOpen(false);
  }

  function handleSaveAnnouncement() {
    updateGroupAnnouncement(group.id, announcementDraft);
    setIsAnnouncementModalOpen(false);
    showActionFeedback("success", announcementDraft.trim() ? "群公告已保存" : "群公告已清空");
  }

  function handleOpenEditGroupModal() {
    console.log(`[Group] 打开编辑项目组弹窗: ${group.name}`);
    setIsEditGroupModalOpen(true);
  }

  function handleCloseEditGroupModal() {
    setIsEditGroupModalOpen(false);
  }

  function handleOpenMemberManageModal() {
    console.log(`[Group] 打开成员管理弹窗: ${group.name}`);
    setIsMemberManageModalOpen(true);
  }

  function handleCloseMemberManageModal() {
    setIsMemberManageModalOpen(false);
  }

  function handleOpenUrgeModal() {
    console.log(`[Urge] 打开督促模式弹窗: ${group.name}`);
    setUrgeIntervalDraft(group.urgeIntervalMinutes ?? 10);
    setIsUrgeModalOpen(true);
  }

  function handleCloseUrgeModal() {
    setIsUrgeModalOpen(false);
  }

  function handleStartUrging() {
    startGroupUrging(group.id, urgeIntervalDraft);
    setIsUrgeModalOpen(false);
    showActionFeedback("success", `已开启督促模式（${urgeIntervalDraft} 分钟）`);
  }

  function handlePauseUrging() {
    pauseGroupUrging(group.id);
    showActionFeedback("success", "督促模式已暂停");
  }

  function handleResumeUrging() {
    resumeGroupUrging(group.id);
    showActionFeedback("success", "督促模式已恢复");
  }

  function handleStopUrging() {
    stopGroupUrging(group.id);
    setIsUrgeModalOpen(false);
    showActionFeedback("success", "督促模式已关闭");
  }

  useEffect(() => {
    shouldStickToBottomRef.current = true;
    hasAutoScrolledRef.current = false;
  }, [group.id]);

  useEffect(() => subscribeToUserProfile(setUserProfile), []);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      if (!messageViewportRef.current) {
        return;
      }

      if (shouldStickToBottomRef.current || !hasAutoScrolledRef.current) {
        scrollMessagesToBottom("auto");
        shouldStickToBottomRef.current = true;
      }

      hasAutoScrolledRef.current = true;
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isSending, messages.length, thinkingAgents.length]);

  useEffect(() => {
    const content = messageContentRef.current;
    if (!content || typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      if (!shouldStickToBottomRef.current) {
        return;
      }

      scrollMessagesToBottom("auto");
    });
    resizeObserver.observe(content);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isSearchOpen) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isSearchOpen]);

  useEffect(() => {
    if (!isSearchOpen || !activeMatchedMessageId) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      messageElementRefs.current.get(activeMatchedMessageId)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeMatchedMessageId, isSearchOpen]);

  useEffect(() => {
    const assistantMessages = messages.filter((message) => message.role === "assistant");
    if (!hasInitializedNotificationRef.current) {
      seenAssistantMessageIdsRef.current = new Set(assistantMessages.map((message) => message.id));
      hasInitializedNotificationRef.current = true;
      return;
    }

    const freshMessages = assistantMessages.filter((message) => {
      return message.isNew && !seenAssistantMessageIdsRef.current.has(message.id);
    });
    if (freshMessages.length === 0) {
      return;
    }

    freshMessages.forEach((message) => {
      seenAssistantMessageIdsRef.current.add(message.id);
    });

    if (group.notificationsEnabled === false) {
      console.log(`[Notify] 项目组提醒已关闭，跳过新消息提醒: ${group.name}`);
      return;
    }

    const latestMessage = freshMessages[freshMessages.length - 1];
    if (!latestMessage) {
      return;
    }

    if (group.soundEnabled !== false) {
      try {
        playGroupNotificationTone();
      } catch (error) {
        console.error("[Notify] 播放群聊提示音失败:", error);
      }
    }

    const notificationShown = showGroupDesktopNotification(group, latestMessage);
    console.log(
      `[Notify] 新消息提醒: ${group.name} <- ${resolveAgentName(latestMessage, group)}，desktop=${notificationShown}`,
    );
  }, [group, messages]);

  return (
    <section className="group-chat-shell">
      <div className="group-chat-card">
        <GroupChatHeader
          group={group}
          hasAnnouncement={hasAnnouncement}
          isUrging={isUrging}
          isUrgePaused={isUrgePaused}
          isSearchOpen={isSearchOpen}
          onAnnouncementClick={handleOpenAnnouncementModal}
          onEditGroupClick={handleOpenEditGroupModal}
          onManageMembersClick={handleOpenMemberManageModal}
          onResetConversationClick={() => {
            console.log(`[Group] 打开重置对话确认弹窗: ${group.name}`);
            setIsResetConfirmOpen(true);
          }}
          onSearchClick={handleToggleSearch}
          onToggleNotifications={handleToggleNotifications}
          onToggleSound={handleToggleSound}
          onUrgeClick={handleOpenUrgeModal}
        />

        {isSearchOpen ? (
          <div className="group-chat-search">
            <div className="chat-search">
              <Search className="chat-search__icon shrink-0" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                }}
                placeholder="搜索群聊历史消息"
                className="chat-search__input"
              />

              <span className="chat-search__count">
                {trimmedSearchQuery
                  ? matchedMessageIds.length > 0
                    ? `${normalizedSearchIndex + 1}/${matchedMessageIds.length}`
                    : "0/0"
                  : `${messages.length} 条消息`}
              </span>

              <div className="chat-search__nav">
                <button
                  type="button"
                  onClick={() => {
                    handleSearchStep("prev");
                  }}
                  disabled={matchedMessageIds.length === 0}
                  className="topbar-icon-btn"
                  aria-label="上一条搜索结果"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleSearchStep("next");
                  }}
                  disabled={matchedMessageIds.length === 0}
                  className="topbar-icon-btn"
                  aria-label="下一条搜索结果"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={closeSearchPanel}
                  className="topbar-icon-btn"
                  aria-label="关闭搜索"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <p className="mt-2 text-xs text-[var(--muted)]">
              {trimmedSearchQuery
                ? matchedMessageIds.length > 0
                  ? `找到 ${matchedMessageIds.length} 条匹配消息，已自动高亮`
                  : "没有找到匹配消息"
                : "输入关键词后会高亮命中消息"}
            </p>
          </div>
        ) : null}

        <div
          ref={messageViewportRef}
          onWheelCapture={handleMessageViewportWheel}
          onScroll={handleMessageViewportScroll}
          className="chat-thread im-scroll"
        >
          <div
            ref={messageContentRef}
            className={cn("flex w-full flex-col gap-6", hasMessages ? "" : "min-h-full")}
          >
            {hasMessages ? (
              <>
                {messages.map((message) => {
                  const isSearchHit =
                    trimmedSearchQuery.length > 0 &&
                    matchesMessageSearch(
                      [message.content, message.thinking ?? ""].filter(Boolean).join("\n"),
                      trimmedSearchQuery,
                    );
                  const isSearchActive = activeMatchedMessageId === message.id;

                  return (
                    <div
                      key={message.id}
                      ref={(node) => {
                        if (node) {
                          messageElementRefs.current.set(message.id, node);
                          return;
                        }

                        messageElementRefs.current.delete(message.id);
                      }}
                      className={cn(
                        "rounded-[22px] transition-all duration-200 scroll-mt-28",
                        isSearchHit ? "chat-bubble--matched" : "",
                        isSearchActive ? "chat-bubble--active" : "",
                      )}
                    >
                      <MessageBubble
                        key={message.id}
                        message={message}
                        agentId={message.senderId ?? undefined}
                        agentName={resolveAgentName(message, group)}
                        agentAvatarText={resolveAgentAvatarText(message, group)}
                        agentAvatarColor={getAvatarColor(
                          message.senderId ?? resolveAgentName(message, group),
                        )}
                        agentAvatarUrl={message.senderAvatarUrl}
                        userAvatar={userProfile.avatar}
                        userProfile={userProfile}
                        isCopied={copiedMessageId === message.id}
                        isTyping={false}
                        onTypingComplete={() => {}}
                        onUserAvatarClick={(target) => {
                          setPopoverAnchorRect(target.getBoundingClientRect());
                        }}
                        onCopy={handleCopyMessage}
                        onDownload={handleDownloadMessage}
                        onRefresh={handleRefreshMessage}
                        searchQuery={trimmedSearchQuery}
                      />
                    </div>
                  );
                })}

                <GroupThinkingStatus members={group.members} thinkingAgents={thinkingAgents} />

                <div ref={bottomRef} />
              </>
            ) : (
              <GroupWelcomeView group={group} onMention={insertMention} />
            )}
          </div>
        </div>

        <div className="group-chat-compose">
          <div className="relative">
            {actionFeedback ? (
              <div
                className={cn(
                  "chat-toast",
                  actionFeedback.tone === "error" ? "chat-toast--error" : "",
                )}
              >
                {actionFeedback.message}
              </div>
            ) : null}

            <div className="chat-controls overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={handleExportHistory}
                  className="chat-action-btn chat-action-btn--compact"
                  disabled={!hasMessages || isArchiveLoading || isResetLoading}
                >
                  <Download className="h-4 w-4" />
                  导出
                </button>
                <button
                  type="button"
                  onClick={() => {
                    console.log(`[Group] 打开归档确认弹窗: ${group.name}`);
                    setIsArchiveConfirmOpen(true);
                  }}
                  className="chat-action-btn chat-action-btn--archive"
                  disabled={!hasMessages || isArchiveLoading || isResetLoading}
                >
                  <Archive className="h-4 w-4" />
                  归档
                </button>
                <button
                  type="button"
                  onClick={() => {
                    console.log(`[Group] 打开重置对话确认弹窗: ${group.name}`);
                    setIsResetConfirmOpen(true);
                  }}
                  className="chat-action-btn chat-action-btn--reset"
                  disabled={!hasMessages || isArchiveLoading || isResetLoading}
                >
                  <RotateCcw className="h-4 w-4" />
                  重置
                </button>
              </div>

              <div className="chat-controls__thinking shrink-0">
                <ContextRing
                  currentUsed={metrics.currentUsed}
                  total={metrics.total}
                  inputTokens={metrics.inputTokens}
                  outputTokens={metrics.outputTokens}
                  cacheHitTokens={metrics.cacheHitTokens}
                  totalConsumed={metrics.totalConsumed}
                />
                <span>{contextIndicatorLabel}</span>
              </div>
            </div>

            <div>
              <div className="agent-chat__input">
                <div className="flex items-end gap-3 px-4 pt-2">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(event) => {
                      setInput(event.target.value);
                      syncCaretPosition(event.target.selectionStart ?? event.target.value.length);
                      autoResize();
                    }}
                    onFocus={() => {
                      syncCaretPosition();
                    }}
                    onSelect={() => {
                      syncCaretPosition();
                    }}
                    onClick={() => {
                      syncCaretPosition();
                    }}
                    onKeyUp={() => {
                      syncCaretPosition();
                    }}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) {
                        return;
                      }

                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="输入消息..."
                    rows={1}
                    className="min-h-7 max-h-24 flex-1 resize-none bg-transparent py-1 text-sm leading-6 outline-none"
                  />

                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={!input.trim() || isSending}
                    className={cn(
                      "chat-send-btn mb-2",
                      isSending ? "animate-[spin_1s_linear_infinite]" : "",
                      input.trim() ? "" : "cursor-not-allowed opacity-50",
                    )}
                    aria-label="发送群消息"
                  >
                    {isSending ? <Zap className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-4 pb-3 pt-3 text-[11px] text-[var(--muted)]">
                  <span className="font-medium text-[var(--muted)]">提及:</span>
                  {agentMembers.map((member) => (
                    <MemoMentionChip
                      key={member.id}
                      label={member.name}
                      onClick={() => {
                        insertMention(member.name);
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <p className="group-chat-help">按 Enter 发送，Shift + Enter 换行</p>
          </div>
        </div>
      </div>

      <UserProfilePopover
        open={popoverAnchorRect !== null}
        anchorRect={popoverAnchorRect}
        onClose={() => {
          setPopoverAnchorRect(null);
        }}
      />

      <GroupAnnouncementModal
        open={isAnnouncementModalOpen}
        groupName={group.name}
        value={announcementDraft}
        onChange={setAnnouncementDraft}
        onClose={handleCloseAnnouncementModal}
        onSave={handleSaveAnnouncement}
      />
      <EditGroupModal
        key={`edit-${group.id}-${isEditGroupModalOpen ? "open" : "closed"}`}
        open={isEditGroupModalOpen}
        group={group}
        onClose={handleCloseEditGroupModal}
      />
      <GroupMemberManageModal
        key={`members-${group.id}-${isMemberManageModalOpen ? "open" : "closed"}`}
        open={isMemberManageModalOpen}
        group={group}
        onClose={handleCloseMemberManageModal}
      />
      <GroupUrgeModal
        open={isUrgeModalOpen}
        groupName={group.name}
        leaderName={leaderName}
        isUrging={isUrging}
        isPaused={isUrgePaused}
        intervalMinutes={group.urgeIntervalMinutes ?? 10}
        urgeCount={urgeCount}
        selectedInterval={urgeIntervalDraft}
        onSelectInterval={setUrgeIntervalDraft}
        onClose={handleCloseUrgeModal}
        onStart={handleStartUrging}
        onPause={handlePauseUrging}
        onResume={handleResumeUrging}
        onStop={handleStopUrging}
      />
      <ConfirmModal
        open={isArchiveConfirmOpen}
        onClose={() => {
          if (!isArchiveLoading) {
            setIsArchiveConfirmOpen(false);
          }
        }}
        onConfirm={() => {
          void handleArchiveHistoryConfirm();
        }}
        loading={isArchiveLoading}
        icon="📦"
        iconBgColor="bg-[var(--accent-2-subtle)]"
        iconTextColor="text-[var(--info)]"
        title="归档群聊对话"
        subtitle="保存聊天记录并重置当前 session"
        description="确认后会保存当前项目组的完整聊天记录到本地归档，并重置全部成员在该群里的 session。完成后消息流会回到欢迎页。"
        confirmText="确认归档"
        confirmColor="bg-[var(--info)] hover:brightness-110"
      />
      <ConfirmModal
        open={isResetConfirmOpen}
        onClose={() => {
          if (!isResetLoading) {
            setIsResetConfirmOpen(false);
          }
        }}
        onConfirm={() => {
          void handleResetHistoryConfirm();
        }}
        loading={isResetLoading}
        icon="🔄"
        iconBgColor="bg-[var(--danger-subtle)]"
        iconTextColor="text-[var(--danger)]"
        title="重置群聊对话"
        subtitle="清空消息并重置全部成员 session"
        description="确认后会清空当前项目组的全部聊天记录，并依次重置所有成员在该群里的会话上下文。完成后界面会回到欢迎页。"
        confirmText="确认重置"
        confirmColor="bg-[var(--danger)] hover:brightness-110"
      />
    </section>
  );
}

const MemoGroupChatAreaInner = memo(GroupChatAreaInner);
MemoGroupChatAreaInner.displayName = "GroupChatAreaInner";

export function GroupChatArea({ group }: GroupChatAreaProps) {
  return <MemoGroupChatAreaInner key={group.id} group={group} />;
}
