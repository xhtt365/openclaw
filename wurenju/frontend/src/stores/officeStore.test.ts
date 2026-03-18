import assert from "node:assert/strict";
import { after, afterEach, before } from "node:test";
import test from "node:test";
import { gateway } from "../services/gateway";
import { useAgentStore, type Agent } from "./agentStore";
import { useChatStore } from "./chatStore";
import { useOfficeStore } from "./officeStore";

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

  setTimeout = globalThis.setTimeout.bind(globalThis);
  clearTimeout = globalThis.clearTimeout.bind(globalThis);
  setInterval = (() => 0) as unknown as typeof globalThis.setInterval;
  clearInterval = (() => undefined) as typeof globalThis.clearInterval;
}

type GatewayAddEventHandler = typeof gateway.addEventHandler;
type GatewayConnect = typeof gateway.connect;
type GatewayGetSessionRuntimeState = typeof gateway.getSessionRuntimeState;
type GatewayListCronJobs = typeof gateway.listCronJobs;
type GatewayEventHandler = Parameters<GatewayAddEventHandler>[0];

const originalWindow = globalThis.window;
const memoryStorage = new MemoryStorage();
const originalAddEventHandler = gateway.addEventHandler.bind(gateway);
const originalConnect = gateway.connect.bind(gateway);
const originalGetSessionRuntimeState = gateway.getSessionRuntimeState.bind(gateway);
const originalListCronJobs = gateway.listCronJobs.bind(gateway);

const OFFICE_AGENT: Agent = {
  id: "office-agent",
  name: "小虾",
  role: "工程师",
  emoji: "🦞",
  modelName: "openai/gpt-5.4",
};

let eventHandler: GatewayEventHandler | null = null;

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
  eventHandler = null;

  useAgentStore.setState({
    agents: [],
    currentAgentId: "",
    mainKey: "",
    showDetailFor: null,
  });
  useChatStore.setState({
    messagesByAgentId: new Map(),
    usageByAgentId: new Map(),
    contextWindowSizeByAgentId: new Map(),
    currentContextUsedByAgentId: new Map(),
    historyLoadedByAgentId: new Map(),
    historyLoadingByAgentId: new Map(),
    activeReplyAgentId: null,
    status: "connected",
  });
  useOfficeStore.setState({
    agentZones: new Map(),
    agentStatus: new Map(),
    agentMetrics: new Map(),
    activityLog: [],
    animationQueue: [],
    agentAnimations: new Map(),
    scheduledTasks: [],
    initialized: false,
  });
});

after(() => {
  gateway.addEventHandler = originalAddEventHandler;
  gateway.connect = originalConnect;
  gateway.getSessionRuntimeState = originalGetSessionRuntimeState;
  gateway.listCronJobs = originalListCronJobs;

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

void test("办公室状态会在完整输出后才从 chat 切到 work", async () => {
  gateway.connect = (() => undefined) as GatewayConnect;
  gateway.getSessionRuntimeState = (async () => ({
    contextWindowSize: 0,
    currentContextUsed: 0,
    currentContextUsedFresh: false,
    sessionFound: true,
  })) as GatewayGetSessionRuntimeState;
  gateway.listCronJobs = (async () => ({ jobs: [] })) as GatewayListCronJobs;
  gateway.addEventHandler = ((handler: GatewayEventHandler) => {
    eventHandler = handler;
    return () => {
      if (eventHandler === handler) {
        eventHandler = null;
      }
    };
  }) as GatewayAddEventHandler;

  useAgentStore.setState({
    agents: [OFFICE_AGENT],
    mainKey: "main",
  });
  useChatStore.setState({
    messagesByAgentId: new Map(),
    usageByAgentId: new Map(),
    contextWindowSizeByAgentId: new Map(),
    currentContextUsedByAgentId: new Map(),
    historyLoadedByAgentId: new Map(),
    historyLoadingByAgentId: new Map(),
    activeReplyAgentId: null,
    status: "connected",
  });

  useOfficeStore.getState().initialize();
  assert.equal(eventHandler !== null, true);

  useChatStore.setState({
    messagesByAgentId: new Map([
      [
        OFFICE_AGENT.id,
        [
          {
            id: "user-message-1",
            role: "user",
            content: "先回复我，再查资料",
            timestamp: 1_742_300_000_000,
            isNew: true,
            isHistorical: false,
          },
        ],
      ],
    ]),
  });

  await wait(240);
  await wait(40);
  assert.equal(useOfficeStore.getState().agentZones.get(OFFICE_AGENT.id), "chat");

  eventHandler?.("agent", {
    runId: "run-1",
    stream: "tool",
    ts: 1_742_300_001_000,
    sessionKey: "agent:office-agent:main",
    data: {
      phase: "start",
      name: "functions.read",
      args: { path: "/tmp/demo.md" },
    },
  });

  await wait(220);
  assert.equal(useOfficeStore.getState().agentZones.get(OFFICE_AGENT.id), "chat");

  eventHandler?.("agent", {
    runId: "run-1",
    stream: "assistant",
    ts: 1_742_300_002_000,
    sessionKey: "agent:office-agent:main",
    data: {
      phase: "delta",
    },
  });

  await wait(220);
  assert.equal(useOfficeStore.getState().agentZones.get(OFFICE_AGENT.id), "chat");

  eventHandler?.("chat", {
    runId: "run-1",
    state: "final",
    sessionKey: "agent:office-agent:main",
    message: {
      timestamp: 1_742_300_003_000,
      role: "assistant",
      content: "工具执行完成，结果已返回",
    },
  });

  await wait(220);
  assert.equal(useOfficeStore.getState().agentZones.get(OFFICE_AGENT.id), "work");
  assert.match(
    useOfficeStore
      .getState()
      .activityLog.map((item) => item.text)
      .join(" | "),
    /切到办公区继续处理|开始输出回复/,
  );
  await wait(320);
});
