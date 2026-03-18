import assert from "node:assert/strict";
import { after, afterEach, before } from "node:test";
import test from "node:test";
import { gateway } from "../services/gateway";
import { removeAgentFromGroup } from "../utils/groupMembers";
import { GROUP_STORAGE_KEY } from "../utils/groupPersistence";
import { useAgentStore, type Agent } from "./agentStore";
import { useGroupStore, type Group, type GroupChatMessage } from "./groupStore";

class MemoryStorage implements Storage {
  private storage = new Map<string, string>();
  private nextSetError: Error | null = null;

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

  failNextSet(error: Error) {
    this.nextSetError = error;
  }

  setItem(key: string, value: string) {
    if (this.nextSetError) {
      const error = this.nextSetError;
      this.nextSetError = null;
      throw error;
    }

    this.storage.set(key, value);
  }
}

const memoryStorage = new MemoryStorage();
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalDateNow = Date.now;
const pendingWindowTimers = new Map<number, () => void>();
const visibilityChangeListeners = new Set<() => void>();

type AgentTurnOutcome =
  | {
      type: "success";
      content: string;
      thinking?: string;
    }
  | {
      type: "error";
      error: string;
    };

let nextWindowTimerId = 1;
let nextTimestamp = 1_742_000_000_000;

const DEV_AGENT: Agent = {
  id: "dev",
  name: "小王",
  emoji: "🧑‍💻",
  role: "前端",
};

const QA_AGENT: Agent = {
  id: "qa",
  name: "小李",
  emoji: "🧪",
  role: "测试",
};

const LEADER_AGENT: Agent = {
  id: "lead",
  name: "群主",
  emoji: "🦞",
  role: "负责人",
};

function createQuotaExceededError() {
  const error = new Error("Quota exceeded");
  error.name = "QuotaExceededError";
  return error;
}

