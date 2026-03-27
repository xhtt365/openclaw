// 复制自 openclaw 3.13 原版 ../../../ui/src/ui/chat/pinned-summary.ts，用于二开定制

import { extractTextCached } from "./message-extract.ts";

export function getPinnedMessageSummary(message: unknown): string {
  return extractTextCached(message) ?? "";
}
