// 复制自 openclaw 原版 ui/src/ui/types/chat-types.ts，用于二开定制

import type { ChatMessage } from "@/utils/messageAdapter";

export type ChatMessageGroup = {
  key: string;
  role: "user" | "assistant";
  messages: ChatMessage[];
  timestamp: number;
  showDividerBefore: boolean;
};

export type ChatAttachmentPreview = {
  id: string;
  name: string;
  url: string;
};
