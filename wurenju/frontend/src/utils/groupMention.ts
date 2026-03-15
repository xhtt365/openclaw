export type GroupMentionMatch = {
  start: number;
  end: number;
  query: string;
};

function isMentionPrefixBoundary(char: string) {
  return /\s/u.test(char) || char === "(" || char === "（";
}

function isMentionTerminator(char: string) {
  return /\s/u.test(char) || "，。,.!?！？:：；;、()（）".includes(char);
}

export function findActiveGroupMention(text: string, caret: number): GroupMentionMatch | null {
  if (!text) {
    return null;
  }

  const safeCaret = Math.max(0, Math.min(caret, text.length));
  let start = -1;

  // 只在当前光标所在 token 内向左扫描，避免把邮箱或其他普通文本误判成 @ 提及。
  for (let index = safeCaret - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (char === "@") {
      start = index;
      break;
    }

    if (isMentionTerminator(char)) {
      break;
    }
  }

  if (start < 0) {
    return null;
  }

  if (start > 0 && !isMentionPrefixBoundary(text[start - 1])) {
    return null;
  }

  let end = text.length;
  for (let index = start + 1; index < text.length; index += 1) {
    if (isMentionTerminator(text[index])) {
      end = index;
      break;
    }
  }

  if (safeCaret < start + 1 || safeCaret > end) {
    return null;
  }

  const query = text.slice(start + 1, safeCaret);
  if (query.includes("@")) {
    return null;
  }

  return {
    start,
    end,
    query,
  };
}

export function insertGroupMention(
  text: string,
  memberName: string,
  match: Pick<GroupMentionMatch, "start" | "end"> | null,
  caret: number,
) {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  const start = match?.start ?? safeCaret;
  const end = match?.end ?? safeCaret;
  const needsLeadingSpace = !match && start > 0 && !isMentionPrefixBoundary(text[start - 1]);
  const suffix = text.slice(end);
  const needsTrailingSpace = suffix.length === 0 || !isMentionTerminator(suffix[0]);
  const prefix = needsLeadingSpace ? " " : "";
  const mentionText = `@${memberName}${needsTrailingSpace ? " " : ""}`;

  return {
    value: text.slice(0, start) + prefix + mentionText + suffix,
    caret: start + prefix.length + mentionText.length,
  };
}

export function matchesGroupMentionQuery(name: string, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return name.toLocaleLowerCase().includes(normalizedQuery);
}
