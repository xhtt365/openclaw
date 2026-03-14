"use client";

import { Archive, Minimize2, MoreVertical, RotateCcw, Send, Zap } from "lucide-react";
import { memo, type ChangeEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { GroupChatArea } from "@/components/chat/GroupChatArea";
import { MessageBubble } from "@/components/chat/MessageBubble";
import type { Employee } from "@/components/layout/EmployeeList";
import { useTheme } from "@/components/layout/useTheme";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { ContextRing } from "@/components/ui/ContextRing";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/agentStore";
import { useChatStore } from "@/stores/chatStore";
import type { Group } from "@/stores/groupStore";
import type { ChatMessage } from "@/utils/messageAdapter";

function HistoryDivider() {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="h-px flex-1 bg-[var(--color-border)]" />
      <span className="text-[11px] tracking-[0.18em] text-[var(--color-text-secondary)]">
        历史消息
      </span>
      <div className="h-px flex-1 bg-[var(--color-border)]" />
    </div>
  );
}

function formatAgentStatus(role: string, agentName: string) {
  if (role && role !== "AI 员工") {
    return role;
  }

  return `${agentName} Agent`;
}

const compactTokenFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatCompactTokens(value: number) {
  return compactTokenFormatter.format(Math.max(0, Math.floor(value)));
}

function readStoredAvatar() {
  if (typeof window === "undefined") {
    return null;
  }

  const value = window.localStorage.getItem("userAvatar");
  return value && value.trim() ? value : null;
}

interface ChatAreaProps {
  employee: Employee;
  group?: Group | null;
}

type SessionAction = "compact" | "archive" | "reset";
type ActionFeedback = {
  tone: "success" | "error";
  message: string;
};

