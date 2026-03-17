// 复制自 openclaw 3.13 原版 ui/src/ui/assistant-identity.ts 的聊天相关类型，用于二开定制

export type AssistantIdentity = {
  agentId?: string | null;
  name: string;
  avatar: string | null;
  avatarText?: string;
  avatarColor?: string;
};
