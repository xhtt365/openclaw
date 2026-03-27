import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createMockStorage() {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  } satisfies Storage;
}

describe("groupPersistence", () => {
  const originalFetch = globalThis.fetch;
  let mockStorage: Storage;

  beforeEach(() => {
    vi.resetModules();
    mockStorage = createMockStorage();
    vi.stubGlobal("window", {
      localStorage: mockStorage,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      dispatchEvent: () => true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    vi.stubGlobal("localStorage", mockStorage);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  it("reads and writes the local snapshot synchronously", async () => {
    const module = await import("@/utils/groupPersistence");
    const snapshot = {
      groups: [{ id: "group-1", name: "项目组" }],
      selectedGroupId: "group-1",
      selectedArchiveId: null,
      messagesByGroupId: {
        "group-1": [],
      },
      archives: [],
    };

    expect(module.writeGroupStorageSnapshot(snapshot, "测试写入")).toBe(true);
    expect(module.readGroupStorageSnapshot()).toEqual(snapshot);
  });

  it("migrates local snapshot to storage API when the backend is available but empty", async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      requests.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      if (url.endsWith("/storage/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/storage/groups?")) {
        return new Response(
          JSON.stringify({
            userId: "self",
            snapshot: null,
            source: "empty",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (url.endsWith("/storage/groups") && method === "PUT") {
        return new Response(
          JSON.stringify({
            userId: "self",
            snapshot:
              requests.at(-1)?.body && (requests.at(-1)?.body as { snapshot: unknown }).snapshot,
            source: "settings",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    const module = await import("@/utils/groupPersistence");
    mockStorage.setItem(
      module.GROUP_STORAGE_KEY,
      JSON.stringify({
        groups: [{ id: "group-1", name: "本地项目组" }],
        selectedGroupId: "group-1",
        selectedArchiveId: null,
        messagesByGroupId: { "group-1": [] },
        archives: [],
      }),
    );

    await module.hydrateGroupStorageSnapshot();

    expect(
      requests.some(
        (request) =>
          request.method === "PUT" &&
          request.url.endsWith("/storage/groups") &&
          (request.body as { userId?: string }).userId === "self",
      ),
    ).toBe(true);
  });

  it("replaces the local snapshot with the backend snapshot when remote data exists", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith("/storage/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/storage/groups?")) {
        return new Response(
          JSON.stringify({
            userId: "self",
            snapshot: {
              groups: [{ id: "group-remote", name: "后端项目组" }],
              selectedGroupId: "group-remote",
              selectedArchiveId: null,
              messagesByGroupId: { "group-remote": [] },
              archives: [],
            },
            source: "settings",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    const module = await import("@/utils/groupPersistence");
    const snapshot = await module.hydrateGroupStorageSnapshot();

    expect(snapshot).toEqual({
      groups: [{ id: "group-remote", name: "后端项目组" }],
      selectedGroupId: "group-remote",
      selectedArchiveId: null,
      messagesByGroupId: { "group-remote": [] },
      archives: [],
    });
    expect(module.readGroupStorageSnapshot()).toEqual(snapshot);
  });
});
