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
  incrementSidebarDirectUnreadCount,
  incrementSidebarGroupUnreadCount,
  readSidebarAgentMetaMap,
  readSidebarDepartments,
  readSidebarDirectArchives,
  readSidebarUnreadState,
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

const memoryStorage = new MemoryStorage();
const originalWindow = globalThis.window;
const originalCustomEvent = globalThis.CustomEvent;

before(() => {
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
  writeSidebarDirectArchives([
    {
      id: "archive-older",
      agentId: "agent-1",
      agentName: "小红",
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
  ]);

  const archives = readSidebarDirectArchives();
  assert.equal(archives[0]?.id, "archive-newer");
  assert.equal(archives[1]?.id, "archive-older");
  assert.deepEqual(archives[0]?.messages, [
    {
      id: "message-2",
      role: "user",
      content: "这是最新归档",
      thinking: undefined,
      model: undefined,
      usage: undefined,
      timestamp: 1_742_203_600_000,
      timestampLabel: undefined,
      isLoading: false,
      isNew: false,
      isHistorical: true,
    },
  ]);

  const persisted = JSON.parse(memoryStorage.getItem(SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY) ?? "[]");
  assert.equal(persisted[0].agentName, "小蓝");
  assert.equal(persisted[0].messages[0].isHistorical, true);
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
