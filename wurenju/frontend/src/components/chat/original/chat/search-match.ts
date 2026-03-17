// 复制自 openclaw 3.13 原版 ../../../ui/src/ui/chat/search-match.ts，用于二开定制

import { extractTextCached } from "./message-extract.ts";

export function messageMatchesSearchQuery(message: unknown, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  const text = (extractTextCached(message) ?? "").toLowerCase();
  return text.includes(normalizedQuery);
}
