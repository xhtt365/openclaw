import type { Group, GroupChatMessage } from "@/stores/groupStore";

function padDatePart(value: number) {
  return `${value}`.padStart(2, "0");
}

function formatDateTime(date: Date) {
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hours = padDatePart(date.getHours());
  const minutes = padDatePart(date.getMinutes());

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatFilenameDateTime(date: Date) {
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hours = padDatePart(date.getHours());
  const minutes = padDatePart(date.getMinutes());
  const seconds = padDatePart(date.getSeconds());

  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

function resolveExportSender(message: GroupChatMessage, group: Group) {
  if (message.senderId?.trim() === "system" || message.senderName?.trim().startsWith("系统")) {
    return "系统";
  }

  if (message.role === "user") {
    return "你";
  }

  if (message.senderName?.trim()) {
    return message.senderName.trim();
  }

  const leader = group.members.find((member) => member.id === group.leaderId);
  return leader?.name ?? group.name;
}

function resolveExportTimestamp(message: GroupChatMessage) {
  if (typeof message.timestamp === "number" && Number.isFinite(message.timestamp)) {
    return formatDateTime(new Date(message.timestamp));
  }

  if (message.timestampLabel?.trim()) {
    return message.timestampLabel.trim();
  }

  return "未知时间";
}

function normalizeExportContent(content: string) {
  const normalized = content.replace(/\r\n?/g, "\n");
  return normalized.trim() ? normalized : "（空消息）";
}

function toQuotedMarkdown(content: string) {
  return content
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

export function formatGroupTranscript(messages: GroupChatMessage[], group: Group) {
  return messages
    .map((message) => {
      const sender = resolveExportSender(message, group);
      const timestamp = resolveExportTimestamp(message);
      const content = toQuotedMarkdown(normalizeExportContent(message.content));

      return [`**${sender}** | ${timestamp}`, "", content, "", "---"].join("\n");
    })
    .join("\n\n");
}

export function buildGroupExportFilename(groupName: string, date: Date) {
  return `${groupName}_${formatFilenameDateTime(date)}.md`;
}
