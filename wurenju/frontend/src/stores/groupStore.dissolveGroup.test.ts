import assert from "node:assert/strict";
import { after, afterEach, before } from "node:test";
import test from "node:test";

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalFetch = globalThis.fetch;

let useGroupStore: typeof import("./groupStore").useGroupStore;
let gateway: typeof import("../services/gateway").gateway;

before(async () => {
  Object.defineProperty(globalThis, "window", {
    value: {
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
        clear: () => undefined,
        key: () => null,
        length: 0,
      },
      dispatchEvent: () => true,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    },
    configurable: true,
    writable: true,
  });

  Object.defineProperty(globalThis, "document", {
    value: {
      hidden: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
    configurable: true,
    writable: true,
  });

  ({ useGroupStore } = await import("./groupStore"));
  ({ gateway } = await import("../services/gateway"));
});

afterEach(() => {
  useGroupStore.setState({
    groups: [],
    selectedGroupId: null,
    selectedArchiveId: null,
    messagesByGroupId: {},
    archives: [],
    thinkingAgentsByGroupId: new Map(),
    announcementSyncStatus: new Map(),
    isSendingByGroupId: {},
  });
  globalThis.fetch = originalFetch;
});

after(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: Window }).window;
  } else {
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
  }

  if (originalDocument === undefined) {
    delete (globalThis as { document?: Document }).document;
    return;
  }

  Object.defineProperty(globalThis, "document", {
    value: originalDocument,
    configurable: true,
    writable: true,
  });
});

void test("dissolveGroup 在后端删除失败时不会先删掉本地项目组", async () => {
  const group = {
    id: "group-1",
    name: "测试项目组",
    members: [
      { id: "dev", name: "小王", emoji: "🧑‍💻" },
      { id: "qa", name: "小李", emoji: "🧪" },
    ],
    leaderId: "dev",
    createdAt: "2026-03-21T10:00:00.000Z",
    notificationsEnabled: true,
    soundEnabled: true,
  };
  const originalAbortSession = gateway.abortSession.bind(gateway);
  const originalDeleteSession = gateway.deleteSession.bind(gateway);

  gateway.abortSession = (async () => ({ ok: true, aborted: true })) as typeof gateway.abortSession;
  gateway.deleteSession = (async () => ({})) as typeof gateway.deleteSession;
  globalThis.fetch = (async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/groups/group-1") && (init?.method ?? "GET").toUpperCase() === "DELETE") {
      return new Response(JSON.stringify({ error: "删除失败" }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }) as typeof fetch;

  try {
    useGroupStore.setState({
      groups: [group],
      selectedGroupId: group.id,
      selectedArchiveId: null,
      messagesByGroupId: {
        [group.id]: [],
      },
      archives: [],
      thinkingAgentsByGroupId: new Map(),
      announcementSyncStatus: new Map(),
      isSendingByGroupId: {},
    });

    const result = await useGroupStore.getState().dissolveGroup(group.id);

    assert.equal(result.success, false);
    assert.equal(useGroupStore.getState().groups.length, 1);
    assert.equal(useGroupStore.getState().groups[0]?.id, group.id);
  } finally {
    gateway.abortSession = originalAbortSession;
    gateway.deleteSession = originalDeleteSession;
  }
});
