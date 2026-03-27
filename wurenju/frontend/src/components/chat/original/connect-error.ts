// 复制自 openclaw 3.13 原版 ui/src/ui/connect-error.ts 的聊天相关适配，用于二开定制

export function formatConnectError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return "gateway request failed";
}
