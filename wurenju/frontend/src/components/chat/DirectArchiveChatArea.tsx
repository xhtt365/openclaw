"use client";

import { Archive, Clock3, Lock } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { ThemeToggle } from "@/components/chat/components/theme-toggle";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { UserProfilePopover } from "@/components/chat/UserProfilePopover";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/agentStore";
import { useDirectArchiveStore } from "@/stores/directArchiveStore";
import { useGroupStore } from "@/stores/groupStore";
import type { SidebarDirectArchive } from "@/utils/sidebarPersistence";
import { getUserProfile, subscribeToUserProfile } from "@/utils/userProfile";

const AVATAR_COLORS = [
  "var(--color-avatar-1)",
  "var(--color-avatar-2)",
  "var(--color-avatar-3)",
  "var(--color-avatar-4)",
  "var(--color-avatar-5)",
  "var(--color-avatar-6)",
] as const;

type DirectArchiveChatAreaProps = {
  archive: SidebarDirectArchive;
};

function readTrimmedText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRenderableArchiveMessage(
  message: unknown,
): message is SidebarDirectArchive["messages"][number] {
  if (!message || typeof message !== "object") {
    return false;
  }

  const candidate = message as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    (candidate.role === "user" || candidate.role === "assistant") &&
    typeof candidate.content === "string"
  );
}

function formatArchiveTimeLabel(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return "时间未知";
  }

  return new Date(timestamp).toLocaleString("zh-CN");
}

function hashText(value: string) {
  return Array.from(value).reduce((total, char) => total + char.charCodeAt(0), 0);
}

function getAvatarColor(value: string) {
  return AVATAR_COLORS[hashText(value) % AVATAR_COLORS.length];
}

function resolveArchiveAvatarText(archive: SidebarDirectArchive) {
  return (
    readTrimmedText(archive.agentEmoji) ||
    readTrimmedText(archive.agentAvatarText) ||
    readTrimmedText(archive.agentName).charAt(0).toUpperCase() ||
    "A"
  );
}

function DirectArchiveChatAreaInner({ archive }: DirectArchiveChatAreaProps) {
  const openDetail = useAgentStore((state) => state.openDetail);
  const clearSelectedGroup = useGroupStore((state) => state.clearSelectedGroup);
  const clearSelectedArchive = useGroupStore((state) => state.clearSelectedArchive);
  const clearSelectedDirectArchive = useDirectArchiveStore(
    (state) => state.clearSelectedDirectArchive,
  );
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState(() => getUserProfile());
  const [popoverAnchorRect, setPopoverAnchorRect] = useState<DOMRect | null>(null);
  const archiveTitle =
    readTrimmedText(archive.title) || readTrimmedText(archive.agentName) || "1v1 归档";
  const archiveName = readTrimmedText(archive.agentName) || "1v1 归档";
  const archiveRole = readTrimmedText(archive.agentRole);
  const archiveMessages = Array.isArray(archive.messages)
    ? archive.messages.filter(isRenderableArchiveMessage)
    : [];
  const archiveTime = formatArchiveTimeLabel(readTrimmedText(archive.archivedAt));

  useEffect(() => subscribeToUserProfile(setUserProfile), []);

  async function handleCopyMessage(messageId: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === messageId ? null : current));
      }, 1000);
    } catch (error) {
      console.error("[Archive] 复制 1v1 归档消息失败:", error);
    }
  }

  function handleDownloadMessage(messageId: string, content: string) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${archiveTitle}-${messageId}.txt`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  }

  function handleOpenAgentDetail(agentId: string) {
    clearSelectedGroup();
    clearSelectedArchive();
    clearSelectedDirectArchive();
    void openDetail(agentId);
  }

  return (
    <section className="group-chat-shell">
      <div className="group-chat-card">
        <header className="group-archive-header">
          <div className="group-chat-header__left">
            <div
              className="group-chat-header__icon"
              style={{ background: "linear-gradient(135deg, var(--info), var(--accent-2))" }}
            >
              <Archive className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="group-chat-header__title truncate">{archiveTitle}</div>
              <div className="group-chat-header__subtitle mt-1 flex flex-wrap items-center gap-3">
                <span>{archiveName}</span>
                {archiveRole ? <span>{archiveRole}</span> : null}
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5" />
                  归档于 {archiveTime}
                </span>
                <span>{archiveMessages.length} 条消息</span>
              </div>
            </div>
          </div>

          <div className="group-chat-header__actions">
            <ThemeToggle />
            <div className="group-chat-pill group-chat-pill--active">
              <Lock className="h-3.5 w-3.5" />
              仅供回顾
            </div>
          </div>
        </header>

        <div className="group-archive-banner">
          <p>此为 1v1 归档对话，仅供回顾查看，无法继续发送消息。</p>
        </div>

        <div className="chat-thread im-scroll">
          {archiveMessages.length > 0 ? (
            <div className="flex w-full flex-col gap-6">
              {archiveMessages.map((message) => (
                <div key={message.id} className={cn("rounded-[22px] transition-all duration-200")}>
                  <MessageBubble
                    message={message}
                    agentId={readTrimmedText(archive.agentId) || undefined}
                    agentName={archiveName}
                    agentAvatarText={resolveArchiveAvatarText(archive)}
                    agentAvatarColor={getAvatarColor(
                      readTrimmedText(archive.agentId) || archiveName,
                    )}
                    agentAvatarUrl={archive.agentAvatarUrl}
                    userAvatar={userProfile.avatar}
                    userProfile={userProfile}
                    isCopied={copiedMessageId === message.id}
                    isTyping={false}
                    onTypingComplete={() => {}}
                    onUserAvatarClick={(target) => {
                      setPopoverAnchorRect(target.getBoundingClientRect());
                    }}
                    onAgentAvatarClick={(agentId) => {
                      handleOpenAgentDetail(agentId);
                    }}
                    onCopy={(currentMessage) => {
                      void handleCopyMessage(currentMessage.id, currentMessage.content);
                    }}
                    onDownload={(currentMessage) => {
                      handleDownloadMessage(currentMessage.id, currentMessage.content);
                    }}
                    onRefresh={(currentMessage) => {
                      console.log(`[Archive] 1v1 归档回看不支持刷新消息: ${currentMessage.id}`);
                    }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="chat-empty-state min-h-full items-center">
              <div className="chat-empty-state__body w-full max-w-[560px] px-8 py-10">
                <div
                  className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-[var(--accent-foreground)]"
                  style={{ background: "linear-gradient(135deg, var(--info), var(--accent-2))" }}
                >
                  <Archive className="h-7 w-7" />
                </div>
                <h2 className="mt-5 text-xl font-semibold text-[var(--text-strong)]">
                  这个 1v1 归档里还没有消息
                </h2>
                <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
                  当前归档只保留了会话信息，没有可回看的聊天内容。
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="group-chat-compose pt-4">
          <div className="group-archive-note">
            当前为 1v1 归档回看模式。如需继续对话，请从左侧重新进入对应员工的会话。
          </div>
        </div>

        <UserProfilePopover
          open={popoverAnchorRect !== null}
          anchorRect={popoverAnchorRect}
          onClose={() => {
            setPopoverAnchorRect(null);
          }}
        />
      </div>
    </section>
  );
}

export const DirectArchiveChatArea = memo(DirectArchiveChatAreaInner);
DirectArchiveChatArea.displayName = "DirectArchiveChatArea";
