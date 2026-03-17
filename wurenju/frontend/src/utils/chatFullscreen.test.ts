import assert from "node:assert/strict";
import { after, afterEach, before } from "node:test";
import test from "node:test";
import {
  CHAT_FULLSCREEN_STORAGE_KEY,
  readChatFullscreenPreference,
  writeChatFullscreenPreference,
} from "./chatFullscreen";

class MemoryStorage implements Storage {
  private storage = new Map<string, string>();

  get length() {
    return this.storage.size;
  }

  clear() {
    this.storage.clear();
  }

  getItem(key: string) {
    return this.storage.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.storage.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.storage.delete(key);
  }

  setItem(key: string, value: string) {
    this.storage.set(key, value);
  }
}

class MockWindow {
  constructor(public localStorage: Storage) {}
}

const memoryStorage = new MemoryStorage();
const originalWindow = globalThis.window;

before(() => {
  Object.defineProperty(globalThis, "window", {
    value: new MockWindow(memoryStorage),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  memoryStorage.clear();
  Object.defineProperty(globalThis, "window", {
    value: new MockWindow(memoryStorage),
    configurable: true,
    writable: true,
  });
});

after(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: Window }).window;
    return;
  }

  Object.defineProperty(globalThis, "window", {
    value: originalWindow,
    configurable: true,
    writable: true,
  });
});

void test("聊天全屏状态默认关闭并写入 localStorage", () => {
  assert.equal(readChatFullscreenPreference(), false);

  writeChatFullscreenPreference(true);
  assert.equal(readChatFullscreenPreference(), true);
  assert.equal(memoryStorage.getItem(CHAT_FULLSCREEN_STORAGE_KEY), "1");

  writeChatFullscreenPreference(false);
  assert.equal(readChatFullscreenPreference(), false);
  assert.equal(memoryStorage.getItem(CHAT_FULLSCREEN_STORAGE_KEY), "0");
});
