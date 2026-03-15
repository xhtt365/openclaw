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
import { memo, type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { GroupChatHeader } from "@/components/chat/GroupChatHeader";
import { GroupMentionPopover } from "@/components/chat/GroupMentionPopover";
import { GroupThinkingStatus } from "@/components/chat/GroupThinkingStatus";
import { GroupWelcomeView } from "@/components/chat/GroupWelcomeView";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { matchesMessageSearch } from "@/components/chat/messageSearch";
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
  type AgentInfo,
  type Group,
  type GroupChatMessage,
  type ThinkingAgent,
} from "@/stores/groupStore";
import { resolveDisplayAgentMembers } from "@/utils/groupMembers";
import {
  findActiveGroupMention,
  insertGroupMention,
  matchesGroupMentionQuery,
  type GroupMentionMatch,
} from "@/utils/groupMention";
import { buildGroupExportFilename, formatGroupTranscript } from "@/utils/groupTranscript";

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

function readStoredAvatar() {
  if (typeof window === "undefined") {
    return null;
  }

  const value = window.localStorage.getItem("userAvatar");
  return value && value.trim() ? value : null;
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
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 items-center rounded-md border border-gray-200/80 bg-white px-2.5 text-[12px] font-medium text-gray-500 transition-all duration-150 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-orange-400/30 dark:hover:bg-orange-500/10 dark:hover:text-orange-200"
    >
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
  const [userAvatar, setUserAvatar] = useState<string | null>(() => readStoredAvatar());
  const [caretPosition, setCaretPosition] = useState(0);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [dismissedMentionSignature, setDismissedMentionSignature] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const messageElementRefs = useRef(new Map<string, HTMLDivElement>());
  const hasInitializedNotificationRef = useRef(false);
  const seenAssistantMessageIdsRef = useRef(new Set<string>());
  const copyTimerRef = useRef<number | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

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
  const activeMention = useMemo(
    () => findActiveGroupMention(input, caretPosition),
    [caretPosition, input],
  );
  const activeMentionSignature = activeMention
    ? `${activeMention.start}:${activeMention.end}:${activeMention.query}`
    : null;
  const mentionCandidates = useMemo(() => {
    if (!activeMention) {
      return [] as AgentInfo[];
    }

    return agentMembers.filter((member) =>
      matchesGroupMentionQuery(member.name, activeMention.query),
    );
  }, [activeMention, agentMembers]);
  const normalizedMentionIndex =
    mentionCandidates.length > 0 ? Math.min(activeMentionIndex, mentionCandidates.length - 1) : -1;
  const highlightedMention =
    normalizedMentionIndex >= 0 ? mentionCandidates[normalizedMentionIndex] : null;
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
  // Esc 关闭后，只有当用户继续编辑成新的 @ 片段时，浮层才会再次出现。
  const isMentionPopoverOpen =
    isInputFocused &&
    activeMention !== null &&
    dismissedMentionSignature !== activeMentionSignature;

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

  function insertMention(name: string, mentionMatch: GroupMentionMatch | null = null) {
    const textarea = textareaRef.current;
    const fallbackCaret = textarea?.selectionStart ?? caretPosition;
    const nextMention = insertGroupMention(input, name, mentionMatch, fallbackCaret);

    setInput(nextMention.value);
    setCaretPosition(nextMention.caret);
    setDismissedMentionSignature(null);
    setActiveMentionIndex(0);

    window.requestAnimationFrame(() => {
      textarea?.focus();
      if (textarea) {
        textarea.setSelectionRange(nextMention.caret, nextMention.caret);
      }
      autoResize();
    });

    console.log(`[Group] 插入成员提及: @${name}`);
  }

  function closeMentionPopover() {
    if (!activeMentionSignature) {
      return;
    }

    setDismissedMentionSignature(activeMentionSignature);
    setActiveMentionIndex(0);
    console.log("[Group] 已关闭 @ 成员浮层");
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

    void sendGroupMessage(group.id, text);
    setInput("");
    setCaretPosition(0);
    setActiveMentionIndex(0);
    setDismissedMentionSignature(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
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

  function handleAvatarTrigger() {
    avatarInputRef.current?.click();
  }

  function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string" || !reader.result.trim()) {
        console.error("[Group] 用户头像读取失败: empty result");
        return;
      }

      try {
        window.localStorage.setItem("userAvatar", reader.result);
        setUserAvatar(reader.result);
        console.log("[Group] 用户头像已更新");
      } catch (error) {
        console.error("[Group] 保存用户头像失败:", error);
      }
    });
    reader.addEventListener("error", () => {
      console.error("[Group] 用户头像读取失败:", reader.error);
    });
    reader.readAsDataURL(file);
    event.target.value = "";
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
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [isSending, messages.length, thinkingAgents.length]);

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
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg-primary)]">
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
        <div className="border-b border-white/[0.08] bg-[rgba(10,10,14,0.86)] px-6 py-4 backdrop-blur-2xl">
          <div className="flex items-center gap-3 rounded-[20px] border border-white/[0.08] bg-white/[0.04] px-4 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
            <Search className="h-4 w-4 shrink-0 text-amber-200" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
              }}
              placeholder="搜索群聊历史消息"
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]"
            />

            <span className="shrink-0 text-xs tabular-nums text-[var(--color-text-secondary)]">
              {trimmedSearchQuery
                ? matchedMessageIds.length > 0
                  ? `${normalizedSearchIndex + 1}/${matchedMessageIds.length}`
                  : "0/0"
                : `${messages.length} 条消息`}
            </span>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  handleSearchStep("prev");
                }}
                disabled={matchedMessageIds.length === 0}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-[var(--color-text-secondary)] transition-all duration-200 hover:border-white/[0.14] hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
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
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-[var(--color-text-secondary)] transition-all duration-200 hover:border-white/[0.14] hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                aria-label="下一条搜索结果"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={closeSearchPanel}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-[var(--color-text-secondary)] transition-all duration-200 hover:border-white/[0.14] hover:bg-white/[0.08] hover:text-white"
                aria-label="关闭搜索"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
            {trimmedSearchQuery
              ? matchedMessageIds.length > 0
                ? `找到 ${matchedMessageIds.length} 条匹配消息，已自动高亮`
                : "没有找到匹配消息"
              : "输入关键词后会高亮命中消息"}
          </p>
        </div>
      ) : null}

      <div className="im-scroll min-h-0 flex-1 overflow-y-auto px-6 py-8">
        {hasMessages ? (
          <div className="flex w-full flex-col gap-6">
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
                    isSearchHit ? "ring-1 ring-amber-300/22" : "",
                    isSearchActive ? "bg-amber-400/[0.06] ring-2 ring-amber-300/50" : "",
                  )}
                >
                  <MessageBubble
                    key={message.id}
                    message={message}
                    agentName={resolveAgentName(message, group)}
                    agentAvatarText={resolveAgentAvatarText(message, group)}
                    agentAvatarColor={getAvatarColor(
                      message.senderId ?? resolveAgentName(message, group),
                    )}
                    agentAvatarUrl={message.senderAvatarUrl}
                    userAvatar={userAvatar}
                    isCopied={copiedMessageId === message.id}
                    isTyping={false}
                    onTypingComplete={() => {}}
                    onUserAvatarClick={handleAvatarTrigger}
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
          </div>
        ) : (
          <GroupWelcomeView group={group} onMention={insertMention} />
        )}
      </div>

      <div className="shrink-0 border-t border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        <div className="relative px-4 pb-4 pt-4">
          {actionFeedback ? (
            <div className="pointer-events-none absolute right-4 top-1 z-10">
              <span
                className={cn(
                  "inline-flex rounded-full border px-3 py-1 text-[11px] font-medium shadow-[0_12px_32px_rgba(0,0,0,0.26)] backdrop-blur-sm",
                  actionFeedback.tone === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/15 dark:text-emerald-100"
                    : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/15 dark:text-rose-100",
                )}
              >
                {actionFeedback.message}
              </span>
            </div>
          ) : null}

          <div className="flex items-center gap-3 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={handleExportHistory}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.18)] transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
                disabled={!hasMessages || isArchiveLoading || isResetLoading}
              >
                <Download className="h-4 w-4 text-white" />
                导出
              </button>
              <button
                type="button"
                onClick={() => {
                  console.log(`[Group] 打开归档确认弹窗: ${group.name}`);
                  setIsArchiveConfirmOpen(true);
                }}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.18)] transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
                disabled={!hasMessages || isArchiveLoading || isResetLoading}
              >
                <Archive className="h-4 w-4 text-white" />
                归档
              </button>
              <button
                type="button"
                onClick={() => {
                  console.log(`[Group] 打开重置对话确认弹窗: ${group.name}`);
                  setIsResetConfirmOpen(true);
                }}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.18)] transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
                disabled={!hasMessages || isArchiveLoading || isResetLoading}
              >
                <RotateCcw className="h-4 w-4 text-white" />
                重置
              </button>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <ContextRing
                currentUsed={metrics.currentUsed}
                total={metrics.total}
                inputTokens={metrics.inputTokens}
                outputTokens={metrics.outputTokens}
                cacheHitTokens={metrics.cacheHitTokens}
                totalConsumed={metrics.totalConsumed}
              />
              <span className="text-xs font-medium tabular-nums text-gray-600 dark:text-zinc-300">
                {contextIndicatorLabel}
              </span>
            </div>
          </div>

          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarChange}
          />

          <div className="relative">
            <GroupMentionPopover
              open={isMentionPopoverOpen}
              members={mentionCandidates}
              activeIndex={normalizedMentionIndex}
              query={activeMention?.query ?? ""}
              onSelect={(member) => {
                insertMention(member.name, activeMention);
              }}
              onActiveIndexChange={setActiveMentionIndex}
            />

            <div className="rounded-[10px] border border-gray-200 bg-gray-50 px-4 py-2 transition-[border-color,box-shadow] duration-[250ms] focus-within:border-amber-400 focus-within:ring-1 focus-within:ring-amber-300/60 dark:border-zinc-700 dark:bg-zinc-800 dark:focus-within:border-amber-300 dark:focus-within:ring-amber-300/30">
              <div className="flex items-end gap-3">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(event) => {
                    setInput(event.target.value);
                    syncCaretPosition(event.target.selectionStart ?? event.target.value.length);
                    setDismissedMentionSignature(null);
                    autoResize();
                  }}
                  onFocus={() => {
                    setIsInputFocused(true);
                    syncCaretPosition();
                  }}
                  onBlur={() => {
                    setIsInputFocused(false);
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

                    if (isMentionPopoverOpen && event.key === "Escape") {
                      event.preventDefault();
                      closeMentionPopover();
                      return;
                    }

                    if (isMentionPopoverOpen && mentionCandidates.length > 0) {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setActiveMentionIndex(
                          (current) => (current + 1) % mentionCandidates.length,
                        );
                        return;
                      }

                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setActiveMentionIndex((current) =>
                          current <= 0 ? mentionCandidates.length - 1 : current - 1,
                        );
                        return;
                      }

                      if (
                        event.key === "Enter" &&
                        !event.shiftKey &&
                        highlightedMention &&
                        activeMention
                      ) {
                        event.preventDefault();
                        insertMention(highlightedMention.name, activeMention);
                        return;
                      }
                    }

                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="输入消息... 使用 @ 提及成员"
                  rows={1}
                  className="min-h-7 max-h-24 flex-1 resize-none bg-transparent py-1 text-sm leading-6 text-gray-800 outline-none placeholder:text-gray-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />

                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!input.trim() || isSending}
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-400 text-white transition-all duration-200 hover:bg-orange-500 dark:bg-orange-500 dark:hover:bg-orange-400",
                    isSending
                      ? "animate-[spin_1s_linear_infinite]"
                      : "hover:scale-110 hover:shadow-[0_0_20px_var(--color-brand-glow)] active:scale-90",
                    input.trim() ? "" : "cursor-not-allowed opacity-50",
                  )}
                  aria-label="发送群消息"
                >
                  {isSending ? <Zap className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-200/80 pt-3 text-[11px] text-gray-400 dark:border-zinc-700 dark:text-zinc-500">
                <span className="font-medium">提及:</span>
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

          <p className="mt-2 text-center text-[10px] text-gray-500 dark:text-zinc-400">
            按 Enter 发送，Shift + Enter 换行
          </p>
        </div>
      </div>

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
        iconBgColor="bg-blue-500/20"
        iconTextColor="text-blue-300"
        title="归档群聊对话"
        subtitle="保存聊天记录并重置当前 session"
        description="确认后会保存当前项目组的完整聊天记录到本地归档，并重置全部成员在该群里的 session。完成后消息流会回到欢迎页。"
        confirmText="确认归档"
        confirmColor="bg-blue-600 hover:bg-blue-500"
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
        iconBgColor="bg-purple-500/20"
        iconTextColor="text-purple-300"
        title="重置群聊对话"
        subtitle="清空消息并重置全部成员 session"
        description="确认后会清空当前项目组的全部聊天记录，并依次重置所有成员在该群里的会话上下文。完成后界面会回到欢迎页。"
        confirmText="确认重置"
        confirmColor="bg-purple-600 hover:bg-purple-500"
      />
    </section>
  );
}

const MemoGroupChatAreaInner = memo(GroupChatAreaInner);
MemoGroupChatAreaInner.displayName = "GroupChatAreaInner";

export function GroupChatArea({ group }: GroupChatAreaProps) {
  return <MemoGroupChatAreaInner key={group.id} group={group} />;
}
