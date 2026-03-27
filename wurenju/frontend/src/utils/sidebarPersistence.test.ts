import assert from "node:assert/strict";
import { after, afterEach, before } from "node:test";
import test from "node:test";
import {
  EMPLOYEE_DEPARTMENT_MAP_STORAGE_KEY,
  PINNED_EMPLOYEES_STORAGE_KEY,
  SIDEBAR_AGENT_META_STORAGE_KEY,
  SIDEBAR_DEPARTMENTS_STORAGE_KEY,
  SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY,
  SIDEBAR_UNREAD_STORAGE_KEY,
  clearSidebarDepartmentAssignments,
  clearSidebarDirectUnreadCount,
  clearSidebarGroupUnreadCount,
  hydrateSidebarDirectArchivesFromApi,
  incrementSidebarDirectUnreadCount,
  incrementSidebarGroupUnreadCount,
  readSidebarAgentMetaMap,
  readSidebarDepartments,
  readSidebarDirectArchives,
  readSidebarUnreadState,
  removeSidebarDirectArchiveById,
  renameSidebarDirectArchiveById,
  subscribeSidebarStorage,
  writeSidebarAgentMetaMap,
  writeSidebarDepartments,
  writeSidebarDirectArchives,
} from "./sidebarPersistence";

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

