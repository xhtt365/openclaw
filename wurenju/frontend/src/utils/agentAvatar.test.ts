import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_AVATAR_STORAGE_KEY,
  getAgentAvatarInfo,
  readAgentAvatarMap,
  saveAgentAvatarMapping,
} from "./agentAvatar";

type MockStorage = {
  clear: () => void;
  getItem: (key: string) => string | null;
  key: (index: number) => string | null;
  length: number;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function createMockStorage(seed: Record<string, string> = {}): MockStorage {
  const store = new Map(Object.entries(seed));

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.get(key) ?? null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
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

void test("saveAgentAvatarMapping 会持久化并让 getAgentAvatarInfo 返回图片", async () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  const mockStorage = createMockStorage();
  const requests: string[] = [];

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: mockStorage,
  });
  globalThis.fetch = (async (input) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requests.push(url);

    if (url.endsWith("/storage/health")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.endsWith("/storage/agent-avatars")) {
      return new Response(JSON.stringify({ bob: "/avatars/preset/male_01.jpg" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    const result = await saveAgentAvatarMapping("bob", "/avatars/preset/male_01.jpg");

    const info = getAgentAvatarInfo("bob", "B", "Bob");
    assert.equal(result.persistedTo, "remote");
    assert.deepEqual(info, {
      type: "image",
      value: "/avatars/preset/male_01.jpg",
    });
    assert.ok(requests.some((url) => url.endsWith("/storage/agent-avatars")));
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
    globalThis.fetch = originalFetch;
  }
});

void test("saveAgentAvatarMapping 在后端不可用时回退到本地缓存", async () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  const mockStorage = createMockStorage();

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: mockStorage,
  });
  globalThis.fetch = (async (input) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/storage/health")) {
      return new Response(JSON.stringify({ error: "offline" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    const result = await saveAgentAvatarMapping("eve", "/avatars/preset/female_01.jpg");

    assert.deepEqual(result, {
      persistedTo: "local",
      reason: "backend-unavailable",
    });
    assert.deepEqual(readAgentAvatarMap(), {
      eve: "/avatars/preset/female_01.jpg",
    });
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
    globalThis.fetch = originalFetch;
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
