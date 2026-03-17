const CHAT_FULLSCREEN_STORAGE_KEY = "openclaw:chat-fullscreen";

function readStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

export function readChatFullscreenPreference() {
  const storage = readStorage();
  if (!storage) {
    return false;
  }

  try {
    return storage.getItem(CHAT_FULLSCREEN_STORAGE_KEY) === "1";
  } catch (error) {
    console.error("[UI] 读取聊天全屏状态失败:", error);
    return false;
  }
}

export function writeChatFullscreenPreference(enabled: boolean) {
  const storage = readStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(CHAT_FULLSCREEN_STORAGE_KEY, enabled ? "1" : "0");
  } catch (error) {
    console.error("[UI] 保存聊天全屏状态失败:", error);
  }
}

export { CHAT_FULLSCREEN_STORAGE_KEY };
