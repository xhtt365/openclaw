"use client";

import { Archive, Clock3, Lock } from "lucide-react";
import { memo, useState } from "react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { cn } from "@/lib/utils";
import { type GroupArchive, type GroupChatMessage } from "@/stores/groupStore";

const AVATAR_COLORS = [
  "var(--color-avatar-1)",
  "var(--color-avatar-2)",
  "var(--color-avatar-3)",
  "var(--color-avatar-4)",
  "var(--color-avatar-5)",
  "var(--color-avatar-6)",
] as const;

type GroupArchiveChatAreaProps = {
  archive: GroupArchive;
};

function hashText(value: string) {
  return Array.from(value).reduce((total, char) => total + char.charCodeAt(0), 0);
}

function getAvatarColor(value: string) {
  return AVATAR_COLORS[hashText(value) % AVATAR_COLORS.length];
}

function readStoredAvatar() {
  if (typeof window === "undefined") {
    return null;
  }

  const value = window.localStorage.getItem("userAvatar");
  return value && value.trim() ? value : null;
}

function resolveArchiveSenderName(message: GroupChatMessage) {
  if (message.role === "user") {
    return "你";
  }

  if (message.senderName?.trim()) {
    return message.senderName.trim();
  }

  return "项目组成员";
}

function resolveArchiveAvatarText(message: GroupChatMessage) {
  if (message.role === "user") {
    return "你";
  }

  const senderName = resolveArchiveSenderName(message);
  return message.senderEmoji?.trim() || senderName.charAt(0).toUpperCase() || "#";
}

function GroupArchiveChatAreaInner({ archive }: GroupArchiveChatAreaProps) {
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [userAvatar] = useState<string | null>(() => readStoredAvatar());
  const archiveTime = new Date(archive.createdAt).toLocaleString("zh-CN");

  async function handleCopyMessage(message: GroupChatMessage) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === message.id ? null : current));
      }, 1000);
    } catch (error) {
      console.error("[Group] 复制归档消息失败:", error);
    }
  }

  function handleDownloadMessage(message: GroupChatMessage) {
    const blob = new Blob([message.content], { type: "text/plain;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${archive.groupName}-${message.id}.txt`;
    anchor.click();
    window.URL.revokeObjectURL(url);
    console.log(`[Group] 导出归档消息: ${archive.groupName}`);
  }

  function handleRefreshMessage(message: GroupChatMessage) {
    console.log(`[Group] 归档回看不支持刷新消息: ${message.id}`);
  }

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg-primary)]">
      <header className="flex h-[76px] items-center justify-between border-b border-white/[0.08] bg-[rgba(10,10,10,0.78)] px-6 backdrop-blur-2xl">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#475569,#1e293b)] text-white shadow-[0_14px_40px_rgba(15,23,42,0.3)]">
            <Archive className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[16px] font-semibold text-[var(--color-text-primary)]">
              {archive.groupName}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[var(--color-text-secondary)]">
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="h-3.5 w-3.5" />
                归档于 {archiveTime}
              </span>
              <span>{archive.messages.length} 条消息</span>
            </div>
          </div>
        </div>

        <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/15 bg-amber-500/[0.08] px-4 py-2 text-xs font-medium text-amber-100">
          <Lock className="h-3.5 w-3.5" />
          仅供回顾
        </div>
      </header>

      <div className="border-b border-white/[0.08] bg-[rgba(245,158,11,0.08)] px-6 py-3 backdrop-blur-2xl">
        <p className="text-sm text-amber-100">此为归档对话，仅供回顾查看，无法继续发送消息。</p>
      </div>

      <div className="im-scroll min-h-0 flex-1 overflow-y-auto px-6 py-8">
        {archive.messages.length > 0 ? (
          <div className="flex w-full flex-col gap-6">
            {archive.messages.map((message) => (
              <div key={message.id} className={cn("rounded-[22px] transition-all duration-200")}>
                <MessageBubble
                  message={message}
                  agentName={resolveArchiveSenderName(message)}
                  agentAvatarText={resolveArchiveAvatarText(message)}
                  agentAvatarColor={getAvatarColor(
                    message.senderId ?? resolveArchiveSenderName(message),
                  )}
                  agentAvatarUrl={message.senderAvatarUrl}
                  userAvatar={userAvatar}
                  isCopied={copiedMessageId === message.id}
                  isTyping={false}
                  onTypingComplete={() => {}}
                  onUserAvatarClick={() => {}}
                  onCopy={handleCopyMessage}
                  onDownload={handleDownloadMessage}
                  onRefresh={handleRefreshMessage}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-full items-center justify-center">
            <div className="w-full max-w-[560px] rounded-[28px] border border-white/[0.08] bg-white/[0.04] px-8 py-10 text-center shadow-[0_24px_70px_rgba(0,0,0,0.24)] backdrop-blur-2xl">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgba(255,255,255,0.06)] text-white">
                <Archive className="h-7 w-7" />
              </div>
              <h2 className="mt-5 text-xl font-semibold text-[var(--color-text-primary)]">
                这个归档里还没有消息
              </h2>
              <p className="mt-3 text-sm leading-7 text-[var(--color-text-secondary)]">
                当前归档只保留了项目组信息，没有可回看的聊天内容。
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-white/[0.08] bg-[rgba(10,10,14,0.84)] px-6 py-4 backdrop-blur-2xl">
        <div className="rounded-[22px] border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm text-[var(--color-text-secondary)] shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
          当前为归档回看模式。如需继续讨论，请从左侧重新进入项目组会话。
        </div>
      </div>
    </section>
  );
}

export const GroupArchiveChatArea = memo(GroupArchiveChatAreaInner);
GroupArchiveChatArea.displayName = "GroupArchiveChatArea";
