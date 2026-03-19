import assert from "node:assert/strict";
import { after, afterEach, before } from "node:test";
import test from "node:test";
import {
  readLocalStorageItem,
  runStorageMaintenance,
  writeLocalStorageItem,
} from "@/utils/storage";

class QuotaMemoryStorage implements Storage {
  private storage = new Map<string, string>();

  constructor(private quotaBytes: number) {}

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
    const currentValue = this.storage.get(key);
    const nextBytes =
      this.totalBytes() - this.entryBytes(key, currentValue) + this.entryBytes(key, value);
    if (nextBytes > this.quotaBytes) {
      const error = new Error("Quota exceeded");
      error.name = "QuotaExceededError";
      throw error;
    }

    this.storage.set(key, value);
  }

  totalBytes() {
    return Array.from(this.storage.entries()).reduce(
      (total, [key, value]) => total + this.entryBytes(key, value),
      0,
    );
  }

  private entryBytes(key: string, value: string | undefined) {
    if (typeof value !== "string") {
      return 0;
    }

    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(key).length + new TextEncoder().encode(value).length;
    }

    return (key.length + value.length) * 2;
  }
}

const originalWindow = globalThis.window;

function createGroupSnapshot(messageCount: number, contentSize: number) {
  return {
    groups: [
      {
        id: "group-1",
        name: "项目组 1",
        members: [],
        leaderId: "leader",
        createdAt: "2026-03-19T10:00:00.000Z",
      },
    ],
    selectedGroupId: "group-1",
    selectedArchiveId: null,
    messagesByGroupId: {
      "group-1": Array.from({ length: messageCount }, (_, index) => ({
        id: `message-${index}`,
        role: "assistant",
        content: `${index}-${"消息".repeat(contentSize)}`,
        timestamp: 1_742_000_000_000 + index,
      })),
    },
    archives: [],
  };
}

function createDirectArchives(archiveCount: number, messageCount: number, contentSize: number) {
  return Array.from({ length: archiveCount }, (_, archiveIndex) => ({
    id: `archive-${archiveIndex}`,
    agentId: `agent-${archiveIndex}`,
    agentName: `员工 ${archiveIndex}`,
    title: `归档 ${archiveIndex}`,
    preview: "预览",
    archivedAt: new Date(1_742_000_000_000 + archiveIndex * 1_000).toISOString(),
    messages: Array.from({ length: messageCount }, (_, messageIndex) => ({
      id: `archive-${archiveIndex}-message-${messageIndex}`,
      role: "assistant",
      content: `${messageIndex}-${"归档".repeat(contentSize)}`,
      timestamp: 1_742_000_000_000 + messageIndex,
    })),
  }));
}

before(() => {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: new QuotaMemoryStorage(10_000_000) },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  (globalThis.window as unknown as { localStorage: QuotaMemoryStorage }).localStorage.clear();
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

void test("配额不足时会先清理群聊压缩备份，再保存项目组快照", () => {
  const storage = new QuotaMemoryStorage(24_000);
  storage.seed("compacted:group-1:agent-a:1", "x".repeat(12_000));
  storage.seed("compacted:group-1:agent-b:1", "y".repeat(8_000));
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: storage },
    configurable: true,
    writable: true,
  });

  const saved = writeLocalStorageItem(
    "wurenju.groups.v1",
    JSON.stringify(createGroupSnapshot(24, 40)),
    { silent: true },
  );

  assert.equal(saved, true);
  assert.equal(readLocalStorageItem("wurenju.groups.v1") !== null, true);
  assert.equal(
    readLocalStorageItem("compacted:group-1:agent-a:1") === null ||
      readLocalStorageItem("compacted:group-1:agent-b:1") === null,
    true,
  );
});

void test("项目组快照超出配额时会自动裁剪旧消息而不是直接失败", () => {
  const storage = new QuotaMemoryStorage(160_000);
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: storage },
    configurable: true,
    writable: true,
  });

  const originalSnapshot = createGroupSnapshot(2_000, 60);
  const saved = writeLocalStorageItem("wurenju.groups.v1", JSON.stringify(originalSnapshot), {
    silent: true,
  });

  assert.equal(saved, true);
  const persisted = JSON.parse(readLocalStorageItem("wurenju.groups.v1") ?? "{}") as {
    messagesByGroupId?: Record<string, Array<{ id: string }>>;
  };
  const nextMessages = persisted.messagesByGroupId?.["group-1"] ?? [];
  assert.equal(nextMessages.length < originalSnapshot.messagesByGroupId["group-1"].length, true);
  assert.equal(nextMessages.length > 0, true);
});

void test("启动巡检会在超阈值时主动清理旧缓存", () => {
  const storage = new QuotaMemoryStorage(10_000_000);
  storage.seed("compacted:group-1:agent-a:1", "z".repeat(4_300_000));
  storage.seed("xiaban.sidebar.directArchives", JSON.stringify(createDirectArchives(12, 16, 8)));
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: storage },
    configurable: true,
    writable: true,
  });

  const beforeBytes = storage.totalBytes();
  const result = runStorageMaintenance("startup");

  assert.equal(result.changed, true);
  assert.equal(result.totalBytes < beforeBytes, true);
  assert.equal(readLocalStorageItem("compacted:group-1:agent-a:1"), null);
});
