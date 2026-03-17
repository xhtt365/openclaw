// 复制自 openclaw 3.13 原版 ui/src/ui/navigation.ts 的聊天相关标题映射，用于二开定制

export type Tab = "chat";

export function titleForTab(tab: Tab): string {
  if (tab === "chat") {
    return "聊天";
  }
  return tab;
}
