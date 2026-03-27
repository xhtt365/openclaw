import type { GroupMember } from "./groupContext";

export type AnnouncementDispatchMode = "targeted" | "all" | "leader-only";

export type AnnouncementDispatchPlan = {
  targetIds: string[];
  mode: AnnouncementDispatchMode;
};

const ANNOUNCEMENT_EXECUTION_KEYWORD_PATTERN =
  /(接力|分享|讲一下|谈一下|回复|完成|执行|汇报|同步一下|同步下|提交|处理|读取|阅读|查看)/u;
const ANNOUNCEMENT_LOCAL_PATH_PATTERN = /(?:^|[\s"'`（(])(?:\/Users\/|\/home\/|~\/)[^\s"'`）)]+/u;
const ANNOUNCEMENT_FILE_REFERENCE_PATTERN =
  /\b[^\s"'`）)(]+\.(?:md|txt|mdx|markdown|json|ya?ml|csv)\b/u;
const ANNOUNCEMENT_MENTION_PATTERN = /(?:^|[\s"'`（(])@[^\s@：:，,。；;！？!?]+/u;
const ANNOUNCEMENT_ASSIGNMENT_SEGMENT_PATTERN =
  /^(?:@([^\s@：:，,。；;！？!?]+)|([\u4e00-\u9fffA-Za-z0-9_-]{2,16}))\s*(?:[：:]\s*\S+|\s+负责\s*\S+)/u;
const ANNOUNCEMENT_ASSIGNMENT_BLOCKED_TOKENS = [
  "公告",
  "注意",
  "说明",
  "要求",
  "背景",
  "备注",
  "通知",
  "提醒",
  "所有人",
  "所有成员",
  "全员",
  "每人",
  "每个人",
] as const;
const ANNOUNCEMENT_ALL_MEMBERS_SIGNAL_PATTERN = /(所有人|所有成员|全员|每人|每个人)/u;
const ANNOUNCEMENT_MEMBER_MENTION_PATTERN = /(?:^|[\s"'`（(])@([^\s@：:，,。；;！？!?]+)/gu;

export function isExecutableAnnouncement(announcement: string): boolean {
  const normalizedAnnouncement = announcement.trim();
  if (!normalizedAnnouncement) {
    return false;
  }

  return (
    ANNOUNCEMENT_EXECUTION_KEYWORD_PATTERN.test(normalizedAnnouncement) ||
    ANNOUNCEMENT_LOCAL_PATH_PATTERN.test(normalizedAnnouncement) ||
    ANNOUNCEMENT_FILE_REFERENCE_PATTERN.test(normalizedAnnouncement) ||
    ANNOUNCEMENT_MENTION_PATTERN.test(normalizedAnnouncement) ||
    hasAssignmentPattern(normalizedAnnouncement)
  );
}

function hasAssignmentPattern(announcement: string) {
  return announcement.split(/[\n；;。]/u).some((segment) => {
    const normalizedSegment = segment.trim();
    if (!normalizedSegment) {
      return false;
    }

    const match = normalizedSegment.match(ANNOUNCEMENT_ASSIGNMENT_SEGMENT_PATTERN);
    if (!match) {
      return false;
    }

    const assigneeToken = (match[1] ?? match[2] ?? "").trim();
    if (!assigneeToken) {
      return false;
    }

    return !ANNOUNCEMENT_ASSIGNMENT_BLOCKED_TOKENS.some((token) => assigneeToken.includes(token));
  });
}

function resolveAllMemberIds(members: GroupMember[]) {
  return members.map((member) => member.id.trim()).filter(Boolean);
}

function resolveMentionedMemberIds(announcement: string, members: GroupMember[]) {
  const memberIdByName = new Map(
    members
      .map((member) => [member.name.trim(), member.id.trim()] as const)
      .filter(([name, id]) => name && id),
  );
  const mentionedIds = new Set<string>();

  // 只匹配群内现有成员，避免自由文本中的 @ 片段误伤派发目标。
  for (const match of announcement.matchAll(ANNOUNCEMENT_MEMBER_MENTION_PATTERN)) {
    const mentionedName = match[1]?.trim();
    if (!mentionedName) {
      continue;
    }

    const memberId = memberIdByName.get(mentionedName);
    if (memberId) {
      mentionedIds.add(memberId);
    }
  }

  return members
    .map((member) => member.id.trim())
    .filter((memberId) => memberId && mentionedIds.has(memberId));
}

export function buildAnnouncementDispatchPlan(
  announcement: string,
  members: GroupMember[],
  leaderId: string,
): AnnouncementDispatchPlan {
  const normalizedAnnouncement = announcement.trim();
  const allMemberIds = resolveAllMemberIds(members);

  if (ANNOUNCEMENT_ALL_MEMBERS_SIGNAL_PATTERN.test(normalizedAnnouncement)) {
    return {
      targetIds: allMemberIds,
      mode: "all",
    };
  }

  const mentionedMemberIds = resolveMentionedMemberIds(normalizedAnnouncement, members);
  if (mentionedMemberIds.length > 0) {
    return {
      targetIds: mentionedMemberIds,
      mode: "targeted",
    };
  }

  if (isExecutableAnnouncement(normalizedAnnouncement)) {
    const normalizedLeaderId = leaderId.trim();
    return {
      targetIds:
        normalizedLeaderId && allMemberIds.includes(normalizedLeaderId) ? [normalizedLeaderId] : [],
      mode: "leader-only",
    };
  }

  return {
    targetIds: allMemberIds,
    mode: "all",
  };
}
