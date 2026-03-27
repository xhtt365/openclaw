import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const GROUP_STORAGE_KEY = "wurenju.groups.v1";

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

type GroupStoreModule = typeof import("./groupStore");

function createMockWindow(storage: Storage) {
  return {
    localStorage: storage,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

function createMockDocument() {
  return {
    hidden: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

describe("groupStore persistence", () => {
  const originalFetch = globalThis.fetch;
  let storage: MemoryStorage;
  let useGroupStore: GroupStoreModule["useGroupStore"] | null = null;

  beforeEach(() => {
    vi.resetModules();
    storage = new MemoryStorage();
    vi.stubGlobal("window", createMockWindow(storage));
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("document", createMockDocument());
    globalThis.fetch = vi.fn(async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith("/storage/health")) {
        return new Response(JSON.stringify({ error: "offline" }), {
          status: 503,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    useGroupStore?.getState().groups.forEach((group) => {
      useGroupStore?.getState().clearGroupUrgeRuntime(group.id, "test cleanup");
    });
    useGroupStore = null;
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  async function importStore() {
    ({ useGroupStore } = await import("./groupStore"));
    return useGroupStore;
  }

  function readPersistedSnapshot() {
    return JSON.parse(storage.getItem(GROUP_STORAGE_KEY) ?? "null") as {
      groups: Array<Record<string, unknown>>;
      selectedGroupId: string | null;
      selectedArchiveId: string | null;
      messagesByGroupId: Record<string, unknown[]>;
      archives: Array<Record<string, unknown>>;
    } | null;
  }

  it("writes the snapshot to local storage immediately after createGroup", async () => {
    const store = await importStore();

    const created = store.getState().createGroup({
      name: "  新项目组  ",
      members: [{ id: "lead", name: "群主", emoji: "🦞" }],
      leaderId: "lead",
    });

    const snapshot = readPersistedSnapshot();
    expect(snapshot?.selectedGroupId).toBe(created.id);
    expect(snapshot?.groups).toHaveLength(1);
    expect(snapshot?.groups[0]).toMatchObject({
      id: created.id,
      name: "新项目组",
      leaderId: "lead",
    });
    expect(snapshot?.messagesByGroupId[created.id]).toEqual([]);
  });

  it("persists urge state updates into the snapshot", async () => {
    const lastCheckedAt = Date.now();
    storage.setItem(
      GROUP_STORAGE_KEY,
      JSON.stringify({
        groups: [
          {
            id: "group-1",
            name: "测试项目组",
            members: [{ id: "lead", name: "群主", emoji: "🦞" }],
            leaderId: "lead",
            createdAt: "2026-03-21T10:00:00.000Z",
            notificationsEnabled: true,
            soundEnabled: true,
            isUrging: true,
            urgeIntervalMinutes: 5,
            urgeStartedAt: 1_742_000_000_000,
            urgeCount: 2,
            isUrgePaused: false,
            urgeLastCheckedAt: lastCheckedAt,
          },
        ],
        selectedGroupId: "group-1",
        selectedArchiveId: null,
        messagesByGroupId: {
          "group-1": [],
        },
        archives: [],
      }),
    );

    const store = await importStore();
    store.getState().pauseGroupUrging("group-1");

    const snapshot = readPersistedSnapshot();
    expect(snapshot?.groups).toHaveLength(1);
    expect(snapshot?.groups[0]).toMatchObject({
      id: "group-1",
      isUrging: true,
      urgeIntervalMinutes: 5,
      urgeStartedAt: 1_742_000_000_000,
      urgeCount: 2,
      isUrgePaused: true,
      urgeLastCheckedAt: lastCheckedAt,
    });
  });
});
