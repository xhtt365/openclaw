// 复制自 openclaw 3.13 原版 ui/src/ui/uuid.ts 的聊天相关函数，用于二开定制

export function generateUUID(): string {
  return crypto.randomUUID();
}
