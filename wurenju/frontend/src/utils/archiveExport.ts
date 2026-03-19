"use client";

import type { GroupArchive, GroupChatMessage } from "@/stores/groupStore";
import {
  formatArchiveFileDate,
  formatArchiveTitleDate,
  sanitizeArchiveTitle,
} from "@/utils/archiveTitle";
import type { ChatMessage } from "@/utils/messageAdapter";
import type { SidebarDirectArchive } from "@/utils/sidebarPersistence";

type ExportableMessage = Pick<ChatMessage, "content" | "role" | "timestamp" | "timestampLabel"> & {
  senderName?: string;
};

function resolveSafeDate(value: string | number | Date) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return new Date(0);
}

function formatArchiveHeaderTime(value: string) {
  return resolveSafeDate(value).toLocaleString("zh-CN");
}

function formatExportMessageTime(message: ExportableMessage, fallbackTimestamp: string) {
  if (typeof message.timestamp === "number" && Number.isFinite(message.timestamp)) {
    const date = resolveSafeDate(message.timestamp);
    return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")} ${`${date.getHours()}`.padStart(2, "0")}:${`${date.getMinutes()}`.padStart(2, "0")}`;
  }

  const label = typeof message.timestampLabel === "string" ? message.timestampLabel.trim() : "";
  if (label) {
    return label;
  }

  return formatArchiveHeaderTime(fallbackTimestamp);
}

function sortMessagesByTimeline<T extends ExportableMessage>(messages: T[]) {
  return messages
    .map((message, index) => ({ message, index }))
    .toSorted((left, right) => {
      const leftTimestamp =
        typeof left.message.timestamp === "number" && Number.isFinite(left.message.timestamp)
          ? left.message.timestamp
          : Number.POSITIVE_INFINITY;
      const rightTimestamp =
        typeof right.message.timestamp === "number" && Number.isFinite(right.message.timestamp)
          ? right.message.timestamp
          : Number.POSITIVE_INFINITY;

      if (leftTimestamp === rightTimestamp) {
        return left.index - right.index;
      }

      return leftTimestamp - rightTimestamp;
    })
    .map((entry) => entry.message);
}

function resolveDirectMessageSender(archive: SidebarDirectArchive, message: ExportableMessage) {
  if (message.role === "user") {
    return "你";
  }

  return archive.agentName.trim() || "对方";
}

function resolveGroupMessageSender(message: GroupChatMessage) {
  if (message.role === "user") {
    return "你";
  }

  return message.senderName?.trim() || "项目组成员";
}

function buildArchiveMarkdown(params: {
  title: string;
  archivedAt: string;
  messageCount: number;
  messages: string[];
}) {
  return [
    `# ${params.title}`,
    "",
    `- 归档时间：${formatArchiveHeaderTime(params.archivedAt)}`,
    `- 归档日期：${formatArchiveTitleDate(params.archivedAt)}`,
    `- 消息条数：${params.messageCount}`,
    "",
    "## 完整对话记录",
    "",
    ...params.messages,
    "",
  ].join("\n");
}

function sanitizeFilename(value: string) {
  const normalized = sanitizeArchiveTitle(value).replace(/[\\/:*?"<>|]+/g, "-");
  return normalized || "未命名归档";
}

function triggerTextDownload(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

export function exportDirectArchiveAsMarkdown(archive: SidebarDirectArchive) {
  const title = sanitizeArchiveTitle(archive.title) || archive.agentName.trim() || "1v1 归档";
  const messages = sortMessagesByTimeline(archive.messages ?? []).map((message) => {
    const sender = resolveDirectMessageSender(archive, message);
    const timestamp = formatExportMessageTime(message, archive.archivedAt);
    return `[${timestamp}] ${sender}: ${message.content}`;
  });
  const content = buildArchiveMarkdown({
    title,
    archivedAt: archive.archivedAt,
    messageCount: archive.messages.length,
    messages,
  });
  const filename = `${sanitizeFilename(title)}_${formatArchiveFileDate(archive.archivedAt)}.md`;

  console.log(`[Archive] 导出 1v1 归档: ${title}`);
  triggerTextDownload(filename, content);
}

export function exportGroupArchiveAsMarkdown(archive: GroupArchive) {
  const title = sanitizeArchiveTitle(archive.title) || archive.groupName.trim() || "项目组归档";
  const messages = sortMessagesByTimeline(archive.messages ?? []).map((message) => {
    const sender = resolveGroupMessageSender(message);
    const timestamp = formatExportMessageTime(message, archive.createdAt);
    return `[${timestamp}] ${sender}: ${message.content}`;
  });
  const content = buildArchiveMarkdown({
    title,
    archivedAt: archive.createdAt,
    messageCount: archive.messages.length,
    messages,
  });
  const filename = `${sanitizeFilename(title)}_${formatArchiveFileDate(archive.createdAt)}.md`;

  console.log(`[Archive] 导出项目组归档: ${title}`);
  triggerTextDownload(filename, content);
}