class MockWindow extends EventTarget {
  constructor(public localStorage: Storage) {
    super();
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

const memoryStorage = new MemoryStorage();
const originalWindow = globalThis.window;
const originalCustomEvent = globalThis.CustomEvent;
const originalFetch = globalThis.fetch;

before(() => {
  globalThis.fetch = (async () => {
    throw new Error("backend offline");
  }) as unknown as typeof fetch;

  if (typeof globalThis.CustomEvent === "undefined") {
    class TestCustomEvent<T> extends Event {
      detail: T;

      constructor(type: string, init?: CustomEventInit<T>) {
        super(type);
        this.detail = init?.detail as T;
      }
    }

    Object.defineProperty(globalThis, "CustomEvent", {
      value: TestCustomEvent,
      configurable: true,
      writable: true,
    });
  }

  Object.defineProperty(globalThis, "window", {
    value: new MockWindow(memoryStorage),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  memoryStorage.clear();
  globalThis.fetch = (async () => {
    throw new Error("backend offline");
  }) as unknown as typeof fetch;
  Object.defineProperty(globalThis, "window", {
    value: new MockWindow(memoryStorage),
    configurable: true,
    writable: true,
  });
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

  if (originalCustomEvent === undefined) {
    delete (globalThis as { CustomEvent?: typeof CustomEvent }).CustomEvent;
  } else {
    Object.defineProperty(globalThis, "CustomEvent", {
      value: originalCustomEvent,
      configurable: true,
      writable: true,
    });
  }

  globalThis.fetch = originalFetch;
});

void test("writeSidebarDepartments 会按当前顺序归一化并持久化", () => {
  writeSidebarDepartments([
    {
      id: " dept-2 ",
      name: " 市场部 ",
      icon: " ",
      sortOrder: 99,
    },
    {
      id: "dept-1",
      name: " 产品部 ",
      icon: "📋",
      sortOrder: -1,
    },
    {
      id: "",
      name: "无效数据",
      icon: "🏢",
      sortOrder: 2,
    },
  ]);

  assert.deepEqual(readSidebarDepartments(), [
    {
      id: "dept-2",
      name: "市场部",
      icon: "🏢",
      sortOrder: 0,
    },
    {
      id: "dept-1",
      name: "产品部",
      icon: "📋",
      sortOrder: 1,
    },
  ]);

  const persisted = JSON.parse(memoryStorage.getItem(SIDEBAR_DEPARTMENTS_STORAGE_KEY) ?? "[]");
  assert.equal(persisted[0].sortOrder, 0);
  assert.equal(persisted[1].sortOrder, 1);
});

void test("writeSidebarAgentMetaMap 会拆分写入分组映射和置顶列表", () => {
  writeSidebarAgentMetaMap({
    agentA: {
      departmentId: "design",
      pinned: true,
    },
    agentB: {
      pinned: true,
    },
    agentC: {
      departmentId: "ops",
    },
  });

  assert.deepEqual(JSON.parse(memoryStorage.getItem(EMPLOYEE_DEPARTMENT_MAP_STORAGE_KEY) ?? "{}"), {
    agentA: "design",
    agentB: null,
    agentC: "ops",
  });
  assert.deepEqual(JSON.parse(memoryStorage.getItem(PINNED_EMPLOYEES_STORAGE_KEY) ?? "[]"), [
    "agentA",
    "agentB",
  ]);
  assert.deepEqual(JSON.parse(memoryStorage.getItem(SIDEBAR_AGENT_META_STORAGE_KEY) ?? "{}"), {
    agentA: {
      departmentId: "design",
      pinned: true,
    },
    agentB: {
      pinned: true,
    },
    agentC: {
      departmentId: "ops",
      pinned: false,
    },
  });
});

void test("clearSidebarDepartmentAssignments 会清空部门并保留其他元数据", () => {
  writeSidebarAgentMetaMap({
    agentA: {
      departmentId: "design",
      pinned: true,
    },
    agentB: {
      departmentId: "design",
    },
    agentC: {
      pinned: true,
    },
    agentD: {},
  });

  clearSidebarDepartmentAssignments("design");

  assert.deepEqual(readSidebarAgentMetaMap(), {
    agentA: {
      departmentId: undefined,
      pinned: true,
    },
    agentC: {
      departmentId: undefined,
      pinned: true,
    },
  });
});

void test("readSidebarAgentMetaMap 会兼容旧版合并存储结构", () => {
  memoryStorage.setItem(
    SIDEBAR_AGENT_META_STORAGE_KEY,
    JSON.stringify({
      agentA: {
        departmentId: "design",
        pinned: true,
      },
      agentB: {
        pinned: true,
      },
    }),
  );

  assert.deepEqual(readSidebarAgentMetaMap(), {
    agentA: {
      departmentId: "design",
      pinned: true,
    },
    agentB: {
      departmentId: undefined,
      pinned: true,
    },
  });
});

void test("writeSidebarDirectArchives 会保留 1v1 归档完整消息并按最新时间排序", () => {
  writeSidebarDirectArchives(
    [
      {
        id: "archive-older",
        agentId: "agent-1",
        agentName: "小红",
        title: "小红 - 2026.03.16",
        agentRole: "产品经理",
        agentAvatarText: "红",
        preview: "旧消息",
        archivedAt: "2026-03-16T10:00:00.000Z",
        messages: [
          {
            id: "message-1",
            role: "assistant",
            content: "这是一条旧归档消息",
            timestamp: 1_742_117_200_000,
            isNew: true,
            isHistorical: false,
          },
        ],
      },
      {
        id: "archive-newer",
        agentId: "agent-2",
        agentName: "小蓝",
        title: "小蓝 - 2026.03.17",
        preview: "新消息",
        archivedAt: "2026-03-17T10:00:00.000Z",
        messages: [
          {
            id: "message-2",
            role: "user",
            content: "这是最新归档",
            timestamp: 1_742_203_600_000,
            isNew: true,
            isHistorical: false,
          },
        ],
      },
    ],
    {
      skipRemoteSync: true,
    },
  );

  const archives = readSidebarDirectArchives();
  assert.equal(archives[0]?.id, "archive-newer");
  assert.equal(archives[1]?.id, "archive-older");
  assert.deepEqual(archives[0]?.messages, [
    {
      id: "message-2",
      role: "user",
      content: "这是最新归档",
      timestamp: 1_742_203_600_000,
      usage: undefined,
      isLoading: false,
      isNew: false,
      isHistorical: true,
    },
  ]);

  const persisted = JSON.parse(memoryStorage.getItem(SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY) ?? "[]");
  assert.equal(persisted[0].agentName, "小蓝");
  assert.equal(persisted[0].messages[0].isHistorical, true);
});

void test("readSidebarDirectArchives 会为缺少 title 的旧归档自动补默认标题和序号", () => {
  memoryStorage.setItem(
    SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY,
    JSON.stringify([
      {
        id: "archive-1",
        agentId: "agent-1",
        agentName: "小红",
        archivedAt: "2026-03-16T10:00:00.000Z",
        messages: [],
      },
      {
        id: "archive-2",
        agentId: "agent-1",
        agentName: "小红",
        archivedAt: "2026-03-16T12:00:00.000Z",
        messages: [],
      },
    ]),
  );

  const archives = readSidebarDirectArchives();
  assert.equal(archives[0]?.title, "小红 - 2026.03.16 (2)");
  assert.equal(archives[1]?.title, "小红 - 2026.03.16");
});

void test("readSidebarDirectArchives 会兼容旧版块消息和别名字段", () => {
  memoryStorage.setItem(
    SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY,
    JSON.stringify([
      {
        archiveId: "archive-legacy",
        employeeId: "agent-legacy",
        employeeName: "旧成员",
        role: "分析师",
        createdAt: "2026-03-17T09:20:00.000Z",
        history: [
          {
            id: "legacy-message-1",
            role: "assistant",
            content: [{ type: "text", text: "旧版 1v1 归档内容" }],
            thinking: "旧版思考过程",
            timestamp: 1_742_203_600_000,
          },
        ],
      },
    ]),
  );

  const archives = readSidebarDirectArchives();
  assert.equal(archives.length, 1);
  assert.equal(archives[0]?.id, "archive-legacy");
  assert.equal(archives[0]?.agentId, "agent-legacy");
  assert.equal(archives[0]?.agentName, "旧成员");
  assert.equal(archives[0]?.agentRole, "分析师");
  assert.equal(archives[0]?.messages[0]?.content, "旧版 1v1 归档内容");
  assert.equal(archives[0]?.messages[0]?.thinking, "旧版思考过程");
});

void test("readSidebarDirectArchives 会保留缺少 archiveId 的旧 1v1 归档元数据", () => {
  memoryStorage.setItem(
    SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY,
    JSON.stringify([
      {
        employeeId: "agent-legacy",
        employeeName: "旧成员",
      },
    ]),
  );

  const archives = readSidebarDirectArchives();
  assert.equal(archives.length, 1);
  assert.equal(archives[0]?.id, "direct-archive:agent-legacy");
  assert.equal(archives[0]?.agentId, "agent-legacy");
  assert.equal(archives[0]?.agentName, "旧成员");
  assert.equal(archives[0]?.archivedAt, new Date(0).toISOString());
  assert.equal(archives[0]?.preview, "已归档，可稍后回看");
  assert.deepEqual(archives[0]?.messages, []);
});

void test("renameSidebarDirectArchiveById 会同步更新 1v1 归档标题和本地缓存", async () => {
  globalThis.fetch = (async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.endsWith("/storage/health")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/archives/archive-rename") && method === "PUT") {
      return new Response(
        JSON.stringify({
          id: "archive-rename",
          type: "direct",
          source_id: "agent-1",
          source_name: "小红",
          title: "新的 1v1 标题",
          messages: [],
          message_count: 0,
          archived_at: "2026-03-16T10:00:00.000Z",
          created_at: "2026-03-16T10:00:00.000Z",
          updated_at: "2026-03-16T10:00:01.000Z",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  writeSidebarDirectArchives(
    [
      {
        id: "archive-rename",
        agentId: "agent-1",
        agentName: "小红",
        title: "小红 - 2026.03.16",
        preview: "归档内容",
        archivedAt: "2026-03-16T10:00:00.000Z",
        messages: [],
      },
    ],
    {
      skipRemoteSync: true,
    },
  );

  const result = await renameSidebarDirectArchiveById("archive-rename", "新的 1v1 标题");

  assert.equal(result.renamed, true);
  assert.equal(result.archives[0]?.title, "新的 1v1 标题");

  const persisted = JSON.parse(memoryStorage.getItem(SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY) ?? "[]");
  assert.equal(persisted[0]?.title, "新的 1v1 标题");
});

void test("hydrateSidebarDirectArchivesFromApi 会优先使用后端 1v1 归档并回写本地缓存", async () => {
  globalThis.fetch = (async (input) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.endsWith("/storage/health")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/archives?type=direct")) {
      return new Response(
        JSON.stringify([
          {
            id: "archive-remote",
            type: "direct",
            source_id: "agent-remote",
            source_name: "后端成员",
            title: "后端归档",
            messages: [
              {
                id: "msg-1",
                role: "assistant",
                content: "来自后端的 1v1 归档",
                timestamp: 1_742_203_600_000,
              },
            ],
            message_count: 1,
            archived_at: "2026-03-17T09:20:00.000Z",
            created_at: "2026-03-17T09:20:00.000Z",
            updated_at: "2026-03-17T09:20:00.000Z",
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const archives = await hydrateSidebarDirectArchivesFromApi();
  assert.equal(archives.length, 1);
  assert.equal(archives[0]?.id, "archive-remote");
  assert.equal(archives[0]?.agentName, "后端成员");
  assert.equal(archives[0]?.messages[0]?.content, "来自后端的 1v1 归档");

  const persisted = JSON.parse(memoryStorage.getItem(SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY) ?? "[]");
  assert.equal(persisted[0]?.id, "archive-remote");
});

void test("hydrateSidebarDirectArchivesFromApi 不依赖 storage health 也会直连归档接口", async () => {
  const requests: string[] = [];

  globalThis.fetch = (async (input) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requests.push(url);

    if (url.includes("/archives?type=direct")) {
      return new Response(
        JSON.stringify([
          {
            id: "archive-remote-no-health",
            type: "direct",
            source_id: "agent-remote",
            source_name: "后端成员",
            title: "后端归档",
            messages: [],
            message_count: 0,
            archived_at: "2026-03-17T09:20:00.000Z",
            created_at: "2026-03-17T09:20:00.000Z",
            updated_at: "2026-03-17T09:20:00.000Z",
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const archives = await hydrateSidebarDirectArchivesFromApi();
  assert.equal(archives.length, 1);
  assert.equal(archives[0]?.id, "archive-remote-no-health");
  assert.equal(
    requests.some((url) => url.endsWith("/storage/health")),
    false,
  );
});

void test("hydrateSidebarDirectArchivesFromApi 不会把其他浏览器残留的本地 1v1 归档重新补回后端", async () => {
  const requests: Array<{ url: string; method: string }> = [];

  globalThis.fetch = (async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    requests.push({ url, method });

    if (url.endsWith("/storage/health")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/archives?type=direct") && method === "GET") {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  writeSidebarDirectArchives(
    [
      {
        id: "archive-stale-remote-missing",
        agentId: "agent-1",
        agentName: "五爷",
        title: "五爷 - 999 - 26/03/27",
        preview: "旧浏览器残留",
        archivedAt: "2026-03-27T10:00:00.000Z",
        messages: [],
      },
    ],
    {
      skipRemoteSync: true,
    },
  );

  const archives = await hydrateSidebarDirectArchivesFromApi();
  assert.equal(archives.length, 0);

  const persisted = JSON.parse(memoryStorage.getItem(SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY) ?? "[]");
  assert.equal(persisted.length, 0);
  assert.equal(
    requests.some((request) => request.method === "POST" && request.url.includes("/archives")),
    false,
  );
});

void test("removeSidebarDirectArchiveById 会先更新本地缓存并在后台完成删除", async () => {
  const deleteRequest = createDeferred<void>();

  globalThis.fetch = (async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.endsWith("/storage/health")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/archives/archive-delete") && method === "DELETE") {
      await deleteRequest.promise;
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  writeSidebarDirectArchives(
    [
      {
        id: "archive-delete",
        agentId: "agent-1",
        agentName: "小红",
        title: "小红 - 2026.03.18",
        preview: "待删除归档",
        archivedAt: "2026-03-18T10:00:00.000Z",
        messages: [],
      },
    ],
    {
      skipRemoteSync: true,
    },
  );

  const removalPromise = removeSidebarDirectArchiveById("archive-delete");
  await Promise.resolve();

  const beforeDeleteFinishes = JSON.parse(
    memoryStorage.getItem(SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY) ?? "[]",
  );
  assert.equal(beforeDeleteFinishes.length, 0);

  deleteRequest.resolve();

  const nextArchives = await removalPromise;
  assert.equal(nextArchives.length, 0);

  const persisted = JSON.parse(memoryStorage.getItem(SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY) ?? "[]");
  assert.equal(persisted.length, 0);
});

void test("removeSidebarDirectArchiveById 不依赖 storage health 也会直接删除远端归档", async () => {
  const requests: Array<{ url: string; method: string }> = [];

  globalThis.fetch = (async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    requests.push({ url, method });

    if (url.includes("/archives/archive-delete-no-health") && method === "DELETE") {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  writeSidebarDirectArchives(
    [
      {
        id: "archive-delete-no-health",
        agentId: "agent-1",
        agentName: "小红",
        title: "小红 - 2026.03.18",
        preview: "待删除归档",
        archivedAt: "2026-03-18T10:00:00.000Z",
        messages: [],
      },
    ],
    {
      skipRemoteSync: true,
    },
  );

  const nextArchives = await removeSidebarDirectArchiveById("archive-delete-no-health");
  assert.equal(nextArchives.length, 0);
  assert.equal(
    requests.some((request) => request.url.endsWith("/storage/health")),
    false,
  );
  assert.equal(
    requests.some(
      (request) =>
        request.method === "DELETE" && request.url.includes("/archives/archive-delete-no-health"),
    ),
    true,
  );
});

void test("removeSidebarDirectArchiveById 删除进行中时 hydration 不会把归档写回本地", async () => {
  const deleteRequest = createDeferred<void>();

  globalThis.fetch = (async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.endsWith("/storage/health")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/archives/archive-delete") && method === "DELETE") {
      await deleteRequest.promise;
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/archives?type=direct") && method === "GET") {
      return new Response(
        JSON.stringify([
          {
            id: "archive-delete",
            type: "direct",
            source_id: "agent-1",
            source_name: "小红",
            title: "小红 - 2026.03.18",
            messages: [],
            message_count: 0,
            archived_at: "2026-03-18T10:00:00.000Z",
            created_at: "2026-03-18T10:00:00.000Z",
            updated_at: "2026-03-18T10:00:00.000Z",
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  writeSidebarDirectArchives(
    [
      {
        id: "archive-delete",
        agentId: "agent-1",
        agentName: "小红",
        title: "小红 - 2026.03.18",
        preview: "待删除归档",
        archivedAt: "2026-03-18T10:00:00.000Z",
        messages: [],
      },
    ],
    {
      skipRemoteSync: true,
    },
  );

  const removalPromise = removeSidebarDirectArchiveById("archive-delete");
  await Promise.resolve();

  const archives = await hydrateSidebarDirectArchivesFromApi();
  assert.equal(archives.length, 0);

  const persisted = JSON.parse(memoryStorage.getItem(SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY) ?? "[]");
  assert.equal(persisted.length, 0);

  deleteRequest.resolve();
  await removalPromise;
});

void test("hydrateSidebarDirectArchivesFromApi 不会用过期快照覆盖删除后的本地状态", async () => {
  const listRequest = createDeferred<Response>();

  globalThis.fetch = (async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.endsWith("/storage/health")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/archives?type=direct") && method === "GET") {
      return listRequest.promise;
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  writeSidebarDirectArchives(
    [
      {
        id: "archive-stale",
        agentId: "agent-1",
        agentName: "小红",
        title: "小红 - 2026.03.19",
        preview: "过期归档",
        archivedAt: "2026-03-19T10:00:00.000Z",
        messages: [],
      },
    ],
    {
      skipRemoteSync: true,
    },
  );

  const hydrationPromise = hydrateSidebarDirectArchivesFromApi();
  await Promise.resolve();

  writeSidebarDirectArchives([], {
    skipRemoteSync: true,
  });

  listRequest.resolve(
    new Response(
      JSON.stringify([
        {
          id: "archive-stale",
          type: "direct",
          source_id: "agent-1",
          source_name: "小红",
          title: "小红 - 2026.03.19",
          messages: [],
          message_count: 0,
          archived_at: "2026-03-19T10:00:00.000Z",
          created_at: "2026-03-19T10:00:00.000Z",
          updated_at: "2026-03-19T10:00:00.000Z",
        },
      ]),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    ),
  );

  const archives = await hydrationPromise;
  assert.equal(archives.length, 0);

  const persisted = JSON.parse(memoryStorage.getItem(SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY) ?? "[]");
  assert.equal(persisted.length, 0);
});

void test("sidebar unread 状态支持累加与清零", () => {
  incrementSidebarDirectUnreadCount("agent-1");
  incrementSidebarDirectUnreadCount("agent-1", 2);
  incrementSidebarGroupUnreadCount("group-1");
  incrementSidebarGroupUnreadCount("group-2", 3);

  assert.deepEqual(readSidebarUnreadState(), {
    directByAgentId: {
      "agent-1": 3,
    },
    groupById: {
      "group-1": 1,
      "group-2": 3,
    },
  });

  clearSidebarDirectUnreadCount("agent-1");
  clearSidebarGroupUnreadCount("group-1");

  assert.deepEqual(readSidebarUnreadState(), {
    directByAgentId: {},
    groupById: {
      "group-2": 3,
    },
  });

  const persisted = JSON.parse(memoryStorage.getItem(SIDEBAR_UNREAD_STORAGE_KEY) ?? "{}");
  assert.deepEqual(persisted, {
    directByAgentId: {},
    groupById: {
      "group-2": 3,
    },
  });
});

void test("subscribeSidebarStorage 会在同页部门写入后立即通知", () => {
  let notifyCount = 0;
  const unsubscribe = subscribeSidebarStorage(() => {
    notifyCount += 1;
  }, [SIDEBAR_DEPARTMENTS_STORAGE_KEY]);

  writeSidebarDepartments([
    {
      id: "engineering",
      name: "研发部",
      icon: "💻",
      sortOrder: 0,
    },
  ]);
  writeSidebarAgentMetaMap({
    agentA: {
      departmentId: "engineering",
    },
  });

  unsubscribe();

  assert.equal(notifyCount, 1);
});
