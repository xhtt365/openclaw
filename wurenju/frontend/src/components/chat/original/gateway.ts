// 复制自 openclaw 3.13 原版 ui/src/ui/gateway.ts 的聊天相关类型，用于二开定制

export type GatewayBrowserClient = {
  request<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
};
