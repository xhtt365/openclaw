import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_AVATAR_STORAGE_KEY,
  getAgentAvatarInfo,
  readAgentAvatarMap,
  saveAgentAvatarMapping,
} from "./agentAvatar";

type MockStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function createMockStorage(seed: Record<string, string> = {}): MockStorage {
  const store = new Map(Object.entries(seed));

  return {
    getItem(key) {
      return store.get(key) ?? null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

void test("getAgentAvatarInfo 优先读取本地图片映射", () => {
  const originalLocalStorage = globalThis.localStorage;
  const mockStorage = createMockStorage({
    [AGENT_AVATAR_STORAGE_KEY]: JSON.stringify({
      alice: "/avatars/preset/female_01.jpg",
    }),
  });

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: mockStorage,
  });

  try {
    const info = getAgentAvatarInfo("alice", "🎀", "Alice");
    assert.deepEqual(info, {
      type: "image",
      value: "/avatars/preset/female_01.jpg",
    });
    assert.deepEqual(readAgentAvatarMap(), {
      alice: "/avatars/preset/female_01.jpg",
    });
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
  }
});

void test("saveAgentAvatarMapping 会持久化并让 getAgentAvatarInfo 返回图片", () => {
  const originalLocalStorage = globalThis.localStorage;
  const mockStorage = createMockStorage();

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: mockStorage,
  });

  try {
    saveAgentAvatarMapping("bob", "/avatars/preset/male_01.jpg");

    const info = getAgentAvatarInfo("bob", "B", "Bob");
    assert.deepEqual(info, {
      type: "image",
      value: "/avatars/preset/male_01.jpg",
    });
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
  }
});

void test("getAgentAvatarInfo 在没有图片映射时回退到 emoji 或首字母", () => {
  assert.deepEqual(getAgentAvatarInfo("carol", "⚡", "Carol"), {
    type: "emoji",
    value: "⚡",
  });

  assert.deepEqual(getAgentAvatarInfo("dave", undefined, "Dave"), {
    type: "letter",
    value: "D",
  });
});
