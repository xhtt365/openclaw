// 复制自 openclaw 3.13 原版 ui/src/ui/types.ts 的聊天相关类型，用于二开定制

export type GatewaySessionRow = {
  key: string;
  kind?: string;
  label?: string;
  displayName?: string;
  updatedAt: number | null;
  sessionId?: string;
  thinkingLevel?: string;
  verboseLevel?: string;
  reasoningLevel?: string;
  elevatedLevel?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  model?: string;
  modelProvider?: string;
  contextTokens?: number;
};

export type SessionsListResult = {
  defaults?: {
    contextTokens?: number | null;
    model?: string | null;
  };
  sessions?: GatewaySessionRow[];
};
