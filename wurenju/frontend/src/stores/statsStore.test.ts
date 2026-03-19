import assert from "node:assert/strict";
import { after, afterEach, before } from "node:test";
import test from "node:test";
import { createEmptyHealthRecord, type AgentHealthRecord } from "@/utils/health";
import { resolveHourlyBucket } from "@/utils/stats";
import { useStatsStore } from "./statsStore";

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

function createRecord(interactions: AgentHealthRecord["interactions"]): AgentHealthRecord {
  return {
    ...createEmptyHealthRecord(),
    interactions,
  };
}

before(() => {
  Object.defineProperty(globalThis, "window", {
    value: new MockWindow(memoryStorage),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  memoryStorage.clear();
  useStatsStore.setState({
    hourlyStatsByKey: {},
    syncCursorByAgentId: {},
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
});

void test("statsStore 会按小时聚合且重复同步不会重复计数", () => {
  const base = Date.now() - 2 * 60 * 60 * 1000;
  const sameHour = resolveHourlyBucket(base + 10 * 60 * 1000);
  const nextHour = resolveHourlyBucket(base + 70 * 60 * 1000);

  const record = createRecord([
    {
      id: "interaction-1",
      kind: "chat.send",
      requestId: "req-1",
      sessionKey: "agent:stats-agent:main",
      startedAt: base,
      completedAt: base + 10 * 60 * 1000,
      latencyMs: 800,
      success: true,
      model: "openai/gpt-5.4",
      tokenInput: 120,
      tokenOutput: 60,
      tokenCacheRead: 20,
      tokenCacheWrite: 0,
      tokenTotal: 200,
    },
    {
      id: "interaction-2",
      kind: "chat.send",
      requestId: "req-2",
      sessionKey: "agent:stats-agent:main",
      startedAt: base + 15 * 60 * 1000,
      completedAt: base + 25 * 60 * 1000,
      latencyMs: 1200,
      success: true,
      model: "openai/gpt-5.4",
      tokenInput: 80,
      tokenOutput: 30,
      tokenCacheRead: 10,
      tokenCacheWrite: 5,
      tokenTotal: 125,
      usedFallback: true,
    },
    {
      id: "interaction-3",
      kind: "chat.send",
      requestId: "req-3",
      sessionKey: "agent:stats-agent:main",
      startedAt: base + 60 * 60 * 1000,
      completedAt: base + 70 * 60 * 1000,
      success: false,
      model: "anthropic/claude-sonnet-4.5",
      errorMessage: "timeout",
    },
  ]);

  useStatsStore.getState().syncAgentRecord("stats-agent", record);
  useStatsStore.getState().syncAgentRecord("stats-agent", record);

  const state = useStatsStore.getState();
  const firstHourStats = state.hourlyStatsByKey[`stats-agent:${sameHour.date}:${sameHour.hour}`];
  const secondHourStats = state.hourlyStatsByKey[`stats-agent:${nextHour.date}:${nextHour.hour}`];

  assert.equal(firstHourStats?.messageCount, 2);
  assert.equal(firstHourStats?.turnCount, 2);
  assert.equal(firstHourStats?.tokenTotal, 325);
  assert.equal(firstHourStats?.fallbackCount, 1);
  assert.equal(firstHourStats?.avgResponseMs, 1000);
  assert.equal(firstHourStats?.modelUsed, "openai/gpt-5.4");

  assert.equal(secondHourStats?.messageCount, 0);
  assert.equal(secondHourStats?.turnCount, 1);
  assert.equal(secondHourStats?.errorCount, 1);
  assert.equal(secondHourStats?.tokenTotal, 0);
});

void test("initialize 会清理 30 天前的旧聚合数据", () => {
  const oldTimestamp = Date.now() - 31 * 24 * 60 * 60 * 1000;
  const oldBucket = resolveHourlyBucket(oldTimestamp);

  useStatsStore.setState({
    hourlyStatsByKey: {
      [`legacy-agent:${oldBucket.date}:${oldBucket.hour}`]: {
        id: `legacy-agent:${oldBucket.date}:${oldBucket.hour}`,
        agentId: "legacy-agent",
        date: oldBucket.date,
        hour: oldBucket.hour,
        bucketStartAt: oldBucket.bucketStartAt,
        messageCount: 4,
        turnCount: 4,
        tokenInput: 0,
        tokenOutput: 0,
        tokenCacheRead: 0,
        tokenCacheWrite: 0,
        tokenTotal: 0,
        totalResponseMs: 0,
        responseSampleCount: 0,
        avgResponseMs: 0,
        errorCount: 0,
        fallbackCount: 0,
        modelUsed: null,
        modelCounts: {},
        updatedAt: oldTimestamp,
      },
    },
    syncCursorByAgentId: {
      "legacy-agent": {
        lastCompletedAt: oldTimestamp,
        lastInteractionIds: ["legacy-1"],
      },
    },
  });

  useStatsStore.getState().initialize();

  assert.deepEqual(useStatsStore.getState().hourlyStatsByKey, {});
  assert.deepEqual(useStatsStore.getState().syncCursorByAgentId, {});
});
