import assert from "node:assert/strict";
import { after, afterEach, before } from "node:test";
import test from "node:test";
import { gateway } from "@/services/gateway";
import { useAgentStore } from "@/stores/agentStore";
import type { MetricSnapshot } from "@/types/growth";
import { usePromptVersionStore } from "./promptVersionStore";

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
const originalSaveAgentFile = gateway.saveAgentFile.bind(gateway);

const TEST_METRICS: MetricSnapshot = {
  agentId: "agent-prompt",
  label: "test",
  startAt: 0,
  endAt: 1,
  sampleDays: 7,
  messageCount: 12,
  turnCount: 12,
  avgResponseMs: 1200,
  errorCount: 1,
  errorRate: 0.08,
  errorTypes: {},
  tokenTotal: 1500,
  tokenEfficiency: 8,
  tokenPerMessage: 125,
  healthScore: 82,
  healthLevel: "healthy",
  modelUsed: "openai/gpt-5.4",
  mainModel: "openai/gpt-5.4",
  backupModel: null,
  fallbackCount: 0,
  modelCounts: { "openai/gpt-5.4": 12 },
};

before(() => {
  Object.defineProperty(globalThis, "window", {
    value: new MockWindow(memoryStorage),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  memoryStorage.clear();
  usePromptVersionStore.setState({
    versions: [],
    rollbackRecords: [],
    activeVersionIdByKey: {},
  });
  useAgentStore.setState({
    agents: [{ id: "agent-prompt", name: "小虾", emoji: "🦞" }],
    agentFiles: new Map(),
    showDetailFor: "agent-prompt",
    activeFileName: "IDENTITY.md",
    fileContent: "",
    fileDirty: false,
  });
});

after(() => {
  gateway.saveAgentFile = originalSaveAgentFile;
  if (originalWindow === undefined) {
    delete (globalThis as { window?: Window }).window;
  } else {
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
  }
});

void test("saveVersionedPrompt 会补初始基线版本并激活最新版本", async () => {
  const saved: Array<{ agentId: string; fileName: string; content: string }> = [];
  gateway.saveAgentFile = (async (agentId, fileName, content) => {
    saved.push({ agentId, fileName, content });
    return true;
  }) as typeof gateway.saveAgentFile;

  const version = await usePromptVersionStore.getState().saveVersionedPrompt({
    agentId: "agent-prompt",
    fileName: "IDENTITY.md",
    previousContent: "# 小虾\n- Role: 老版本\n",
    nextContent: "# 小虾\n- Role: 新版本\n",
    changeDescription: "应用周度自评建议",
    source: "self_review",
    metrics: TEST_METRICS,
  });

  assert.equal(saved.length, 1);
  assert.equal(version?.version, "v1.1");
  assert.equal(usePromptVersionStore.getState().versions.length, 2);
  assert.equal(
    usePromptVersionStore.getState().getActiveVersionId("agent-prompt", "IDENTITY.md"),
    version?.id ?? null,
  );
});

void test("rollbackToVersion 会切换活动版本并记录回滚记录", async () => {
  gateway.saveAgentFile = (async () => true) as typeof gateway.saveAgentFile;

  const created = await usePromptVersionStore.getState().saveVersionedPrompt({
    agentId: "agent-prompt",
    fileName: "IDENTITY.md",
    previousContent: "# 小虾\n- Role: 基线\n",
    nextContent: "# 小虾\n- Role: 版本一\n",
    changeDescription: "第一次修改",
    source: "manual",
    metrics: TEST_METRICS,
  });

  const baseline = usePromptVersionStore
    .getState()
    .versions.find((version) => version.version === "v1.0");

  assert.ok(created);
  assert.ok(baseline);

  const rollback = await usePromptVersionStore.getState().rollbackToVersion({
    agentId: "agent-prompt",
    fileName: "IDENTITY.md",
    versionId: baseline.id,
    reason: "手动回滚测试",
    metrics: TEST_METRICS,
  });

  assert.ok(rollback);
  assert.equal(usePromptVersionStore.getState().rollbackRecords.length, 1);
  assert.equal(
    usePromptVersionStore.getState().getActiveVersionId("agent-prompt", "IDENTITY.md"),
    baseline.id,
  );
});
