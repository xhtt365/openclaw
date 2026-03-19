import { readLocalStorageItem } from "@/utils/storage";
import type { Agent } from "../stores/agentStore";
import type { AgentInfo, Group, GroupChatMessage } from "../stores/groupStore";

const GROUP_STORAGE_KEY = "wurenju.groups.v1";

type GroupAvatarRecord = {
  id?: string;
  avatar?: string;
  avatarUrl?: string;
  image?: string;
};

export type GroupMemberAvatarCache = {
  byId: Map<string, string>;
  byName: Map<string, string>;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isAvatarUrl(value: string) {
  return (
    /^https?:\/\//iu.test(value) ||
    /^data:image\//iu.test(value) ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    /\.(png|jpe?g|gif|webp|svg|avif)(?:[?#].*)?$/iu.test(value)
  );
}

function resolveAvatarCandidate(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed && isAvatarUrl(trimmed) ? trimmed : null;
}

function resolveAvatarSourceRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeAvatarCacheKey(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function resolveAvatarImage(source: unknown) {
  if (typeof source === "string") {
    return resolveAvatarCandidate(source);
  }

  if (!source || typeof source !== "object") {
    return null;
  }

  const record = source as Record<string, unknown>;
  const identity = resolveAvatarSourceRecord(record.identity);
  const profile = resolveAvatarSourceRecord(record.profile);

  return (
    resolveAvatarCandidate(record.avatarUrl) ??
    resolveAvatarCandidate(record.avatar) ??
    resolveAvatarCandidate(record.image) ??
    resolveAvatarCandidate(record.icon) ??
    resolveAvatarCandidate(record.profile_image) ??
    resolveAvatarCandidate(record.profileImage) ??
    resolveAvatarCandidate(record.senderAvatarUrl) ??
    resolveAvatarCandidate(record.senderAvatar) ??
    resolveAvatarCandidate(record.senderImage) ??
    resolveAvatarCandidate(identity?.avatarUrl) ??
    resolveAvatarCandidate(identity?.avatar) ??
    resolveAvatarCandidate(identity?.image) ??
    resolveAvatarCandidate(identity?.icon) ??
    resolveAvatarCandidate(identity?.profile_image) ??
    resolveAvatarCandidate(identity?.profileImage) ??
    resolveAvatarCandidate(profile?.avatarUrl) ??
    resolveAvatarCandidate(profile?.avatar) ??
    resolveAvatarCandidate(profile?.image) ??
    resolveAvatarCandidate(profile?.icon) ??
    resolveAvatarCandidate(profile?.profile_image) ??
    resolveAvatarCandidate(profile?.profileImage)
  );
}

export function buildGroupMemberAvatarCache(
  messages: GroupChatMessage[] = [],
): GroupMemberAvatarCache {
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();

  for (const message of messages) {
    const avatarUrl = resolveAvatarImage(message);
    if (!avatarUrl) {
      continue;
    }

    const idKey = normalizeAvatarCacheKey(message.senderId);
    if (idKey) {
      byId.set(idKey, avatarUrl);
    }

    const nameKey = normalizeAvatarCacheKey(message.senderName);
    if (nameKey) {
      byName.set(nameKey, avatarUrl);
    }
  }

  return { byId, byName };
}

export function resolveGroupMemberAvatarUrl(
  member: Pick<AgentInfo, "id" | "name" | "avatarUrl">,
  avatarCache?: GroupMemberAvatarCache | null,
) {
  const directAvatar = resolveAvatarImage(member);
  if (directAvatar) {
    return directAvatar;
  }

  if (!avatarCache) {
    return null;
  }

  const idMatch = avatarCache.byId.get(normalizeAvatarCacheKey(member.id));
  if (idMatch) {
    return idMatch;
  }

  return avatarCache.byName.get(normalizeAvatarCacheKey(member.name)) ?? null;
}

export function resolveInitialAvatarText(name: string | null | undefined) {
  return name?.trim().charAt(0).toUpperCase() || "#";
}

function buildMentionMatcher(memberNames: string[]) {
  const normalizedNames = Array.from(
    new Set(
      memberNames
        .map((name) => name.trim())
        .filter(Boolean)
        .toSorted((left, right) => right.length - left.length),
    ),
  );
  if (normalizedNames.length === 0) {
    return null;
  }

  return new RegExp(
    `(^|[\\s（(])(@(?:${normalizedNames.map((name) => escapeRegExp(name)).join("|")}))(?=$|[\\s，。,.!?！？:：；;、）)])`,
    "gmu",
  );
}

function replaceSegmentMentions(
  text: string,
  matcher: RegExp,
  className: string,
  escapePlainText: boolean,
) {
  matcher.lastIndex = 0;
  let output = "";
  let lastIndex = 0;
  let match = matcher.exec(text);

  while (match) {
    const prefix = match[1] ?? "";
    const mention = match[2] ?? "";
    const mentionStart = match.index + prefix.length;

    const plainChunk = text.slice(lastIndex, mentionStart);
    output += escapePlainText ? escapeHtml(plainChunk) : plainChunk;
    output += `<span class="${className}">${escapeHtml(mention)}</span>`;
    lastIndex = mentionStart + mention.length;
    match = matcher.exec(text);
  }

  const tail = text.slice(lastIndex);
  output += escapePlainText ? escapeHtml(tail) : tail;
  return output;
}

function isCodeFenceSegment(segment: string) {
  return segment.startsWith("```");
}

function isInlineCodeSegment(segment: string) {
  return segment.startsWith("`") && segment.endsWith("`") && !segment.startsWith("```");
}

export function resolveGroupMembersForSurface(
  group: Group,
  agents: Array<Pick<Agent, "id" | "name" | "emoji" | "avatarUrl" | "role">> = [],
) {
  const liveAgents = new Map(agents.map((agent) => [agent.id.trim(), agent]));
  const orderedMemberIds = Array.from(
    new Set([group.leaderId, ...group.members.map((member) => member.id)].filter(Boolean)),
  );
  const resolvedMembers: AgentInfo[] = [];

  for (const memberId of orderedMemberIds) {
    const storedMember = group.members.find((member) => member.id === memberId);
    const liveMember = liveAgents.get(memberId);

    if (!storedMember && !liveMember) {
      continue;
    }

    resolvedMembers.push({
      id: memberId,
      name: liveMember?.name?.trim() || storedMember?.name?.trim() || memberId,
      emoji: liveMember?.emoji?.trim() || storedMember?.emoji?.trim() || undefined,
      avatarUrl: resolveAvatarImage(liveMember) ?? resolveAvatarImage(storedMember) ?? undefined,
      role: liveMember?.role?.trim() || storedMember?.role?.trim() || undefined,
    });
  }

  return resolvedMembers;
}

export function getGroupMemberCount(group: Group) {
  return new Set([group.leaderId, ...group.members.map((member) => member.id)].filter(Boolean))
    .size;
}

export function resolveStoredGroupAvatarUrl(groupId: string) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = readLocalStorageItem(GROUP_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as { groups?: GroupAvatarRecord[] } | null;
    const record = parsed?.groups?.find((group) => group?.id === groupId);
    return resolveAvatarImage(record);
  } catch (error) {
    console.warn("[GroupChat] 读取项目组头像缓存失败:", error);
    return null;
  }
}

export function resolveGroupAvatarUrl(group: unknown) {
  const directAvatar = resolveAvatarImage(group);
  if (directAvatar) {
    return directAvatar;
  }

  if (!group || typeof group !== "object") {
    return null;
  }

  const groupId =
    typeof (group as Record<string, unknown>).id === "string"
      ? ((group as Record<string, unknown>).id as string)
      : "";
  return groupId ? resolveStoredGroupAvatarUrl(groupId) : null;
}

export function renderGroupMentionPreviewHtml(text: string, memberNames: string[]) {
  if (!text) {
    return "";
  }

  const matcher = buildMentionMatcher(memberNames);
  if (!matcher) {
    return escapeHtml(text);
  }

  return replaceSegmentMentions(text, matcher, "group-input-mention", true);
}

export function decorateGroupMarkdownMentions(markdown: string, memberNames: string[]) {
  if (!markdown) {
    return markdown;
  }

  const matcher = buildMentionMatcher(memberNames);
  if (!matcher) {
    return markdown;
  }

  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]+`)/gu)
    .map((segment) => {
      if (!segment || isCodeFenceSegment(segment) || isInlineCodeSegment(segment)) {
        return segment;
      }

      return replaceSegmentMentions(segment, matcher, "group-message-mention", false);
    })
    .join("");
}

export function decorateGroupHtmlMentions(renderedHtml: string, memberNames: string[]) {
  if (!renderedHtml) {
    return renderedHtml;
  }

  const matcher = buildMentionMatcher(memberNames);
  if (!matcher) {
    return renderedHtml;
  }

  return renderedHtml
    .split(/(<[^>]+>)/gu)
    .map((segment) => {
      if (!segment || segment.startsWith("<")) {
        return segment;
      }

      return replaceSegmentMentions(segment, matcher, "group-message-mention", false);
    })
    .join("");
}
