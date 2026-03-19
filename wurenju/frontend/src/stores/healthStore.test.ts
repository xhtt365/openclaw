import assert from "node:assert/strict";
import { after, afterEach, before } from "node:test";
import test from "node:test";
import { gateway } from "../services/gateway";
import { useAgentStore, type Agent } from "./agentStore";
import { useHealthStore } from "./healthStore";

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

  setInterval = globalThis.setInterval.bind(globalThis);
  clearInterval = globalThis.clearInterval.bind(globalThis);
}

const HEALTH_AGENT: Agent = {
  id: "health-agent",
  name: "小虾米",
  role: "运营经理",
  emoji: "🦞",
  modelName: "openai/gpt-5.4",
};

const memoryStorage = new MemoryStorage();
const originalWindow = globalThis.window;
const originalSendRequest = gateway.sendRequest.bind(gateway);

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
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
  useAgentStore.setState({
    agents: [],
    currentAgentId: "",
    mainKey: "",
    showDetailFor: null,
  });
  useHealthStore.getState().stopOfficeProbe();
  useHealthStore.setState({
    recordsByAgentId: {},
    alerts: [],
  });
});

after(() => {
  gateway.sendRequest = originalSendRequest;
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

void test("startOfficeProbe 会在 stopOfficeProbe 后停止额外的 Gateway 请求", async () => {
  let sendRequestCount = 0;
  gateway.sendRequest = (async () => {
    sendRequestCount += 1;
    return {
      defaults: { contextTokens: 128_000 },
      sessions: [
        {
          key: "agent:health-agent:main",
          contextTokens: 128_000,
          totalTokens: 24_000,
          totalTokensFresh: true,
        },
      ],
    };
  }) as typeof gateway.sendRequest;

  useAgentStore.setState({
    agents: [HEALTH_AGENT],
    currentAgentId: HEALTH_AGENT.id,
    mainKey: "main",
    showDetailFor: null,
  });

  useHealthStore.getState().startOfficeProbe([HEALTH_AGENT], 30);
  await wait(80);
  const requestCountBeforeStop = sendRequestCount;

  assert.equal(requestCountBeforeStop >= 2, true);

  useHealthStore.getState().stopOfficeProbe();
  await wait(80);

  assert.equal(sendRequestCount, requestCountBeforeStop);
  assert.equal(useHealthStore.getState().getSummaryForAgent(HEALTH_AGENT.id).sessionState, "alive");
});

void test("recordAssistantMessage 会把 usage 写进 interaction 供统计聚合复用", () => {
  useHealthStore.getState().recordAssistantMessage({
    agentId: HEALTH_AGENT.id,
    sessionKey: "agent:health-agent:main",
    kind: "chat.send",
    message: {
      model: "openai/gpt-5.4",
      provider: "openai",
      usage: {
        input: 120,
        output: 45,
        cacheRead: 30,
        cacheWrite: 10,
        totalTokens: 205,
        cost: { total: 0.0123 },
      },
      timestamp: Date.now(),
    },
  });

  const interaction = useHealthStore
    .getState()
    .recordsByAgentId[HEALTH_AGENT.id]?.interactions.at(-1);

  assert.equal(interaction?.tokenInput, 120);
  assert.equal(interaction?.tokenOutput, 45);
  assert.equal(interaction?.tokenCacheRead, 30);
  assert.equal(interaction?.tokenCacheWrite, 10);
  assert.equal(interaction?.tokenTotal, 205);
  assert.equal(interaction?.tokenCostTotal, 0.0123);
});