async function flushAsyncWork() {
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

function advanceTime(ms: number) {
  nextTimestamp += ms;
}

function triggerVisibilityChange(hidden: boolean) {
  const document = globalThis.document as { hidden?: boolean };
  document.hidden = hidden;
  visibilityChangeListeners.forEach((listener) => {
    listener();
  });
}

async function flushWindowTimers() {
  while (pendingWindowTimers.size > 0) {
    const [timerId, callback] = Array.from(pendingWindowTimers.entries())[0];
    pendingWindowTimers.delete(timerId);
    callback();
    await flushAsyncWork();
  }
}

function installGatewayScenario(outcomes: Record<string, AgentTurnOutcome[]>) {
  const originalSendAgentTurn = gateway.sendAgentTurn.bind(gateway);
  const originalWaitForAgentRun = gateway.waitForAgentRun.bind(gateway);
  const originalLoadHistory = gateway.loadHistory.bind(gateway);
  const sentMessages: Array<{ agentId: string; message: string }> = [];
  const outcomeByRunId = new Map<string, AgentTurnOutcome>();
  const sessionKeyByRunId = new Map<string, string>();
  const historyBySessionKey = new Map<string, AgentTurnOutcome>();
  let nextRunId = 1;

  gateway.sendAgentTurn = (async (params) => {
    const agentId = params.agentId ?? "";
    const message = params.message ?? "";
    const sessionKey = params.sessionKey ?? "";
    if (!agentId) {
      throw new Error("Missing agentId");
    }

    const queue = outcomes[agentId];
    if (!queue || queue.length === 0) {
      throw new Error(`Missing outcome for ${agentId}`);
    }

    const outcome = queue.shift()!;
    const runId = `run-${nextRunId++}`;
    sentMessages.push({ agentId, message });
    outcomeByRunId.set(runId, outcome);
    sessionKeyByRunId.set(runId, sessionKey);
    return { runId };
  }) as typeof gateway.sendAgentTurn;

  gateway.waitForAgentRun = (async (runId: string) => {
    const outcome = outcomeByRunId.get(runId);
    if (!outcome) {
      throw new Error(`Missing run outcome for ${runId}`);
    }

    if (outcome.type === "error") {
      return {
        status: "error",
        error: outcome.error,
      };
    }

    const sessionKey = sessionKeyByRunId.get(runId);
    if (sessionKey) {
      historyBySessionKey.set(sessionKey, outcome);
    }

    return {
      status: "ok",
    };
  }) as typeof gateway.waitForAgentRun;

  gateway.loadHistory = (async (sessionKey: string) => {
    const outcome = historyBySessionKey.get(sessionKey);
    if (!outcome || outcome.type !== "success") {
      return { messages: [] };
    }

    const content: Array<{ type: "text"; text: string } | { type: "thinking"; thinking: string }> =
      [{ type: "text", text: outcome.content }];
    if (outcome.thinking) {
      content.push({ type: "thinking", thinking: outcome.thinking });
    }

    return {
      messages: [
        {
          role: "assistant",
          content,
          timestamp: Date.now(),
        },
      ],
    };
  }) as typeof gateway.loadHistory;

  return {
    sentMessages,
    restore() {
      gateway.sendAgentTurn = originalSendAgentTurn;
      gateway.waitForAgentRun = originalWaitForAgentRun;
      gateway.loadHistory = originalLoadHistory;
    },
  };
}

function toGroupMember(agent: Agent) {
  return {
    id: agent.id,
    name: agent.name,
    emoji: agent.emoji,
    role: agent.role,
  };
}

function createGroup(overrides: Partial<Group> = {}): Group {
  const baseGroup: Group = {
    id: "group-1",
    name: "M14 项目组",
    description: "默认描述",
    notificationsEnabled: true,
    soundEnabled: true,
    members: [toGroupMember(DEV_AGENT), toGroupMember(QA_AGENT)],
    leaderId: "dev",
    createdAt: "2026-03-15T12:00:00.000Z",
  };

  return {
    ...baseGroup,
    ...overrides,
    members: overrides.members ?? baseGroup.members,
  };
}

function createMessage(): GroupChatMessage {
  return {
    id: "message-1",
    role: "assistant",
    content: "历史消息",
    timestamp: 1_742_000_000_000,
    isNew: false,
    isHistorical: true,
    senderId: "dev",
    senderName: "小王",
  };
}

function seedRelayState(group: Group, agents: Agent[]) {
  useAgentStore.setState({
    agents,
    mainKey: "main-key",
    defaultModelLabel: null,
  });
  useGroupStore.setState({
    groups: [group],
    selectedGroupId: group.id,
    selectedArchiveId: null,
    messagesByGroupId: {
      [group.id]: [],
    },
    archives: [],
    thinkingAgentsByGroupId: new Map(),
    isSendingByGroupId: {},
  });
}

function resetGroupStore() {
  useGroupStore.setState({
    groups: [],
    selectedGroupId: null,
    selectedArchiveId: null,
    messagesByGroupId: {},
    archives: [],
    thinkingAgentsByGroupId: new Map(),
    isSendingByGroupId: {},
  });
  useAgentStore.setState({
    agents: [],
    mainKey: "",
    defaultModelLabel: null,
  });
  memoryStorage.clear();
  pendingWindowTimers.clear();
  nextWindowTimerId = 1;
  nextTimestamp = 1_742_000_000_000;
}

before(() => {
  Date.now = () => {
    nextTimestamp += 1_000;
    return nextTimestamp;
  };

  Object.defineProperty(globalThis, "window", {
    value: {
      localStorage: memoryStorage,
      dispatchEvent: () => true,
      setTimeout: (handler: TimerHandler) => {
        const timerId = nextWindowTimerId++;
        pendingWindowTimers.set(timerId, () => {
          if (typeof handler === "function") {
            handler();
          }
        });
        return timerId;
      },
      clearTimeout: (timerId: number) => {
        pendingWindowTimers.delete(timerId);
      },
    },
    configurable: true,
    writable: true,
  });

  Object.defineProperty(globalThis, "document", {
    value: {
      hidden: false,
      addEventListener: (type: string, listener: () => void) => {
        if (type === "visibilitychange") {
          visibilityChangeListeners.add(listener);
        }
      },
      removeEventListener: (type: string, listener: () => void) => {
        if (type === "visibilitychange") {
          visibilityChangeListeners.delete(listener);
        }
      },
    },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  resetGroupStore();
  const document = globalThis.document as { hidden?: boolean } | undefined;
  if (document) {
    document.hidden = false;
  }
});

after(() => {
  Date.now = originalDateNow;

  if (originalWindow === undefined) {
    delete (globalThis as { window?: Window }).window;
    return;
  }

  Object.defineProperty(globalThis, "window", {
    value: originalWindow,
    configurable: true,
    writable: true,
  });

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

void test("createGroup 会保存群头像并写入本地持久化", () => {
  useAgentStore.setState({
    agents: [DEV_AGENT, QA_AGENT],
    mainKey: "main-key",
    defaultModelLabel: null,
  });

  const group = useGroupStore.getState().createGroup({
    name: "品牌项目组",
    avatarUrl: "data:image/png;base64,avatar",
    description: "负责品牌内容",
    members: [toGroupMember(DEV_AGENT), toGroupMember(QA_AGENT)],
    leaderId: DEV_AGENT.id,
  });

  assert.equal(group.avatarUrl, "data:image/png;base64,avatar");
  assert.equal(useGroupStore.getState().selectedGroupId, group.id);

  const persisted = JSON.parse(memoryStorage.getItem(GROUP_STORAGE_KEY) ?? "{}") as {
    groups?: Group[];
  };
  assert.equal(persisted.groups?.[0]?.avatarUrl, "data:image/png;base64,avatar");
});

void test("removeAgentData 会清掉员工关联的项目组空间数据", () => {
  const keepGroup = createGroup({
    id: "group-keep",
    name: "保留组",
    members: [toGroupMember(DEV_AGENT), toGroupMember(QA_AGENT)],
    leaderId: DEV_AGENT.id,
  });
  const removedGroup = createGroup({
    id: "group-remove",
    name: "待删除组",
    members: [toGroupMember(DEV_AGENT)],
    leaderId: DEV_AGENT.id,
  });

  useGroupStore.setState({
    groups: [keepGroup, removedGroup],
    selectedGroupId: removedGroup.id,
    selectedArchiveId: "archive-remove",
    messagesByGroupId: {
      [keepGroup.id]: [createMessage()],
      [removedGroup.id]: [createMessage()],
    },
    archives: [
      {
        id: "archive-keep",
        groupId: keepGroup.id,
        groupName: keepGroup.name,
        createdAt: "2026-03-16T10:00:00.000Z",
        messages: [createMessage()],
      },
      {
        id: "archive-remove",
        groupId: removedGroup.id,
        groupName: removedGroup.name,
        createdAt: "2026-03-16T11:00:00.000Z",
        messages: [createMessage()],
      },
    ],
    thinkingAgentsByGroupId: new Map(),
    isSendingByGroupId: {},
  });

  useGroupStore.getState().removeAgentData(DEV_AGENT.id);

  const state = useGroupStore.getState();
  assert.equal(state.groups.length, 1);
  assert.equal(state.groups[0]?.id, keepGroup.id);
  assert.equal(state.groups[0]?.leaderId, QA_AGENT.id);
  assert.deepEqual(
    state.groups[0]?.members.map((member) => member.id),
    [QA_AGENT.id],
  );
  assert.deepEqual(
    state.archives.map((archive) => archive.id),
    ["archive-keep"],
  );
  assert.equal(state.selectedGroupId, null);
  assert.equal(state.selectedArchiveId, null);
});

void test("项目组提醒、音效与基础信息会同步持久化", () => {
  const group = createGroup();
  useGroupStore.setState({
    groups: [group],
    selectedGroupId: group.id,
    selectedArchiveId: null,
    messagesByGroupId: {
      [group.id]: [],
    },
    archives: [],
  });

  useGroupStore.getState().setGroupNotificationsEnabled(group.id, false);
  useGroupStore.getState().setGroupSoundEnabled(group.id, false);
  useGroupStore.getState().updateGroupInfo(group.id, {
    name: "M15 项目组",
    description: "新的描述",
  });

  const nextGroup = useGroupStore.getState().groups[0];
  assert.equal(nextGroup?.name, "M15 项目组");
  assert.equal(nextGroup?.description, "新的描述");
  assert.equal(nextGroup?.notificationsEnabled, false);
  assert.equal(nextGroup?.soundEnabled, false);

  const persisted = JSON.parse(memoryStorage.getItem("wurenju.groups.v1") ?? "{}");
  assert.equal(persisted.groups[0].name, "M15 项目组");
  assert.equal(persisted.groups[0].description, "新的描述");
  assert.equal(persisted.groups[0].notificationsEnabled, false);
  assert.equal(persisted.groups[0].soundEnabled, false);
});

void test("resetGroupMessages 会重置全部成员 session 并清空消息", async () => {
  const group = createGroup();
  const originalResetSession = gateway.resetSession.bind(gateway);
  const resetCalls: string[] = [];

  gateway.resetSession = (async (sessionKey: string) => {
    resetCalls.push(sessionKey);
    return {};
  }) as typeof gateway.resetSession;

  try {
    useGroupStore.setState({
      groups: [
        {
          ...group,
          isUrging: true,
          urgeIntervalMinutes: 5,
          urgeStartedAt: 1_742_000_100_000,
          urgeCount: 3,
          isUrgePaused: true,
          urgeLastCheckedAt: 1_742_000_200_000,
        },
      ],
      selectedGroupId: group.id,
      selectedArchiveId: null,
      messagesByGroupId: {
        [group.id]: [createMessage()],
      },
      archives: [],
      thinkingAgentsByGroupId: new Map([
        [
          group.id,
          new Map([
            [
              "dev",
              {
                id: "dev",
                name: "小王",
                pendingCount: 1,
              },
            ],
          ]),
        ],
      ]),
      isSendingByGroupId: {
        [group.id]: true,
      },
    });

    const result = await useGroupStore.getState().resetGroupMessages(group.id);

    assert.equal(result.success, true);
    assert.deepEqual(resetCalls.toSorted(), ["agent:dev:group:group-1", "agent:qa:group:group-1"]);
    assert.deepEqual(useGroupStore.getState().messagesByGroupId[group.id], []);
    assert.equal(useGroupStore.getState().isSendingByGroupId[group.id], false);
    assert.equal(useGroupStore.getState().thinkingAgentsByGroupId.has(group.id), false);
    assert.equal(useGroupStore.getState().groups[0]?.isUrging, false);
    assert.equal(useGroupStore.getState().groups[0]?.urgeStartedAt, undefined);
    assert.equal(useGroupStore.getState().groups[0]?.urgeCount, 0);
    assert.equal(useGroupStore.getState().groups[0]?.isUrgePaused, false);
    assert.equal(useGroupStore.getState().groups[0]?.urgeLastCheckedAt, undefined);

    const persisted = JSON.parse(memoryStorage.getItem("wurenju.groups.v1") ?? "{}");
    assert.deepEqual(persisted.messagesByGroupId[group.id], []);
    assert.equal(persisted.groups[0].isUrging, false);
    assert.equal(persisted.groups[0].urgeStartedAt, undefined);
    assert.equal(persisted.groups[0].urgeCount, 0);
    assert.equal(persisted.groups[0].isUrgePaused, false);
    assert.equal(persisted.groups[0].urgeLastCheckedAt, undefined);
  } finally {
    gateway.resetSession = originalResetSession;
  }
});

void test("archiveGroupMessages 会保存归档、关闭督促并重置 session", async () => {
  const group = createGroup();
  const originalResetSession = gateway.resetSession.bind(gateway);
  const resetCalls: string[] = [];

  gateway.resetSession = (async (sessionKey: string) => {
    resetCalls.push(sessionKey);
    return {};
  }) as typeof gateway.resetSession;

  try {
    useGroupStore.setState({
      groups: [
        {
          ...group,
          isUrging: true,
          urgeIntervalMinutes: 10,
          urgeStartedAt: 1_742_000_100_000,
          urgeCount: 2,
          isUrgePaused: false,
          urgeLastCheckedAt: 1_742_000_200_000,
        },
      ],
      selectedGroupId: group.id,
      selectedArchiveId: null,
      messagesByGroupId: {
        [group.id]: [createMessage()],
      },
      archives: [],
      thinkingAgentsByGroupId: new Map([
        [
          group.id,
          new Map([
            [
              "qa",
              {
                id: "qa",
                name: "小李",
                pendingCount: 1,
              },
            ],
          ]),
        ],
      ]),
      isSendingByGroupId: {
        [group.id]: true,
      },
    });

    const result = await useGroupStore.getState().archiveGroupMessages(group.id);

    assert.equal(result.success, true);
    assert.equal(typeof result.archiveId, "string");
    assert.deepEqual(resetCalls.toSorted(), ["agent:dev:group:group-1", "agent:qa:group:group-1"]);
    assert.deepEqual(useGroupStore.getState().messagesByGroupId[group.id], []);
    assert.equal(useGroupStore.getState().isSendingByGroupId[group.id], false);
    assert.equal(useGroupStore.getState().thinkingAgentsByGroupId.has(group.id), false);
    assert.equal(useGroupStore.getState().groups[0]?.isUrging, false);
    assert.equal(useGroupStore.getState().groups[0]?.urgeStartedAt, undefined);
    assert.equal(useGroupStore.getState().groups[0]?.urgeCount, 0);
    assert.equal(useGroupStore.getState().groups[0]?.urgeLastCheckedAt, undefined);
    assert.equal(useGroupStore.getState().archives.length, 1);
    assert.equal(useGroupStore.getState().archives[0]?.groupName, group.name);
    assert.equal(useGroupStore.getState().archives[0]?.messages[0]?.id, "message-1");
    assert.equal(useGroupStore.getState().archives[0]?.messages[0]?.content, "历史消息");
    assert.equal(useGroupStore.getState().archives[0]?.messages[0]?.senderName, "小王");

    const persisted = JSON.parse(memoryStorage.getItem("wurenju.groups.v1") ?? "{}");
    assert.equal(persisted.archives.length, 1);
    assert.equal(persisted.archives[0].groupName, group.name);
    assert.deepEqual(persisted.messagesByGroupId[group.id], []);
    assert.equal(persisted.groups[0].isUrging, false);
    assert.equal(persisted.groups[0].urgeStartedAt, undefined);
    assert.equal(persisted.groups[0].urgeCount, 0);
    assert.equal(persisted.groups[0].urgeLastCheckedAt, undefined);
  } finally {
    gateway.resetSession = originalResetSession;
  }
});

void test("fetchGroups 会兼容旧版归档消息块格式并保留选中态", () => {
  const group = createGroup();

  memoryStorage.setItem(
    GROUP_STORAGE_KEY,
    JSON.stringify({
      groups: [group],
      selectedGroupId: null,
      selectedArchiveId: "archive-legacy",
      messagesByGroupId: {
        [group.id]: [],
      },
      archives: [
        {
          id: "archive-legacy",
          groupId: group.id,
          groupName: group.name,
          createdAt: "2026-03-16T08:00:00.000Z",
          messages: [
            {
              id: "legacy-msg-1",
              role: "assistant",
              content: [{ type: "text", text: "旧版归档内容" }],
              thinking: "旧版思考过程",
              timestamp: 1_742_000_000_000,
              senderId: "qa",
              senderName: "小李",
              senderEmoji: "🧪",
            },
          ],
        },
      ],
    }),
  );

  useGroupStore.getState().fetchGroups();

  const state = useGroupStore.getState();
  assert.equal(state.selectedArchiveId, "archive-legacy");
  assert.equal(state.archives.length, 1);
  assert.equal(state.archives[0]?.messages[0]?.content, "旧版归档内容");
  assert.equal(state.archives[0]?.messages[0]?.thinking, "旧版思考过程");
  assert.equal(state.archives[0]?.messages[0]?.senderId, "qa");
});

void test("接力成员失败后会跳过并转给下一位，不会重试失败成员", async () => {
  const group = createGroup();
  const scenario = installGatewayScenario({
    dev: [{ type: "error", error: "dev timeout" }],
    qa: [{ type: "success", content: "我来继续完成这轮接力。" }],
  });

  try {
    seedRelayState(group, [DEV_AGENT, QA_AGENT]);

    await useGroupStore.getState().sendGroupMessage(group.id, "请接力推进这件事，@小王 先开始");
    await flushAsyncWork();
    await flushWindowTimers();

    assert.deepEqual(
      scenario.sentMessages.map((item) => item.agentId),
      ["dev", "qa"],
    );

    const messages = useGroupStore.getState().messagesByGroupId[group.id] ?? [];
    assert.equal(
      messages.some((message) => message.content === "小王 响应失败，已跳过"),
      true,
    );
    assert.equal(
      messages.some((message) => message.content.includes("我来继续完成这轮接力。")),
      true,
    );
    assert.equal(
      messages.some((message) => message.content.includes("暂时无法回复")),
      false,
    );
    assert.deepEqual(useGroupStore.getState().getThinkingAgentsForGroup(group.id), []);
    assert.equal(useGroupStore.getState().isSendingByGroupId[group.id], false);
  } finally {
    scenario.restore();
  }
});

void test("所有接力成员失败后会转交群主兜底总结并结束本轮接力", async () => {
  const group = createGroup({
    leaderId: LEADER_AGENT.id,
    members: [toGroupMember(DEV_AGENT), toGroupMember(QA_AGENT)],
  });
  const scenario = installGatewayScenario({
    dev: [{ type: "error", error: "dev timeout" }],
    qa: [{ type: "error", error: "qa timeout" }],
    lead: [{ type: "success", content: "我来兜底总结：当前先按失败结论收口。" }],
  });

  try {
    seedRelayState(group, [DEV_AGENT, QA_AGENT, LEADER_AGENT]);

    await useGroupStore.getState().sendGroupMessage(group.id, "请接力分析一下 @小王 先开始");
    await flushAsyncWork();
    await flushWindowTimers();

    assert.deepEqual(
      scenario.sentMessages.map((item) => item.agentId),
      ["dev", "qa", "lead"],
    );
    assert.equal(scenario.sentMessages[2]?.message.includes("[群内接力兜底总结]"), true);

    const messages = useGroupStore.getState().messagesByGroupId[group.id] ?? [];
    assert.equal(
      messages.some((message) => message.content === "小王 响应失败，已跳过"),
      true,
    );
    assert.equal(
      messages.some((message) => message.content === "小李 响应失败，已跳过"),
      true,
    );
    assert.equal(
      messages.some((message) => message.content.includes("我来兜底总结：当前先按失败结论收口。")),
      true,
    );
    assert.deepEqual(useGroupStore.getState().getThinkingAgentsForGroup(group.id), []);
    assert.equal(useGroupStore.getState().isSendingByGroupId[group.id], false);
  } finally {
    scenario.restore();
  }
});

void test("移除接力中的成员会清理 runtime、补系统提示并续接下一位", async () => {
  const group = createGroup({
    leaderId: LEADER_AGENT.id,
    members: [toGroupMember(DEV_AGENT), toGroupMember(QA_AGENT)],
  });
  const originalSendAgentTurn = gateway.sendAgentTurn.bind(gateway);
  const originalWaitForAgentRun = gateway.waitForAgentRun.bind(gateway);
  const originalLoadHistory = gateway.loadHistory.bind(gateway);
  const sentMessages: Array<{ agentId: string; message: string }> = [];
  const sessionKeyByRunId = new Map<string, string>();
  const runResolvers = new Map<string, () => void>();
  let nextRunId = 1;

  gateway.sendAgentTurn = (async (params) => {
    const agentId = params.agentId ?? "";
    const sessionKey = params.sessionKey ?? "";
    const runId = `run-${nextRunId++}`;
    sentMessages.push({
      agentId,
      message: params.message ?? "",
    });
    sessionKeyByRunId.set(runId, sessionKey);
    return { runId };
  }) as typeof gateway.sendAgentTurn;

  gateway.waitForAgentRun = (async (runId: string) => {
    await new Promise<void>((resolve) => {
      runResolvers.set(runId, resolve);
    });

    return {
      status: "ok",
    };
  }) as typeof gateway.waitForAgentRun;

  gateway.loadHistory = (async (sessionKey: string) => {
    const content = sessionKey.includes("agent:qa:")
      ? "我来继续接力并收口。"
      : "我是被移除成员的晚到回复。";

    return {
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: content }],
          timestamp: Date.now(),
        },
      ],
    };
  }) as typeof gateway.loadHistory;

  try {
    seedRelayState(group, [DEV_AGENT, QA_AGENT, LEADER_AGENT]);

    const sendPromise = useGroupStore
      .getState()
      .sendGroupMessage(group.id, "请接力分析一下 @小王 先开始");
    await flushAsyncWork();

    assert.deepEqual(
      sentMessages.map((item) => item.agentId),
      ["dev"],
    );
    assert.deepEqual(
      useGroupStore
        .getState()
        .getThinkingAgentsForGroup(group.id)
        .map((member) => member.id),
      ["dev"],
    );

    const removalResult = removeAgentFromGroup(group.id, DEV_AGENT.id);
    assert.equal(removalResult.changed, true);

    await flushAsyncWork();

    assert.deepEqual(
      sentMessages.map((item) => item.agentId),
      ["dev", "qa"],
    );
    assert.deepEqual(
      useGroupStore
        .getState()
        .getThinkingAgentsForGroup(group.id)
        .map((member) => member.id),
      ["qa"],
    );

    const devRunId =
      Array.from(sessionKeyByRunId.entries()).find(([, sessionKey]) =>
        sessionKey.includes("agent:dev:"),
      )?.[0] ?? null;
    const qaRunId =
      Array.from(sessionKeyByRunId.entries()).find(([, sessionKey]) =>
        sessionKey.includes("agent:qa:"),
      )?.[0] ?? null;

    assert.equal(typeof devRunId, "string");
    assert.equal(typeof qaRunId, "string");

    runResolvers.get(devRunId!)?.();
    await flushAsyncWork();
    await sendPromise;

    runResolvers.get(qaRunId!)?.();
    await flushAsyncWork();

    const messages = useGroupStore.getState().messagesByGroupId[group.id] ?? [];
    assert.equal(
      messages.some((message) => message.content === "小王 已被移除"),
      true,
    );
    assert.equal(
      messages.some((message) => message.content.includes("我来继续接力并收口。")),
      true,
    );
    assert.equal(
      messages.some((message) => message.content.includes("我是被移除成员的晚到回复。")),
      false,
    );
    assert.deepEqual(useGroupStore.getState().getThinkingAgentsForGroup(group.id), []);
  } finally {
    gateway.sendAgentTurn = originalSendAgentTurn;
    gateway.waitForAgentRun = originalWaitForAgentRun;
    gateway.loadHistory = originalLoadHistory;
  }
});

void test("项目组持久化写失败时会回滚内存态", () => {
  const group = createGroup();
  useGroupStore.setState({
    groups: [group],
    selectedGroupId: group.id,
    selectedArchiveId: null,
    messagesByGroupId: {
      [group.id]: [],
    },
    archives: [],
  });

  memoryStorage.failNextSet(createQuotaExceededError());
  useGroupStore.getState().updateGroupInfo(group.id, {
    name: "M15 项目组",
    description: "新的描述",
  });

  const nextGroup = useGroupStore.getState().groups[0];
  assert.equal(nextGroup?.name, group.name);
  assert.equal(nextGroup?.description, group.description);
  assert.equal(memoryStorage.getItem("wurenju.groups.v1"), null);
});

void test("切换项目组不会清掉其他群的督促定时器", () => {
  const groupA = createGroup({
    id: "group-a",
    name: "A 项目组",
    members: [toGroupMember(DEV_AGENT), toGroupMember(LEADER_AGENT)],
    leaderId: LEADER_AGENT.id,
  });
  const groupB = createGroup({
    id: "group-b",
    name: "B 项目组",
    members: [toGroupMember(QA_AGENT), toGroupMember(LEADER_AGENT)],
    leaderId: LEADER_AGENT.id,
  });

  useGroupStore.setState({
    groups: [groupA, groupB],
    selectedGroupId: groupA.id,
    selectedArchiveId: null,
    messagesByGroupId: {
      [groupA.id]: [],
      [groupB.id]: [],
    },
    archives: [],
    thinkingAgentsByGroupId: new Map(),
    isSendingByGroupId: {},
  });

  useGroupStore.getState().startGroupUrging(groupA.id, 5);
  useGroupStore.getState().selectGroup(groupB.id);
  useGroupStore.getState().startGroupUrging(groupB.id, 10);

  assert.equal(useGroupStore.getState().selectedGroupId, groupB.id);
  assert.equal(
    useGroupStore.getState().groups.find((group) => group.id === groupA.id)?.isUrging,
    true,
  );
  assert.equal(
    useGroupStore.getState().groups.find((group) => group.id === groupB.id)?.isUrging,
    true,
  );
  assert.equal(pendingWindowTimers.size, 2);
});

void test("fetchGroups 会恢复所有活跃群的督促定时器", async () => {
  const groupA = createGroup({
    id: "group-a",
    name: "A 项目组",
    members: [toGroupMember(DEV_AGENT), toGroupMember(LEADER_AGENT)],
    leaderId: LEADER_AGENT.id,
    isUrging: true,
    urgeIntervalMinutes: 5,
    urgeStartedAt: 1_742_000_100_000,
    urgeCount: 1,
    isUrgePaused: false,
    urgeLastCheckedAt: 1_742_000_200_000,
  });
  const groupB = createGroup({
    id: "group-b",
    name: "B 项目组",
    members: [toGroupMember(QA_AGENT), toGroupMember(LEADER_AGENT)],
    leaderId: LEADER_AGENT.id,
    isUrging: true,
    urgeIntervalMinutes: 10,
    urgeStartedAt: 1_742_000_300_000,
    urgeCount: 2,
    isUrgePaused: false,
    urgeLastCheckedAt: 1_742_000_400_000,
  });

  memoryStorage.setItem(
    GROUP_STORAGE_KEY,
    JSON.stringify({
      groups: [groupA, groupB],
      selectedGroupId: groupA.id,
      selectedArchiveId: null,
      messagesByGroupId: {
        [groupA.id]: [],
        [groupB.id]: [],
      },
      archives: [],
    }),
  );

  useGroupStore.getState().fetchGroups();
  await flushAsyncWork();

  assert.equal(useGroupStore.getState().groups.length, 2);
  assert.equal(pendingWindowTimers.size, 2);
});

void test("切到 1v1 再切回群时不会丢失后台督促定时器", () => {
  const group = createGroup({
    id: "group-a",
    name: "A 项目组",
    members: [toGroupMember(DEV_AGENT), toGroupMember(LEADER_AGENT)],
    leaderId: LEADER_AGENT.id,
  });

  useGroupStore.setState({
    groups: [group],
    selectedGroupId: group.id,
    selectedArchiveId: null,
    messagesByGroupId: {
      [group.id]: [],
    },
    archives: [],
    thinkingAgentsByGroupId: new Map(),
    isSendingByGroupId: {},
  });

  useGroupStore.getState().startGroupUrging(group.id, 5);
  useGroupStore.getState().clearSelectedGroup();
  assert.equal(pendingWindowTimers.size, 1);

  useGroupStore.getState().selectGroup(group.id);
  assert.equal(useGroupStore.getState().selectedGroupId, group.id);
  assert.equal(useGroupStore.getState().groups[0]?.isUrging, true);
  assert.equal(pendingWindowTimers.size, 1);
});

void test("关闭某个群的督促只影响当前群", () => {
  const groupA = createGroup({
    id: "group-a",
    name: "A 项目组",
    members: [toGroupMember(DEV_AGENT), toGroupMember(LEADER_AGENT)],
    leaderId: LEADER_AGENT.id,
  });
  const groupB = createGroup({
    id: "group-b",
    name: "B 项目组",
    members: [toGroupMember(QA_AGENT), toGroupMember(LEADER_AGENT)],
    leaderId: LEADER_AGENT.id,
  });

  useGroupStore.setState({
    groups: [groupA, groupB],
    selectedGroupId: groupA.id,
    selectedArchiveId: null,
    messagesByGroupId: {
      [groupA.id]: [],
      [groupB.id]: [],
    },
    archives: [],
    thinkingAgentsByGroupId: new Map(),
    isSendingByGroupId: {},
  });

  useGroupStore.getState().startGroupUrging(groupA.id, 5);
  useGroupStore.getState().startGroupUrging(groupB.id, 10);
  useGroupStore.getState().stopGroupUrging(groupA.id);

  assert.equal(
    useGroupStore.getState().groups.find((group) => group.id === groupA.id)?.isUrging,
    false,
  );
  assert.equal(
    useGroupStore.getState().groups.find((group) => group.id === groupB.id)?.isUrging,
    true,
  );
  assert.equal(pendingWindowTimers.size, 1);
});

void test("重置某个群会复用 cleanup 关闭该群督促，不影响其他群", async () => {
  const groupA = createGroup({
    id: "group-a",
    name: "A 项目组",
    members: [toGroupMember(DEV_AGENT), toGroupMember(LEADER_AGENT)],
    leaderId: LEADER_AGENT.id,
  });
  const groupB = createGroup({
    id: "group-b",
    name: "B 项目组",
    members: [toGroupMember(QA_AGENT), toGroupMember(LEADER_AGENT)],
    leaderId: LEADER_AGENT.id,
  });
  const originalResetSession = gateway.resetSession.bind(gateway);
  const resetCalls: string[] = [];

  gateway.resetSession = (async (sessionKey: string) => {
    resetCalls.push(sessionKey);
    return {};
  }) as typeof gateway.resetSession;

  try {
    useGroupStore.setState({
      groups: [groupA, groupB],
      selectedGroupId: groupA.id,
      selectedArchiveId: null,
      messagesByGroupId: {
        [groupA.id]: [createMessage()],
        [groupB.id]: [],
      },
      archives: [],
      thinkingAgentsByGroupId: new Map(),
      isSendingByGroupId: {},
    });

    useGroupStore.getState().startGroupUrging(groupA.id, 5);
    useGroupStore.getState().startGroupUrging(groupB.id, 10);

    const result = await useGroupStore.getState().resetGroupMessages(groupA.id);

    assert.equal(result.success, true);
    assert.deepEqual(resetCalls.toSorted(), [
      "agent:dev:group:group-a",
      "agent:lead:group:group-a",
    ]);
    assert.equal(
      useGroupStore.getState().groups.find((group) => group.id === groupA.id)?.isUrging,
      false,
    );
    assert.equal(
      useGroupStore.getState().groups.find((group) => group.id === groupB.id)?.isUrging,
      true,
    );
    assert.equal(pendingWindowTimers.size, 1);
  } finally {
    gateway.resetSession = originalResetSession;
  }
});

void test("visibilitychange 会对所有活跃群执行过期督促补偿", async () => {
  const urgeStartedAt = nextTimestamp - 10 * 60 * 1_000;
  const urgeLastCheckedAt = nextTimestamp;
  const groupA = createGroup({
    id: "group-a",
    name: "A 项目组",
    members: [toGroupMember(DEV_AGENT), toGroupMember(LEADER_AGENT)],
    leaderId: LEADER_AGENT.id,
    isUrging: true,
    urgeIntervalMinutes: 5,
    urgeStartedAt,
    urgeCount: 0,
    isUrgePaused: false,
    urgeLastCheckedAt,
  });
  const groupB = createGroup({
    id: "group-b",
    name: "B 项目组",
    members: [toGroupMember(QA_AGENT), toGroupMember(LEADER_AGENT)],
    leaderId: LEADER_AGENT.id,
    isUrging: true,
    urgeIntervalMinutes: 5,
    urgeStartedAt,
    urgeCount: 0,
    isUrgePaused: false,
    urgeLastCheckedAt,
  });
  const scenario = installGatewayScenario({
    dev: [{ type: "success", content: "A 组成员已汇报进度。" }],
    qa: [{ type: "success", content: "B 组成员已汇报进度。" }],
  });

  try {
    memoryStorage.setItem(
      GROUP_STORAGE_KEY,
      JSON.stringify({
        groups: [groupA, groupB],
        selectedGroupId: groupA.id,
        selectedArchiveId: null,
        messagesByGroupId: {
          [groupA.id]: [],
          [groupB.id]: [],
        },
        archives: [],
      }),
    );

    useAgentStore.setState({
      agents: [DEV_AGENT, QA_AGENT, LEADER_AGENT],
      mainKey: "main-key",
      defaultModelLabel: null,
    });

    useGroupStore.getState().fetchGroups();
    await flushAsyncWork();
    assert.equal(pendingWindowTimers.size, 2);

    triggerVisibilityChange(true);
    advanceTime(6 * 60 * 1_000);
    triggerVisibilityChange(false);
    await flushAsyncWork();

    assert.deepEqual(scenario.sentMessages.map((item) => item.agentId).toSorted(), ["dev", "qa"]);
    assert.equal(
      useGroupStore.getState().groups.find((group) => group.id === groupA.id)?.urgeCount,
      1,
    );
    assert.equal(
      useGroupStore.getState().groups.find((group) => group.id === groupB.id)?.urgeCount,
      1,
    );
  } finally {
    scenario.restore();
  }
});
