import { readLocalStorageItem, writeLocalStorageItem } from "@/utils/storage";

const CHAT_FULLSCREEN_STORAGE_KEY = "openclaw:chat-fullscreen";

export function readChatFullscreenPreference() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return readLocalStorageItem(CHAT_FULLSCREEN_STORAGE_KEY) === "1";
  } catch (error) {
    console.error("[UI] 读取聊天全屏状态失败:", error);
    return false;
  }
}

export function writeChatFullscreenPreference(enabled: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  if (!writeLocalStorageItem(CHAT_FULLSCREEN_STORAGE_KEY, enabled ? "1" : "0")) {
    console.error("[UI] 保存聊天全屏状态失败");
  }
}

export { CHAT_FULLSCREEN_STORAGE_KEY };