function AgentChatArea({ employee }: Pick<ChatAreaProps, "employee">) {
  const { theme, toggleTheme } = useTheme();
  const currentAgentId = useAgentStore((state) => state.currentAgentId);
  const currentAgent = useAgentStore((state) =>
    state.agents.find((agent) => agent.id === state.currentAgentId),
  );
  const activeAgentId = currentAgentId || employee.id;
  const messages = useChatStore((state) => state.getMessagesForAgent(activeAgentId));
  const sendMessage = useChatStore((state) => state.sendMessage);
  const compactCurrentSession = useChatStore((state) => state.compactCurrentSession);
  const archiveCurrentSession = useChatStore((state) => state.archiveCurrentSession);
  const resetCurrentSession = useChatStore((state) => state.resetCurrentSession);
  const sessionUsage = useChatStore((state) => state.getUsageForAgent(activeAgentId));
  const contextWindowSize = useChatStore((state) =>
    state.getContextWindowSizeForAgent(activeAgentId),
  );
  const currentContextUsed = useChatStore((state) =>
    state.getCurrentContextUsedForAgent(activeAgentId),
  );
  const isWaiting = useChatStore((state) => state.isSendingForAgent(activeAgentId));
  const isHistoryLoading = useChatStore((state) => state.isHistoryLoadingForAgent(activeAgentId));
  const isAnySending = useChatStore((state) => state.isAnySending());

  const visibleMessages = messages.filter((message) => !message.isLoading);
  const firstNewMessageIndex = visibleMessages.findIndex((message) => message.isNew);
  const shouldShowHistoryDivider =
    firstNewMessageIndex > 0 &&
    visibleMessages.slice(0, firstNewMessageIndex).some((message) => !message.isNew);
  const agentName = currentAgent?.name ?? employee.name;
  const agentAvatarText =
    currentAgent?.emoji?.trim() || employee.emoji || employee.avatarText || agentName.charAt(0);
  const agentAvatarUrl = currentAgent?.avatarUrl ?? employee.avatarUrl;
  const agentRole = formatAgentStatus(employee.role, agentName);
  const sessionCacheTokens = sessionUsage.cacheRead + sessionUsage.cacheWrite;
  const contextIndicatorLabel =
    contextWindowSize > 0
      ? `${formatCompactTokens(currentContextUsed)}/${formatCompactTokens(contextWindowSize)}`
      : formatCompactTokens(currentContextUsed);

  const [input, setInput] = useState("");
  const [typingMessageId, setTypingMessageId] = useState<string | null>(null);
  const [userAvatar, setUserAvatar] = useState<string | null>(() => readStoredAvatar());
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const [isCompactModalOpen, setIsCompactModalOpen] = useState(false);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isArchiveUnavailable, setIsArchiveUnavailable] = useState(false);
  const [isCompactLoading, setIsCompactLoading] = useState(false);
  const [isArchiveLoading, setIsArchiveLoading] = useState(false);
  const [isResetLoading, setIsResetLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const seenAssistantMessageIdsRef = useRef<Set<string>>(new Set());
  const didInitHistoryRef = useRef(false);
  const copyTimerRef = useRef<number | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

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
    seenAssistantMessageIdsRef.current = new Set();
    didInitHistoryRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      setTypingMessageId(null);
      setInput("");
      setActionFeedback(null);
      setIsCompactModalOpen(false);
      setIsArchiveModalOpen(false);
      setIsResetModalOpen(false);
      setIsCompactLoading(false);
      setIsArchiveLoading(false);
      setIsResetLoading(false);

      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    });

    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [currentAgentId]);

  useEffect(() => {
    const assistantMessages = messages.filter(
      (message) => message.role === "assistant" && !message.isLoading,
    );
    if (!didInitHistoryRef.current) {
      assistantMessages.forEach((message) => {
        seenAssistantMessageIdsRef.current.add(message.id);
      });
      didInitHistoryRef.current = true;
      return;
    }

    const newAssistantMessages = assistantMessages.filter(
      (message) => message.isNew && !seenAssistantMessageIdsRef.current.has(message.id),
    );
    if (newAssistantMessages.length === 0) {
      return;
    }

    newAssistantMessages.forEach((message) => {
      seenAssistantMessageIdsRef.current.add(message.id);
    });
    setTypingMessageId(newAssistantMessages[newAssistantMessages.length - 1].id);
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isHistoryLoading, isWaiting, typingMessageId]);

  function autoResize() {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    const maxHeight = 3 * 24 + 24;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }

  async function handleSendMessage() {
    const text = input.trim();
    if (!text || isWaiting) {
      return;
    }

    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    await sendMessage(text);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSendMessage();
    }
  }

  function handleThemeToggle() {
    toggleTheme();
    console.log("[UI] 主题切换");
  }

  function handleMoreClick() {
    console.log("[UI] 更多菜单");
  }

  function showActionFeedback(tone: ActionFeedback["tone"], message: string) {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }

    setActionFeedback({ tone, message });
    feedbackTimerRef.current = window.setTimeout(() => {
      setActionFeedback((current) => (current?.message === message ? null : current));
    }, 3200);
  }

  async function handleCompactConfirm() {
    setIsCompactLoading(true);
    const result = await compactCurrentSession();
    setIsCompactLoading(false);

    if (result.success) {
      setIsCompactModalOpen(false);
      const releasedTokens = typeof result.releasedTokens === "number" ? result.releasedTokens : 0;
      showActionFeedback(
        "success",
        releasedTokens > 0
          ? `已释放 ${new Intl.NumberFormat("en-US").format(releasedTokens)} tokens`
          : "压缩已执行，但当前上下文变化很小或无需继续压缩。",
      );
      return;
    }

    console.error("[UI] 压缩失败:", result.error);
    showActionFeedback("error", result.error || "压缩失败，请稍后重试。");
  }

  async function handleArchiveConfirm() {
    setIsArchiveLoading(true);
    const result = await archiveCurrentSession();
    setIsArchiveLoading(false);

    if (result.success) {
      setIsArchiveModalOpen(false);
      showActionFeedback("success", "当前对话已归档，界面已切回空白会话。");
      return;
    }

    console.error("[UI] 归档失败:", result.error);
    if (
      (result.error || "").includes("webchat clients cannot delete sessions") ||
      (result.error || "").includes("control ui requires device identity")
    ) {
      setIsArchiveModalOpen(false);
      setIsArchiveUnavailable(true);
      showActionFeedback("error", "当前连接没有归档权限，已切换为禁用态。");
      return;
    }
    showActionFeedback("error", result.error || "归档失败，请稍后重试。");
  }

  async function handleResetConfirm() {
    setIsResetLoading(true);
    const result = await resetCurrentSession();
    setIsResetLoading(false);

    if (result.success) {
      setIsResetModalOpen(false);
      showActionFeedback("success", "当前对话已重置，消息与 Token 已清空。");
      return;
    }

    console.error("[UI] 重置失败:", result.error);
    showActionFeedback("error", result.error || "重置失败，请稍后重试。");
  }

  async function handleCopyMessage(message: ChatMessage) {
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
      console.error("[UI] 复制消息失败:", error);
    }
  }

  function handleDownloadMessage(message: ChatMessage) {
    console.log(`[UI] 下载消息: ${message.id}`);
  }

  function handleRefreshMessage(message: ChatMessage) {
    console.log(`[UI] 刷新消息: ${message.id}`);
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
        console.error("[UI] 用户头像读取失败: empty result");
        return;
      }

      window.localStorage.setItem("userAvatar", reader.result);
      setUserAvatar(reader.result);
      console.log("[UI] 用户头像已更新");
    });
    reader.addEventListener("error", () => {
      console.error("[UI] 用户头像读取失败:", reader.error);
    });
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  const isSessionActionLoading = isCompactLoading || isArchiveLoading || isResetLoading;
  const isSessionActionDisabled = !currentAgentId || isSessionActionLoading;
  const archiveDisabledReason = !currentAgentId
    ? "请先选择 Agent"
    : isArchiveUnavailable
      ? "需要 Control 权限"
      : undefined;
  const sessionActions: Array<{
    id: SessionAction;
    label: string;
    icon: typeof Minimize2;
    buttonClassName: string;
    onClick: () => void;
    disabled?: boolean;
    title?: string;
  }> = [
    {
      id: "compact",
      label: "压缩",
      icon: Minimize2,
      buttonClassName:
        "bg-orange-500 hover:bg-orange-400 focus-visible:ring-orange-300/70 dark:focus-visible:ring-orange-200/50",
      onClick: () => setIsCompactModalOpen(true),
    },
    {
      id: "archive",
      label: "归档",
      icon: Archive,
      buttonClassName:
        "bg-blue-600 hover:bg-blue-500 focus-visible:ring-blue-300/70 dark:focus-visible:ring-blue-200/50",
      onClick: () => setIsArchiveModalOpen(true),
      disabled: isArchiveUnavailable,
      title: archiveDisabledReason,
    },
    {
      id: "reset",
      label: "重置",
      icon: RotateCcw,
      buttonClassName:
        "bg-purple-600 hover:bg-purple-500 focus-visible:ring-purple-300/70 dark:focus-visible:ring-purple-200/50",
      onClick: () => setIsResetModalOpen(true),
    },
  ];

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg-primary)]">
      <header className="flex h-[60px] items-center justify-between border-b border-[var(--color-border)] px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative">
            {agentAvatarUrl ? (
              <img
                alt={agentName}
                className="h-9 w-9 rounded-full object-cover"
                src={agentAvatarUrl}
              />
            ) : (
              <div
                className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-[var(--color-text-on-brand)]"
                style={{ backgroundColor: employee.avatarColor }}
              >
                {agentAvatarText}
              </div>
            )}
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-[var(--color-bg-primary)] bg-[var(--color-online)]" />
          </div>

          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-[var(--color-text-primary)]">
              {agentName}
            </div>
            <div className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">
              {agentRole}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleThemeToggle}
            className={cn(
              "group/toggle relative flex h-8 w-14 items-center rounded-full px-1 transition-all duration-150 hover:opacity-100",
              theme === "dark" ? "bg-[var(--color-brand)]" : "bg-[var(--color-bg-hover)]",
            )}
            style={{ opacity: 0.75 }}
            aria-label="主题切换"
            aria-checked={theme === "dark"}
            role="switch"
          >
            <span
              className="h-6 w-6 rounded-full bg-[var(--color-bg-card)] shadow-[0_4px_14px_var(--color-shadow-card)] transition-transform duration-[250ms]"
              style={{
                transform: theme === "dark" ? "translateX(24px)" : "translateX(0)",
              }}
            />
          </button>

          <button
            type="button"
            onClick={handleMoreClick}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-opacity duration-150 hover:opacity-100 hover:text-[var(--color-text-primary)]"
            style={{ opacity: 0.6 }}
            aria-label="更多菜单"
          >
            <MoreVertical className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="im-scroll min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="flex w-full flex-col gap-6">
          {visibleMessages.map((message, index) => (
            <div key={message.id} className="space-y-4">
              {shouldShowHistoryDivider && index === firstNewMessageIndex ? (
                <HistoryDivider />
              ) : null}
              <MessageBubble
                agentAvatarColor={employee.avatarColor}
                agentAvatarText={agentAvatarText}
                agentAvatarUrl={agentAvatarUrl}
                agentName={agentName}
                isCopied={copiedMessageId === message.id}
                isTyping={typingMessageId === message.id}
                message={message}
                onCopy={handleCopyMessage}
                onDownload={handleDownloadMessage}
                onRefresh={handleRefreshMessage}
                onTypingComplete={() => {
                  setTypingMessageId((current) => (current === message.id ? null : current));
                }}
                onUserAvatarClick={handleAvatarTrigger}
                userAvatar={userAvatar}
              />
            </div>
          ))}

          {isHistoryLoading && visibleMessages.length === 0 ? (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
              正在加载历史消息...
            </div>
          ) : null}

          {!isHistoryLoading && !isWaiting && visibleMessages.length === 0 ? (
            <div className="pt-16 text-center text-sm text-[var(--color-text-secondary)]">
              还没有聊天记录，先和 {agentName} 打个招呼。
            </div>
          ) : null}

          {isWaiting ? (
            <div className="flex justify-start">
              <div className="inline-flex items-center gap-2 rounded-full bg-[var(--color-bg-card)] px-3 py-1.5 text-xs text-[var(--color-brand-light)]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-brand)]" />
                思考中...
              </div>
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>
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
              {sessionActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={action.onClick}
                    disabled={isSessionActionDisabled || action.disabled}
                    title={action.title}
                    className={cn(
                      "inline-flex h-11 items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.18)] transition-all duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900",
                      "hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100",
                      action.buttonClassName,
                    )}
                  >
                    <Icon className="h-4 w-4 text-white" />
                    <span className="text-white">{action.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <ContextRing
                cacheHitTokens={sessionCacheTokens}
                currentUsed={currentContextUsed}
                inputTokens={sessionUsage.input}
                outputTokens={sessionUsage.output}
                total={contextWindowSize}
                totalConsumed={sessionUsage.totalTokens}
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

          <div className="flex items-end gap-3 rounded-[10px] border border-gray-200 bg-gray-50 px-4 py-2 transition-[border-color,box-shadow] duration-[250ms] focus-within:border-amber-400 focus-within:ring-1 focus-within:ring-amber-300/60 dark:border-zinc-700 dark:bg-zinc-800 dark:focus-within:border-amber-300 dark:focus-within:ring-amber-300/30">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                autoResize();
              }}
              onKeyDown={handleKeyDown}
              placeholder="输入消息，/ 查看快捷指令"
              rows={1}
              className="min-h-7 max-h-24 flex-1 resize-none bg-transparent py-1 text-sm leading-6 text-gray-800 outline-none placeholder:text-gray-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
            <button
              type="button"
              onClick={() => {
                void handleSendMessage();
              }}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-full bg-orange-400 text-white transition-all duration-200 hover:bg-orange-500 dark:bg-orange-500 dark:hover:bg-orange-400",
                isWaiting
                  ? "animate-[spin_1s_linear_infinite]"
                  : "hover:scale-110 hover:shadow-[0_0_20px_var(--color-brand-glow)] active:scale-90",
                input.trim().length === 0 || isAnySending || isHistoryLoading || !currentAgentId
                  ? "cursor-not-allowed opacity-50"
                  : "",
              )}
              aria-label="发送消息"
              disabled={
                input.trim().length === 0 || isAnySending || isHistoryLoading || !currentAgentId
              }
            >
              {isWaiting ? <Zap className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            </button>
          </div>

          <p className="mt-2 text-center text-[10px] text-gray-500 dark:text-zinc-400">
            按 Enter 发送，Shift + Enter 换行
          </p>
        </div>
      </div>

      <ConfirmModal
        open={isCompactModalOpen}
        onClose={() => setIsCompactModalOpen(false)}
        onConfirm={() => {
          void handleCompactConfirm();
        }}
        loading={isCompactLoading}
        icon="✨"
        iconBgColor="bg-orange-500/20 dark:bg-orange-500/15"
        iconTextColor="text-orange-500 dark:text-orange-300"
        title="压缩上下文"
        subtitle="精简对话历史"
        description="AI 将总结当前对话的核心内容，压缩冗余信息，保留关键上下文，让对话更加高效流畅。"
        confirmText="开始压缩"
        confirmColor="bg-orange-500 hover:bg-orange-400"
      />

      <ConfirmModal
        open={isArchiveModalOpen}
        onClose={() => setIsArchiveModalOpen(false)}
        onConfirm={() => {
          void handleArchiveConfirm();
        }}
        loading={isArchiveLoading}
        icon="📦"
        iconBgColor="bg-blue-500/20 dark:bg-blue-500/15"
        iconTextColor="text-blue-500 dark:text-blue-300"
        title="归档对话"
        subtitle="保存历史，释放空间"
        description="当前对话将被存档，聊天界面清空并开启新会话。归档文件保留在本地磁盘，不会丢失。"
        confirmText="确认归档"
        confirmColor="bg-blue-600 hover:bg-blue-500"
      />

      <ConfirmModal
        open={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        onConfirm={() => {
          void handleResetConfirm();
        }}
        loading={isResetLoading}
        icon="🔄"
        iconBgColor="bg-purple-500/20"
        iconTextColor="text-purple-400"
        title="重置对话"
        subtitle="清空消息，释放上下文"
        description="将清空当前对话的所有消息，并重置 AI 的上下文记忆。这会释放 Token 空间，但 AI 将无法回忆之前的对话内容。"
        confirmText="确认重置"
        confirmColor="bg-purple-600 hover:bg-purple-500"
      />
    </section>
  );
}

const MemoAgentChatArea = memo(AgentChatArea);
MemoAgentChatArea.displayName = "AgentChatArea";

function ChatAreaInner({ employee, group }: ChatAreaProps) {
  if (group) {
    return <GroupChatArea key={group.id} group={group} />;
  }

  return <MemoAgentChatArea employee={employee} />;
}

export const ChatArea = memo(ChatAreaInner);
ChatArea.displayName = "ChatArea";
