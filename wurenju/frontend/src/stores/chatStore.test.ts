import assert from "node:assert/strict";
import { after, afterEach, before } from "node:test";
import test from "node:test";
import { gateway } from "../services/gateway";
import { readSidebarDirectArchives, readSidebarUnreadState } from "../utils/sidebarPersistence";
import { useAgentStore, type Agent } from "./agentStore";
import { useChatStore } from "./chatStore";
import { useDirectArchiveStore } from "./directArchiveStore";
import { useGroupStore } from "./groupStore";

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

type GatewayPrivate = {
  handleMessage: (frame: Record<string, unknown>) => void;
};

const ARCHIVE_AGENT: Agent = {
  id: "agent-archive",
  name: "小红",
  role: "产品经理",
  emoji: "🌶️",
};

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

  useAgentStore.setState({
    agents: [],
    currentAgentId: "",
    mainKey: "",
    showDetailFor: null,
  });
  useGroupStore.setState({
    selectedGroupId: null,
    selectedArchiveId: null,
  });
  useDirectArchiveStore.setState({
    selectedDirectArchiveId: null,
  });
  useChatStore.setState({
    messagesByAgentId: new Map(),
    usageByAgentId: new Map(),
    contextWindowSizeByAgentId: new Map(),
    currentContextUsedByAgentId: new Map(),
    historyLoadedByAgentId: new Map(),
    historyLoadingByAgentId: new Map(),
    activeReplyAgentId: null,
    status: "disconnected",
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

void test("archiveCurrentSession 会把当前 1v1 消息写入归档并清空会话", async () => {
  const originalDeleteSession = gateway.deleteSession.bind(gateway);
  const deletedSessionKeys: string[] = [];
  gateway.deleteSession = (async (sessionKey: string) => {
    deletedSessionKeys.push(sessionKey);
    return {};
  }) as typeof gateway.deleteSession;

  try {
    useAgentStore.setState({
      agents: [ARCHIVE_AGENT],
      currentAgentId: ARCHIVE_AGENT.id,
      mainKey: "main",
      showDetailFor: null,
    });
    useGroupStore.setState({
      selectedGroupId: null,
      selectedArchiveId: null,
    });
    useDirectArchiveStore.setState({
      selectedDirectArchiveId: null,
    });
    useChatStore.setState({
      messagesByAgentId: new Map([
        [
          ARCHIVE_AGENT.id,
          [
            {
              id: "message-user",
              role: "user",
              content: "先帮我整理一下需求",
              timestamp: 1_742_203_600_000,
              isNew: true,
              isHistorical: false,
            },
            {
              id: "message-assistant",
              role: "assistant",
              content: "我已经整理成待办清单了",
              timestamp: 1_742_203_660_000,
              isNew: true,
              isHistorical: false,
            },
          ],
        ],
      ]),
      usageByAgentId: new Map(),
      contextWindowSizeByAgentId: new Map(),
      currentContextUsedByAgentId: new Map(),
      historyLoadedByAgentId: new Map(),
      historyLoadingByAgentId: new Map(),
      activeReplyAgentId: null,
      status: "connected",
    });

    const result = await useChatStore.getState().archiveCurrentSession("产品讨论");

    assert.equal(result.success, true);
    assert.deepEqual(deletedSessionKeys, ["agent:agent-archive:main"]);
    assert.deepEqual(useChatStore.getState().getMessagesForAgent(ARCHIVE_AGENT.id), []);

    const archives = readSidebarDirectArchives();
    assert.equal(archives.length, 1);
    assert.equal(archives[0]?.agentId, ARCHIVE_AGENT.id);
    assert.equal(archives[0]?.agentName, "小红");
    assert.equal(archives[0]?.title, "产品讨论");
    assert.equal(archives[0]?.preview, "我已经整理成待办清单了");
    assert.equal(archives[0]?.messages.length, 2);
    assert.equal(archives[0]?.messages[0]?.isHistorical, true);
    assert.equal(archives[0]?.messages[0]?.isNew, false);
    assert.equal(archives[0]?.messages[1]?.content, "我已经整理成待办清单了");
  } finally {
    gateway.deleteSession = originalDeleteSession;
  }
});

void test("群聊 sessionKey 的回复不会污染 1v1 会话和员工未读数", async () => {
  const gatewayInternal = gateway as unknown as GatewayPrivate;

  useAgentStore.setState({
    agents: [ARCHIVE_AGENT],
    currentAgentId: "someone-else",
    mainKey: "main",
    showDetailFor: null,
  });
  useGroupStore.setState({
    selectedGroupId: null,
    selectedArchiveId: null,
  });
  useDirectArchiveStore.setState({
    selectedDirectArchiveId: null,
  });

  gatewayInternal.handleMessage({
    type: "event",
    event: "chat",
    payload: {
      runId: "run-group-final",
      sessionKey: `agent:${ARCHIVE_AGENT.id}:group:group-1`,
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "这是群聊里的成员回复" }],
        timestamp: Date.now(),
      },
    },
  });

  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.resolve();

  assert.deepEqual(useChatStore.getState().getMessagesForAgent(ARCHIVE_AGENT.id), []);
  assert.equal(readSidebarUnreadState().directByAgentId[ARCHIVE_AGENT.id] ?? 0, 0);
});

void test("gateway final 会按 sessionKey 写入对应员工消息和未读，即使当前没有 activeReplyAgentId", async () => {
  const originalGetSessionRuntimeState = gateway.getSessionRuntimeState.bind(gateway);
  gateway.getSessionRuntimeState = (async () => ({
    contextWindowSize: 0,
    currentContextUsed: null,
    currentContextUsedFresh: false,
    sessionFound: false,
  })) as typeof gateway.getSessionRuntimeState;

  try {
    useAgentStore.setState({
      agents: [ARCHIVE_AGENT],
      currentAgentId: "another-agent",
      mainKey: "main",
      showDetailFor: null,
    });
    useGroupStore.setState({
      selectedGroupId: null,
      selectedArchiveId: null,
    });
    useDirectArchiveStore.setState({
      selectedDirectArchiveId: null,
    });

    const messageHandler = (
      gateway as unknown as {
        onMessage?: (
          messages: Array<{ role: "user" | "assistant"; content: string; timestamp: number }>,
          meta?: { sessionKey?: string },
        ) => void;
      }
    ).onMessage;

    assert.equal(typeof messageHandler, "function");

    messageHandler?.(
      [
        {
          role: "assistant",
          content: "后台新回复",
          timestamp: 1_742_203_720_000,
        },
      ],
      {
        sessionKey: `agent:${ARCHIVE_AGENT.id}:main`,
      },
    );

    const messages = useChatStore.getState().getMessagesForAgent(ARCHIVE_AGENT.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.content, "后台新回复");
    assert.equal(useChatStore.getState().activeReplyAgentId, null);
    assert.equal(readSidebarUnreadState().directByAgentId[ARCHIVE_AGENT.id], 1);
  } finally {
    gateway.getSessionRuntimeState = originalGetSessionRuntimeState;
  }
});
