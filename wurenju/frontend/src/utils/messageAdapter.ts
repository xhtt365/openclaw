import type { GatewayHistoryPayload, GatewayMessage } from "@/services/gateway";
import { sanitizeAssistantText } from "@/utils/messageSanitizer";
import { normalizeUsage } from "@/utils/usage";

export interface ChatUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost?: { total: number };
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  model?: string;
  usage?: ChatUsage;
  timestamp?: number;
  timestampLabel?: string;
  isLoading?: boolean;
  isNew: boolean;
  isHistorical: boolean;
}

type HistoryContentBlock = {
  type?: string;
  text?: string;
  thinking?: string;
};

export interface HistoryMessage {
  role?: string;
  content?: HistoryContentBlock[];
  model?: string;
  provider?: string;
  api?: string;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
    total?: number;
    cost?: { total?: number };
  };
  timestamp?: number;
  senderLabel?: string;
  stopReason?: string;
}

type SidebarSyncMessage = Omit<HistoryMessage, "content"> &
  Partial<ChatMessage> & {
    id?: string;
    content?: HistoryContentBlock[] | string;
    text?: string;
  };

function toFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeChatUsage(
  usage: HistoryMessage["usage"] | GatewayMessage["usage"] | undefined,
): ChatUsage | undefined {
  return normalizeUsage(usage);
}

function extractBlockContent(blocks: HistoryContentBlock[]) {
  const content = blocks
    .filter((block) => block?.type === "text")
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n");

  const thinking = blocks
    .filter((block) => block?.type === "thinking")
    .map((block) => (typeof block.thinking === "string" ? block.thinking : ""))
    .filter(Boolean)
    .join("\n");

  return {
    content,
    thinking: thinking || undefined,
  };
}

function extractSidebarSyncContent(message: SidebarSyncMessage) {
  if (typeof message.content === "string") {
    return {
      content: message.content,
      thinking: typeof message.thinking === "string" ? message.thinking : undefined,
    };
  }

  if (Array.isArray(message.content)) {
    return extractBlockContent(message.content);
  }

  return {
    content: typeof message.text === "string" ? message.text : "",
    thinking: typeof message.thinking === "string" ? message.thinking : undefined,
  };
}

export function hasRenderableUsage(usage?: ChatUsage): usage is ChatUsage {
  if (!usage) {
    return false;
  }

  return (
    usage.input > 0 ||
    usage.output > 0 ||
    usage.cacheRead > 0 ||
    usage.cacheWrite > 0 ||
    usage.totalTokens > 0 ||
    usage.cost?.total !== undefined
  );
}

export function adaptRealtimeMessage(message: GatewayMessage): ChatMessage {
  const content =
    message.role === "assistant" ? sanitizeAssistantText(message.content) : message.content;
  const thinking =
    message.role === "assistant" && typeof message.thinking === "string"
      ? sanitizeAssistantText(message.thinking)
      : message.thinking;

  return {
    id: crypto.randomUUID(),
    role: message.role,
    content,
    thinking,
    model: message.model,
    usage: normalizeChatUsage(message.usage),
    timestamp: message.timestamp,
    isNew: true,
    isHistorical: false,
  };
}

export function adaptHistoryMessage(message: unknown): ChatMessage | null {
  if (!message || typeof message !== "object") {
    return null;
  }

  const rawMessage = message as SidebarSyncMessage;
  if (rawMessage.role !== "user" && rawMessage.role !== "assistant") {
    return null;
  }

  const extracted = extractSidebarSyncContent(rawMessage);
  const timestamp = toFiniteNumber(rawMessage.timestamp);
  const content =
    rawMessage.role === "assistant" ? sanitizeAssistantText(extracted.content) : extracted.content;
  const thinking =
    rawMessage.role === "assistant" && extracted.thinking
      ? sanitizeAssistantText(extracted.thinking)
      : extracted.thinking;

  return {
    id:
      typeof rawMessage.id === "string" && rawMessage.id.trim()
        ? rawMessage.id.trim()
        : crypto.randomUUID(),
    role: rawMessage.role,
    content,
    thinking,
    model: typeof rawMessage.model === "string" ? rawMessage.model : undefined,
    usage: normalizeChatUsage(rawMessage.usage),
    timestamp,
    timestampLabel: timestamp === undefined ? "历史消息" : undefined,
    isNew: false,
    isHistorical: true,
  };
}

export function adaptSidebarSyncMessage(message: unknown): ChatMessage | null {
  const adapted = adaptHistoryMessage(message);
  if (!adapted) {
    return null;
  }

  const rawMessage = message as Partial<ChatMessage>;
  const timestampLabel =
    typeof rawMessage.timestampLabel === "string" && rawMessage.timestampLabel.trim()
      ? rawMessage.timestampLabel.trim()
      : adapted.timestampLabel;

  return {
    ...adapted,
    isLoading: rawMessage.isLoading === true ? true : undefined,
    isNew: rawMessage.isNew === true,
    isHistorical: rawMessage.isHistorical === true,
    timestampLabel,
  };
}

export function adaptHistoryMessages(payload: GatewayHistoryPayload | null): ChatMessage[] {
  if (!payload) {
    return [];
  }

  if (payload.messages !== undefined && !Array.isArray(payload.messages)) {
    console.error("[Store] adaptHistoryMessages: invalid history payload", payload);
    return [];
  }

  const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];

  return rawMessages
    .map((message, index) => ({ index, message: adaptHistoryMessage(message) }))
    .filter((entry): entry is { index: number; message: ChatMessage } => entry.message !== null)
    .toSorted((left, right) => {
      const leftTimestamp = left.message.timestamp;
      const rightTimestamp = right.message.timestamp;

      if (leftTimestamp === undefined || rightTimestamp === undefined) {
        return left.index - right.index;
      }

      return leftTimestamp - rightTimestamp;
    })
    .map((entry) => entry.message);
}

export function adaptSidebarSyncMessages(messages: unknown[]): ChatMessage[] {
  return messages
    .map((message, index) => ({ index, message: adaptSidebarSyncMessage(message) }))
    .filter((entry): entry is { index: number; message: ChatMessage } => entry.message !== null)
    .toSorted((left, right) => {
      const leftTimestamp = left.message.timestamp;
      const rightTimestamp = right.message.timestamp;

      if (leftTimestamp === undefined || rightTimestamp === undefined) {
        return left.index - right.index;
      }

      return leftTimestamp - rightTimestamp;
    })
    .map((entry) => entry.message);
}
