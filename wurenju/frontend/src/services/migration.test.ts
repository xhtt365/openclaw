import assert from "node:assert/strict";
import { after, afterEach, before } from "node:test";
import test from "node:test";
import { runLegacyMigrationIfNeeded } from "./migration";

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

  seed(key: string, value: string) {
    this.storage.set(key, value);
  }

  setItem(key: string, value: string) {
    this.storage.set(key, value);
  }
}

type MigrateRequestBody = {
  employees?: Array<Record<string, unknown>>;
  departments?: Array<Record<string, unknown>>;
  groups?: unknown;
  archives?: unknown[];
  directArchives?: unknown[];
};

const memoryStorage = new MemoryStorage();
const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;
const originalFetch = globalThis.fetch;

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

before(() => {
  Object.defineProperty(globalThis, "window", {
    value: {
      localStorage: memoryStorage,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    },
    configurable: true,
    writable: true,
  });

  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  memoryStorage.clear();
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

  if (originalLocalStorage === undefined) {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  } else {
    Object.defineProperty(globalThis, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
      writable: true,
    });
  }

  globalThis.fetch = originalFetch;
});

void test("runLegacyMigrationIfNeeded 会从群组成员和侧栏元数据补齐 employees", async () => {
  memoryStorage.seed(
    "wurenju.groups.v1",
    JSON.stringify({
      groups: [
        {
          id: "group-1",
          name: "项目组 A",
          leaderId: "agent-1",
          createdAt: "2026-03-20T10:00:00.000Z",
          members: [
            {
              id: "agent-1",
              name: "小王",
              role: "前端",
              avatarUrl: "https://example.com/a.png",
            },
            {
              id: "agent-2",
              name: "小李",
            },
          ],
        },
      ],
    }),
  );
  memoryStorage.seed("employeeDepartmentMap", JSON.stringify({ "agent-1": "dept-design" }));
  memoryStorage.seed("pinnedEmployees", JSON.stringify(["agent-2"]));
  memoryStorage.seed(
    "xiaban.sidebar.directArchives",
    JSON.stringify([
      {
        id: "archive-1",
        agentId: "agent-3",
        agentName: "小赵",
        agentRole: "设计",
        agentAvatarUrl: "https://example.com/c.png",
        preview: "已归档",
        archivedAt: "2026-03-19T08:00:00.000Z",
        messages: [],
      },
    ]),
  );

  let requestBody: MigrateRequestBody = {};
  let didReceiveRequest = false;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body ?? "{}")) as MigrateRequestBody;
    didReceiveRequest = true;
    return jsonResponse({
      success: true,
      imported: {
        employees: requestBody.employees?.length ?? 0,
        departments: requestBody.departments?.length ?? 0,
        groups: 1,
        group_members: 2,
        archives: requestBody.archives?.length ?? 0,
        cron_tasks: 0,
        settings: 0,
      },
    });
  }) as typeof fetch;

  const result = await runLegacyMigrationIfNeeded();
  assert.equal(result.migrated, true);
  assert.equal(didReceiveRequest, true);
  const payload = requestBody;
  const employees = payload.employees ?? [];
  assert.equal(employees.length, 3);

  const employeeById = new Map(
    employees.map(
      (employee: Record<string, unknown>) =>
        [String(employee.id), employee] satisfies [string, Record<string, unknown>],
    ),
  );

  assert.deepEqual(employeeById.get("agent-1"), {
    id: "agent-1",
    name: "小王",
    avatar: "https://example.com/a.png",
    position: "前端",
    department: "dept-design",
    description: null,
    pinned: false,
    sortOrder: 0,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
  });
  assert.deepEqual(employeeById.get("agent-2"), {
    id: "agent-2",
    name: "小李",
    avatar: null,
    position: null,
    department: null,
    description: null,
    pinned: true,
    sortOrder: 1,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
  });
  assert.deepEqual(employeeById.get("agent-3"), {
    id: "agent-3",
    name: "小赵",
    avatar: "https://example.com/c.png",
    position: "设计",
    department: null,
    description: null,
    pinned: false,
    sortOrder: 2,
    createdAt: "2026-03-19T08:00:00.000Z",
    updatedAt: "2026-03-19T08:00:00.000Z",
  });

  assert.equal(memoryStorage.getItem("wurenju.groups.v1"), null);
  assert.equal(memoryStorage.getItem("employeeDepartmentMap"), null);
  assert.equal(memoryStorage.getItem("pinnedEmployees"), null);
});

void test("runLegacyMigrationIfNeeded 会读取驼峰 agentStore key", async () => {
  memoryStorage.seed(
    "agentStore",
    JSON.stringify({
      agents: [
        {
          id: "agent-camel",
          name: "驼峰成员",
          role: "后端",
          avatarUrl: "https://example.com/camel.png",
          pinned: true,
          sortOrder: 7,
        },
      ],
    }),
  );

  let requestBody: MigrateRequestBody = {};
  let didReceiveRequest = false;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body ?? "{}")) as MigrateRequestBody;
    didReceiveRequest = true;
    return jsonResponse({
      success: true,
      imported: {
        employees: requestBody.employees?.length ?? 0,
        departments: 0,
        groups: 0,
        group_members: 0,
        archives: 0,
        cron_tasks: 0,
        settings: 0,
      },
    });
  }) as typeof fetch;

  const result = await runLegacyMigrationIfNeeded();
  assert.equal(result.migrated, true);
  assert.equal(didReceiveRequest, true);
  const payload = requestBody;
  assert.deepEqual(payload.employees, [
    {
      id: "agent-camel",
      name: "驼峰成员",
      avatar: "https://example.com/camel.png",
      position: "后端",
      department: null,
      description: null,
      pinned: true,
      sortOrder: 7,
      createdAt: "1970-01-01T00:00:00.000Z",
      updatedAt: "1970-01-01T00:00:00.000Z",
    },
  ]);
  assert.equal(memoryStorage.getItem("agentStore"), null);
});
