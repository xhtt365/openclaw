import type { SessionsListResult } from "@/components/chat/original/types";
import type { Group, GroupChatMessage } from "@/stores/groupStore";
import { resolveAvatarImage, resolveInitialAvatarText } from "@/utils/groupSurface";

type SurfaceMessageBlock =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "thinking";
      thinking: string;
    };

type SurfaceMessage = {
  id: string;
  role: "user" | "assistant";
  content: SurfaceMessageBlock[];
  timestamp: number;
  senderLabel?: string | null;
  senderId?: string;
  senderAvatarUrl?: string;
  senderAvatarText?: string;
  model?: string;
  usage?: GroupChatMessage["usage"];
};

type SurfaceMemberRecord = {
  name: string;
  avatarUrl?: string;
};

function toSafeTimestamp(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function buildGroupSurfaceSessionKey(group: Pick<Group, "id" | "leaderId">) {
  const normalizedGroupId = encodeURIComponent(group.id.trim().toLowerCase() || "default");
  return `agent:${group.leaderId}:group:${normalizedGroupId}`;
}

export function adaptGroupMessagesToSurfaceMessages(
  messages: GroupChatMessage[],
  members: Array<Pick<Group["members"][number], "id" | "name" | "avatarUrl">> = [],
): SurfaceMessage[] {
  const memberAvatarEntries: Array<[string, SurfaceMemberRecord]> = [];
  for (const member of members) {
    const memberId = member.id.trim();
    if (!memberId) {
      continue;
    }

    memberAvatarEntries.push([
      memberId,
      {
        name: member.name.trim() || memberId,
        avatarUrl: resolveAvatarImage(member) ?? member.avatarUrl?.trim() ?? undefined,
      },
    ]);
  }
  const memberAvatarById = new Map<string, SurfaceMemberRecord>(memberAvatarEntries);

  return messages.map((message, index) => {
    const timestamp = toSafeTimestamp(message.timestamp, Date.now() + index);
    const content: SurfaceMessageBlock[] = [];
    const matchedMemberByName = members.find(
      (member) => member.name.trim() === message.senderName?.trim(),
    );
    const matchedMember: SurfaceMemberRecord | undefined =
      (message.senderId?.trim() ? memberAvatarById.get(message.senderId.trim()) : undefined) ??
      (matchedMemberByName
        ? {
            name: matchedMemberByName.name.trim() || "成员",
            avatarUrl:
              resolveAvatarImage(matchedMemberByName) ??
              matchedMemberByName.avatarUrl?.trim() ??
              undefined,
          }
        : undefined);
    const senderName = message.senderName?.trim() || matchedMember?.name || "成员";
    const senderAvatarUrl =
      message.senderAvatarUrl?.trim() || matchedMember?.avatarUrl?.trim() || undefined;

    if (message.role === "assistant" && message.thinking?.trim()) {
      content.push({
        type: "thinking",
        thinking: message.thinking.trim(),
      });
    }

    content.push({
      type: "text",
      text: message.content,
    });

    return {
      id: message.id,
      role: message.role,
      content,
      timestamp,
      senderLabel: message.role === "user" ? "你" : senderName,
      senderId: message.senderId?.trim() || undefined,
      senderAvatarUrl,
      senderAvatarText:
        message.role === "assistant" ? resolveInitialAvatarText(senderName) : undefined,
      model: message.model,
      usage: message.usage,
    };
  });
}

export function buildGroupSurfaceSessions(params: {
  group: Group;
  messages: GroupChatMessage[];
  contextTokens: number;
}): SessionsListResult {
  const latestMessage = params.messages[params.messages.length - 1] ?? null;
  const updatedAt = latestMessage
    ? toSafeTimestamp(latestMessage.timestamp, Date.parse(params.group.createdAt))
    : Date.parse(params.group.createdAt);

  return {
    defaults: {
      contextTokens: params.contextTokens,
      model: null,
    },
    sessions: [
      {
        key: buildGroupSurfaceSessionKey(params.group),
        label: params.group.name,
        displayName: params.group.name,
        updatedAt,
        contextTokens: params.contextTokens,
        model:
          params.messages
            .toReversed()
            .find((message) => message.role === "assistant" && message.model?.trim())?.model ??
          undefined,
      },
    ],
  };
}
