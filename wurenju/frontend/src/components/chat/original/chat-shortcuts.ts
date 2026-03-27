export type ChatSearchShortcutEvent = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
};

export function isChatSearchShortcut(event: ChatSearchShortcutEvent) {
  const key = event.key.trim().toLowerCase();
  if (!key) {
    return false;
  }

  return Boolean(
    (event.metaKey || event.ctrlKey) && !event.shiftKey && (key === "f" || key === "k"),
  );
}
