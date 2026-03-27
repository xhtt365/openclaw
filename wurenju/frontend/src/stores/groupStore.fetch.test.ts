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

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

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

describe("groupStore.fetchGroups", () => {
  const originalFetch = globalThis.fetch;
  let storage: MemoryStorage;
  let useGroupStore: GroupStoreModule["useGroupStore"] | null = null;

  beforeEach(() => {
    vi.resetModules();
    storage = new MemoryStorage();
    vi.stubGlobal("window", createMockWindow(storage));
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("document", createMockDocument());
  });

  afterEach(() => {
    useGroupStore = null;
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  async function importStore() {
    ({ useGroupStore } = await import("./groupStore"));
    return useGroupStore;
  }

  it("hydrates and normalizes the remote storage snapshot into the store", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith("/storage/health")) {
        return jsonResponse({ ok: true, updated_at: "2026-03-27T00:00:00.000Z" });
      }

      if (url.includes("/storage/groups?userId=self")) {
        return jsonResponse({
          userId: "self",
          source: "settings",
          snapshot: {
            groups: [
              {
                id: "group-1",
                name: "  远端项目组  ",
                avatarUrl: " ",
                description: "  从 SQLite 恢复  ",
                announcement: "  今天下班前给结论  ",
                announcementVersion: 2,
                notificationsEnabled: true,
                soundEnabled: false,
                members: [
                  {
                    id: "agent-1",
                    name: " ",
                    role: " 开发 ",
                  },
                ],
                leaderId: "agent-1",
                createdAt: "2026-03-20T10:00:00.000Z",
              },
            ],
            selectedGroupId: "group-1",
            selectedArchiveId: "archive-1",
            messagesByGroupId: {
              "group-1": [
                {
                  id: "message-1",
                  role: "assistant",
                  content: "  已收到  ",
                  timestamp: 1_742_000_000_000,
                },
              ],
            },
            archives: [
              {
                id: "archive-1",
                groupId: "group-1",
                groupName: "  远端项目组  ",
                title: "结项归档",
                createdAt: "2026-03-21T08:00:00.000Z",
                messages: [],
              },
            ],
          },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    const store = await importStore();
    await store.getState().fetchGroups();

    const state = store.getState();
    expect(state.isHydrating).toBe(false);
    expect(state.selectedGroupId).toBe("group-1");
    expect(state.selectedArchiveId).toBe("archive-1");
    expect(state.groups).toEqual([
      {
        id: "group-1",
        name: "远端项目组",
        avatarUrl: undefined,
        description: "从 SQLite 恢复",
        announcement: "今天下班前给结论",
        announcementVersion: 2,
        notificationsEnabled: true,
        soundEnabled: false,
        isUrging: false,
        urgeIntervalMinutes: undefined,
        urgeStartedAt: undefined,
        urgeCount: undefined,
        isUrgePaused: false,
        urgeLastCheckedAt: undefined,
        members: [
          {
            id: "agent-1",
            name: "agent-1",
            avatarUrl: undefined,
            emoji: undefined,
            role: "开发",
          },
        ],
        leaderId: "agent-1",
        createdAt: "2026-03-20T10:00:00.000Z",
      },
    ]);
    expect(state.archives).toEqual([
      {
        id: "archive-1",
        groupId: "group-1",
        groupName: "远端项目组",
        groupAvatarUrl: undefined,
        title: "结项归档",
        createdAt: "2026-03-21T08:00:00.000Z",
        messages: [],
      },
    ]);

    expect(JSON.parse(storage.getItem(GROUP_STORAGE_KEY) ?? "null")).toMatchObject({
      selectedGroupId: "group-1",
      selectedArchiveId: "archive-1",
      groups: [
        {
          id: "group-1",
          name: "  远端项目组  ",
        },
      ],
    });
  });

  it("falls back to the local snapshot when the storage API is unavailable", async () => {
    storage.setItem(
      GROUP_STORAGE_KEY,
      JSON.stringify({
        groups: [
          {
            id: "group-local",
            name: "本地项目组",
            members: [{ id: "agent-local", name: "本地成员" }],
            leaderId: "agent-local",
            createdAt: "2026-03-22T09:00:00.000Z",
          },
        ],
        selectedGroupId: "group-local",
        selectedArchiveId: null,
        messagesByGroupId: {
          "group-local": [],
        },
        archives: [],
      }),
    );
    globalThis.fetch = vi.fn(async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith("/storage/health")) {
        throw new Error("backend offline");
      }

      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    const store = await importStore();
    await store.getState().fetchGroups();

    expect(store.getState().groups).toEqual([
      {
        id: "group-local",
        name: "本地项目组",
        avatarUrl: undefined,
        description: undefined,
        announcement: undefined,
        announcementVersion: undefined,
        notificationsEnabled: true,
        soundEnabled: true,
        isUrging: false,
        urgeIntervalMinutes: undefined,
        urgeStartedAt: undefined,
        urgeCount: undefined,
        isUrgePaused: false,
        urgeLastCheckedAt: undefined,
        members: [
          {
            id: "agent-local",
            name: "本地成员",
            avatarUrl: undefined,
            emoji: undefined,
            role: undefined,
          },
        ],
        leaderId: "agent-local",
        createdAt: "2026-03-22T09:00:00.000Z",
      },
    ]);
    expect(store.getState().selectedGroupId).toBe("group-local");
  });
});
