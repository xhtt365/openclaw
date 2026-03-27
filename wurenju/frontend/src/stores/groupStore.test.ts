import assert from "node:assert/strict";
import { after, afterEach, before } from "node:test";
import test from "node:test";
import { experienceApi } from "../services/experienceApi";
import { gateway } from "../services/gateway";
import { removeAgentFromGroup } from "../utils/groupMembers";
import { GROUP_STORAGE_KEY } from "../utils/groupPersistence";
import { useAgentStore, type Agent } from "./agentStore";
import { useGroupStore, type Group, type GroupChatMessage } from "./groupStore";

class MemoryStorage implements Storage {
  private storage = new Map<string, string>();
  private nextSetError: Error | null = null;
  private persistentSetError: Error | null = null;

  get length() {
    return this.storage.size;
  }

  clear() {
    this.storage.clear();
    this.nextSetError = null;
    this.persistentSetError = null;
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

  failAllSets(error: Error) {
    this.persistentSetError = error;
  }

  setItem(key: string, value: string) {
    if (this.persistentSetError) {
      throw this.persistentSetError;
    }

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
const originalWriteProcessEvent = experienceApi.writeProcessEvent.bind(experienceApi);
const originalListProcessEvents = experienceApi.listProcessEvents.bind(experienceApi);
const originalGetLastFeedbackEvent = experienceApi.getLastFeedbackEvent.bind(experienceApi);
const originalUpsertExperienceCandidate =
  experienceApi.upsertExperienceCandidate.bind(experienceApi);
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

function createMockExperienceItem(
  input: Parameters<typeof experienceApi.upsertExperienceCandidate>[0],
) {
  return {
    id: input.id ?? "candidate-1",
    status: input.status ?? "pending",
    kind: input.kind ?? "lesson",
    task_type_json:
      input.taskTypeJson == null
        ? null
        : typeof input.taskTypeJson === "string"
          ? input.taskTypeJson
          : JSON.stringify(input.taskTypeJson),
    trigger: input.trigger ?? null,
    rule: input.rule,
    anti_pattern: input.antiPattern ?? null,
    group_id: input.groupId ?? null,
    session_key: input.sessionKey ?? null,
    feedback_score: input.feedbackScore ?? null,
    repeated_hits: input.repeatedHits ?? 0,
    confidence: input.confidence ?? 0.5,
    conflict_with: input.conflictWith ?? null,
    superseded_by: input.supersededBy ?? null,
    created_at: input.createdAt ?? "0",
    updated_at: input.updatedAt ?? input.createdAt ?? "0",
    last_seen_at: input.lastSeenAt ?? null,
    valid_from: input.validFrom ?? null,
    expires_at: input.expiresAt ?? null,
    risk: input.risk ?? "medium",
  };
}

function installDefaultExperienceApiStubs() {
  experienceApi.writeProcessEvent = (async () => ({
    success: true,
  })) as typeof experienceApi.writeProcessEvent;
  experienceApi.listProcessEvents = (async () => []) as typeof experienceApi.listProcessEvents;
  experienceApi.getLastFeedbackEvent = (async () =>
    null) as typeof experienceApi.getLastFeedbackEvent;
  experienceApi.upsertExperienceCandidate = (async (input) =>
    createMockExperienceItem(input)) as typeof experienceApi.upsertExperienceCandidate;
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
    announcementSyncStatus: new Map(),
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
    announcementSyncStatus: new Map(),
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
  installDefaultExperienceApiStubs();
  Date.now = () => {
    nextTimestamp += 1_000;
    return nextTimestamp;
  };

  Object.defineProperty(globalThis, "window", {
    value: {
      localStorage: memoryStorage,
      dispatchEvent: () => true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
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
  installDefaultExperienceApiStubs();
  const document = globalThis.document as { hidden?: boolean } | undefined;
  if (document) {
    document.hidden = false;
  }
});

after(() => {
  experienceApi.writeProcessEvent = originalWriteProcessEvent;
  experienceApi.listProcessEvents = originalListProcessEvents;
  experienceApi.getLastFeedbackEvent = originalGetLastFeedbackEvent;
  experienceApi.upsertExperienceCandidate = originalUpsertExperienceCandidate;
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
        title: "保留组 - 2026.03.16",
        createdAt: "2026-03-16T10:00:00.000Z",
        messages: [createMessage()],
      },
      {
        id: "archive-remove",
        groupId: removedGroup.id,
        groupName: removedGroup.name,
        title: "待删除组 - 2026.03.16",
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

void test("sendGroupMessage 会为负反馈异步写入 process_events", async () => {
  const group = createGroup({
    members: [toGroupMember(DEV_AGENT)],
    leaderId: DEV_AGENT.id,
  });
  const scenario = installGatewayScenario({
    dev: [{ type: "success", content: "我会先保存再继续处理。" }],
  });
  const calls: Array<Parameters<typeof experienceApi.writeProcessEvent>[0]> = [];

  experienceApi.writeProcessEvent = (async (input) => {
    calls.push(input);
    return { success: true };
  }) as typeof experienceApi.writeProcessEvent;

  try {
    seedRelayState(group, [DEV_AGENT]);

    await useGroupStore.getState().sendGroupMessage(group.id, "错了，应该先保存");
    await flushAsyncWork();

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.targetAgentId, DEV_AGENT.id);
    assert.equal(calls[0]?.sessionKey, "agent:dev:group:group-1");
    assert.equal(calls[0]?.feedbackType, "negative_explicit");
    assert.equal(calls[0]?.content, "错了，应该先保存");
    assert.equal(calls[0]?.normalizedContent, "错 应该先");
    assert.equal(calls[0]?.senderId, "user");
    assert.deepEqual(calls[0]?.taskTypeJson, null);

    const messages = useGroupStore.getState().messagesByGroupId[group.id] ?? [];
    assert.equal(
      messages.some((message) => message.role === "assistant"),
      true,
    );
  } finally {
    scenario.restore();
  }
});

void test("sendGroupMessage 遇到中性消息时不会写入 feedback 事件", async () => {
  const group = createGroup({
    members: [toGroupMember(DEV_AGENT)],
    leaderId: DEV_AGENT.id,
  });
  const scenario = installGatewayScenario({
    dev: [{ type: "success", content: "收到，我继续处理。" }],
  });
  const calls: Array<Parameters<typeof experienceApi.writeProcessEvent>[0]> = [];

  experienceApi.writeProcessEvent = (async (input) => {
    calls.push(input);
    return { success: true };
  }) as typeof experienceApi.writeProcessEvent;

  try {
    seedRelayState(group, [DEV_AGENT]);

    await useGroupStore.getState().sendGroupMessage(group.id, "今天天气不错");
    await flushAsyncWork();

    assert.equal(calls.length, 0);
  } finally {
    scenario.restore();
  }
});

void test("反馈采集失败不会影响正常群聊流程", async () => {
  const group = createGroup({
    members: [toGroupMember(DEV_AGENT)],
    leaderId: DEV_AGENT.id,
  });
  const scenario = installGatewayScenario({
    dev: [{ type: "success", content: "我已经继续处理任务。" }],
  });
  const originalConsoleError = console.error;
  const errorLogs: unknown[][] = [];

  console.error = (...args: unknown[]) => {
    errorLogs.push(args);
  };
  experienceApi.writeProcessEvent = (async () => {
    throw new Error("experience offline");
  }) as typeof experienceApi.writeProcessEvent;

  try {
    seedRelayState(group, [DEV_AGENT]);

    await useGroupStore.getState().sendGroupMessage(group.id, "错了，重新来");
    await flushAsyncWork();

    const messages = useGroupStore.getState().messagesByGroupId[group.id] ?? [];
    assert.equal(
      messages.some(
        (message) => message.role === "assistant" && message.content === "我已经继续处理任务。",
      ),
      true,
    );
    assert.equal(
      errorLogs.some((args) => String(args[0]).includes("[Group] 反馈采集失败")),
      true,
    );
  } finally {
    console.error = originalConsoleError;
    scenario.restore();
  }
});

void test("负反馈后的成功回复会异步写入经验候选", async () => {
  const group = createGroup({
    members: [toGroupMember(DEV_AGENT)],
    leaderId: DEV_AGENT.id,
  });
  const scenario = installGatewayScenario({
    dev: [{ type: "success", content: "已按反馈重新整理答案。" }],
  });
  const candidateCalls: Array<Parameters<typeof experienceApi.upsertExperienceCandidate>[0]> = [];

  experienceApi.getLastFeedbackEvent = (async () => ({
    id: "event-1",
    session_key: "agent:dev:group:group-1",
    group_id: group.id,
    target_agent_id: DEV_AGENT.id,
    type: "feedback",
    feedback_type: "negative_explicit",
    sender_id: "user",
    sender_name: "用户",
    content: "错了，应该先保存",
    normalized_content: "错 应该先",
    task_type_json: '["修复"]',
    confidence_delta: 0.8,
    created_at: "1742000000000",
  })) as typeof experienceApi.getLastFeedbackEvent;
  experienceApi.upsertExperienceCandidate = (async (input) => {
    candidateCalls.push(input);
    return createMockExperienceItem(input);
  }) as typeof experienceApi.upsertExperienceCandidate;

  try {
    seedRelayState(group, [DEV_AGENT]);

    await useGroupStore.getState().sendGroupMessage(group.id, "请处理新的任务");
    await flushAsyncWork();

    assert.equal(candidateCalls.length, 1);
    assert.equal(candidateCalls[0]?.kind, "lesson");
    assert.equal(candidateCalls[0]?.taskTypeJson, '["修复"]');
    assert.equal(candidateCalls[0]?.trigger, "错 应该先");
    assert.equal(candidateCalls[0]?.rule, "已按反馈重新整理答案。");
    assert.equal(candidateCalls[0]?.antiPattern, "错了，应该先保存");
    assert.equal(candidateCalls[0]?.groupId, group.id);
    assert.equal(candidateCalls[0]?.sessionKey, "agent:dev:group:group-1");
    assert.equal(candidateCalls[0]?.feedbackScore, 0.8);
    assert.equal(candidateCalls[0]?.repeatedHits, 1);
    assert.equal(candidateCalls[0]?.confidence, 0.8);
  } finally {
    scenario.restore();
  }
});

void test("成功回复只会查询同一 sessionKey 的最近负反馈", async () => {
  const group = createGroup({
    members: [toGroupMember(DEV_AGENT)],
    leaderId: DEV_AGENT.id,
  });
  const scenario = installGatewayScenario({
    dev: [{ type: "success", content: "我按当前会话反馈修正完成。" }],
  });
  const feedbackQueries: Array<Parameters<typeof experienceApi.getLastFeedbackEvent>[0]> = [];

  experienceApi.getLastFeedbackEvent = (async (input) => {
    feedbackQueries.push(input);
    return null;
  }) as typeof experienceApi.getLastFeedbackEvent;

  try {
    seedRelayState(group, [DEV_AGENT]);

    await useGroupStore.getState().sendGroupMessage(group.id, "请继续处理");
    await flushAsyncWork();

    assert.equal(feedbackQueries.length, 1);
    assert.deepEqual(feedbackQueries[0], {
      groupId: group.id,
      targetAgentId: DEV_AGENT.id,
      sessionKey: "agent:dev:group:group-1",
    });
  } finally {
    scenario.restore();
  }
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

    const result = await useGroupStore.getState().archiveGroupMessages(group.id, "需求复盘");

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
    assert.equal(useGroupStore.getState().archives[0]?.title, "需求复盘");
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

void test("archiveGroupMessages 会异步聚类负反馈并生成经验候选", async () => {
  const group = createGroup({
    members: [toGroupMember(DEV_AGENT)],
    leaderId: DEV_AGENT.id,
  });
  const originalResetSession = gateway.resetSession.bind(gateway);
  const candidateCalls: Array<Parameters<typeof experienceApi.upsertExperienceCandidate>[0]> = [];
  let releaseEventQuery: (() => void) | null = null;
  let didStartEventQuery = false;

  gateway.resetSession = (async () => ({})) as typeof gateway.resetSession;
  experienceApi.listProcessEvents = (async () => {
    didStartEventQuery = true;
    await new Promise<void>((resolve) => {
      releaseEventQuery = resolve;
    });

    return [
      {
        id: "event-2",
        session_key: "agent:dev:group:group-1",
        group_id: group.id,
        target_agent_id: DEV_AGENT.id,
        type: "feedback",
        feedback_type: "negative_explicit",
        sender_id: "user",
        sender_name: "用户",
        content: "错了，应该先保存",
        normalized_content: "错 应该先",
        task_type_json: '["修复"]',
        confidence_delta: 0.8,
        created_at: "1742000001000",
      },
      {
        id: "event-1",
        session_key: "agent:dev:group:group-1",
        group_id: group.id,
        target_agent_id: DEV_AGENT.id,
        type: "feedback",
        feedback_type: "negative_explicit",
        sender_id: "user",
        sender_name: "用户",
        content: "错了，应该先保存",
        normalized_content: "错 应该先",
        task_type_json: '["修复"]',
        confidence_delta: 0.8,
        created_at: "1742000000000",
      },
      {
        id: "event-3",
        session_key: "agent:dev:group:group-1",
        group_id: group.id,
        target_agent_id: DEV_AGENT.id,
        type: "feedback",
        feedback_type: "positive_explicit",
        sender_id: "user",
        sender_name: "用户",
        content: "这次就对了",
        normalized_content: "对",
        task_type_json: null,
        confidence_delta: 0.7,
        created_at: "1742000002000",
      },
    ];
  }) as typeof experienceApi.listProcessEvents;
  experienceApi.upsertExperienceCandidate = (async (input) => {
    candidateCalls.push(input);
    return createMockExperienceItem(input);
  }) as typeof experienceApi.upsertExperienceCandidate;

  try {
    useGroupStore.setState({
      groups: [group],
      selectedGroupId: group.id,
      selectedArchiveId: null,
      messagesByGroupId: {
        [group.id]: [createMessage()],
      },
      archives: [],
      thinkingAgentsByGroupId: new Map(),
      isSendingByGroupId: {},
    });

    const result = await useGroupStore.getState().archiveGroupMessages(group.id, "阶段复盘");

    assert.equal(result.success, true);
    assert.equal(didStartEventQuery, true);
    assert.equal(candidateCalls.length, 0);

    if (!releaseEventQuery) {
      throw new Error("Hook3 事件查询没有进入等待态");
    }

    const releaseQuery: () => void = releaseEventQuery;
    releaseQuery();
    await flushAsyncWork();

    assert.equal(candidateCalls.length, 1);
    assert.equal(
      candidateCalls[0]?.id,
      "hook3:group-1:agent%3Adev%3Agroup%3Agroup-1:%E9%94%99%20%E5%BA%94%E8%AF%A5%E5%85%88",
    );
    assert.equal(candidateCalls[0]?.kind, "lesson");
    assert.equal(candidateCalls[0]?.trigger, "错 应该先");
    assert.equal(candidateCalls[0]?.rule, "遇到同类任务时先自检，避免再次出现：错了，应该先保存");
    assert.equal(candidateCalls[0]?.antiPattern, "错了，应该先保存");
    assert.equal(candidateCalls[0]?.taskTypeJson, '["修复"]');
    assert.equal(candidateCalls[0]?.groupId, group.id);
    assert.equal(candidateCalls[0]?.sessionKey, "agent:dev:group:group-1");
    assert.equal(candidateCalls[0]?.repeatedHits, 2);
    assert.equal(candidateCalls[0]?.confidence, 0.85);
    assert.equal(candidateCalls[0]?.lastSeenAt, "1742000001000");
  } finally {
    gateway.resetSession = originalResetSession;
  }
});

void test("dissolveGroup 会删除群聊、清理运行时并保留项目组归档", async () => {
  const groupA = createGroup({
    id: "group-a",
    name: "A 项目组",
  });
  const groupB = createGroup({
    id: "group-b",
    name: "B 项目组",
  });
  const originalAbortSession = gateway.abortSession.bind(gateway);
  const originalDeleteSession = gateway.deleteSession.bind(gateway);
  const abortCalls: string[] = [];
  const deleteCalls: string[] = [];

  gateway.abortSession = (async (sessionKey: string) => {
    abortCalls.push(sessionKey);
    return { ok: true, aborted: true };
  }) as typeof gateway.abortSession;
  gateway.deleteSession = (async (sessionKey: string) => {
    deleteCalls.push(sessionKey);
    return {};
  }) as typeof gateway.deleteSession;

  try {
    useGroupStore.setState({
      groups: [groupA, groupB],
      selectedGroupId: groupA.id,
      selectedArchiveId: null,
      messagesByGroupId: {
        [groupA.id]: [createMessage()],
        [groupB.id]: [createMessage()],
      },
      archives: [
        {
          id: "archive-a",
          groupId: groupA.id,
          groupName: groupA.name,
          title: "A 组归档",
          createdAt: "2026-03-16T08:00:00.000Z",
          messages: [createMessage()],
        },
      ],
      thinkingAgentsByGroupId: new Map([
        [
          groupA.id,
          new Map([
            [
              DEV_AGENT.id,
              {
                id: DEV_AGENT.id,
                name: DEV_AGENT.name,
                pendingCount: 1,
              },
            ],
          ]),
        ],
      ]),
      announcementSyncStatus: new Map([
        [
          groupA.id,
          {
            [DEV_AGENT.id]: 1,
            [QA_AGENT.id]: 1,
          },
        ],
      ]),
      isSendingByGroupId: {
        [groupA.id]: true,
      },
    });

    useGroupStore.getState().startGroupUrging(groupA.id, 5);
    useGroupStore.getState().startGroupUrging(groupB.id, 10);
    memoryStorage.setItem(`compacted:${groupA.id}:${DEV_AGENT.id}:1`, JSON.stringify({ ok: true }));
    memoryStorage.setItem(`compacted:${groupB.id}:${QA_AGENT.id}:1`, JSON.stringify({ ok: true }));

    const result = await useGroupStore.getState().dissolveGroup(groupA.id);

    assert.equal(result.success, true);
    assert.deepEqual(abortCalls.toSorted(), ["agent:dev:group:group-a", "agent:qa:group:group-a"]);
    assert.deepEqual(deleteCalls.toSorted(), ["agent:dev:group:group-a", "agent:qa:group:group-a"]);
    assert.deepEqual(
      useGroupStore.getState().groups.map((group) => group.id),
      [groupB.id],
    );
    assert.equal(useGroupStore.getState().selectedGroupId, groupB.id);
    assert.equal(groupA.id in useGroupStore.getState().messagesByGroupId, false);
    assert.equal(useGroupStore.getState().thinkingAgentsByGroupId.has(groupA.id), false);
    assert.equal(useGroupStore.getState().announcementSyncStatus.has(groupA.id), false);
    assert.equal(groupA.id in useGroupStore.getState().isSendingByGroupId, false);
    assert.equal(useGroupStore.getState().archives.length, 1);
    assert.equal(useGroupStore.getState().archives[0]?.groupId, groupA.id);
    assert.equal(memoryStorage.getItem(`compacted:${groupA.id}:${DEV_AGENT.id}:1`), null);
    assert.notEqual(memoryStorage.getItem(`compacted:${groupB.id}:${QA_AGENT.id}:1`), null);
    assert.equal(pendingWindowTimers.size, 1);

    const persisted = JSON.parse(memoryStorage.getItem(GROUP_STORAGE_KEY) ?? "{}");
    assert.deepEqual(
      persisted.groups.map((group: Group) => group.id),
      [groupB.id],
    );
    assert.equal(groupA.id in persisted.messagesByGroupId, false);
    assert.equal(persisted.archives.length, 1);
    assert.equal(persisted.archives[0].groupId, groupA.id);
  } finally {
    gateway.abortSession = originalAbortSession;
    gateway.deleteSession = originalDeleteSession;
  }
});

void test("dissolveGroup 在没有其他项目组时会清空当前选中", async () => {
  const group = createGroup();
  const originalAbortSession = gateway.abortSession.bind(gateway);
  const originalDeleteSession = gateway.deleteSession.bind(gateway);

  gateway.abortSession = (async () => ({ ok: true, aborted: true })) as typeof gateway.abortSession;
  gateway.deleteSession = (async () => ({})) as typeof gateway.deleteSession;

  try {
    useGroupStore.setState({
      groups: [group],
      selectedGroupId: group.id,
      selectedArchiveId: null,
      messagesByGroupId: {
        [group.id]: [createMessage()],
      },
      archives: [],
      thinkingAgentsByGroupId: new Map(),
      announcementSyncStatus: new Map(),
      isSendingByGroupId: {},
    });

    const result = await useGroupStore.getState().dissolveGroup(group.id);

    assert.equal(result.success, true);
    assert.equal(useGroupStore.getState().groups.length, 0);
    assert.equal(useGroupStore.getState().selectedGroupId, null);
  } finally {
    gateway.abortSession = originalAbortSession;
    gateway.deleteSession = originalDeleteSession;
  }
});

void test("renameArchive 会同步更新项目组归档标题和本地缓存", () => {
  const group = createGroup();
  useGroupStore.setState({
    groups: [group],
    selectedGroupId: null,
    selectedArchiveId: "archive-1",
    messagesByGroupId: {
      [group.id]: [],
    },
    archives: [
      {
        id: "archive-1",
        groupId: group.id,
        groupName: group.name,
        title: `${group.name} - 2026.03.16`,
        createdAt: "2026-03-16T08:00:00.000Z",
        messages: [createMessage()],
      },
    ],
  });

  const renamed = useGroupStore.getState().renameArchive("archive-1", "新的归档标题");

  assert.equal(renamed, true);
  assert.equal(useGroupStore.getState().archives[0]?.title, "新的归档标题");

  const persisted = JSON.parse(memoryStorage.getItem(GROUP_STORAGE_KEY) ?? "{}");
  assert.equal(persisted.archives[0]?.title, "新的归档标题");
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
  assert.equal(state.archives[0]?.title, `${group.name} - 2026.03.16`);
  assert.equal(state.archives[0]?.messages[0]?.content, "旧版归档内容");
  assert.equal(state.archives[0]?.messages[0]?.thinking, "旧版思考过程");
  assert.equal(state.archives[0]?.messages[0]?.senderId, "qa");
});

void test("fetchGroups 会保留缺少 archiveId 和 createdAt 的旧项目组归档", () => {
  const group = createGroup();

  memoryStorage.setItem(
    GROUP_STORAGE_KEY,
    JSON.stringify({
      groups: [group],
      selectedGroupId: null,
      selectedArchiveId: group.id,
      messagesByGroupId: {
        [group.id]: [],
      },
      archives: [
        {
          groupId: group.id,
          groupName: group.name,
          messages: [],
        },
      ],
    }),
  );

  useGroupStore.getState().fetchGroups();

  const state = useGroupStore.getState();
  assert.equal(state.selectedArchiveId, group.id);
  assert.equal(state.archives.length, 1);
  assert.equal(state.archives[0]?.id, group.id);
  assert.equal(state.archives[0]?.groupId, group.id);
  assert.equal(state.archives[0]?.title, `${group.name} - 1970.01.01`);
  assert.equal(state.archives[0]?.createdAt, new Date(0).toISOString());
  assert.deepEqual(state.archives[0]?.messages, []);
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

  memoryStorage.failAllSets(createQuotaExceededError());
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

void test("保存群公告后会广播给全员，后续同版本 dispatch 不再重复注入公告", async () => {
  const group = createGroup({
    leaderId: LEADER_AGENT.id,
    members: [toGroupMember(DEV_AGENT), toGroupMember(QA_AGENT)],
  });
  const scenario = installGatewayScenario({
    dev: [{ type: "success", content: "已知悉公告" }],
    qa: [
      { type: "success", content: "已知悉公告" },
      { type: "success", content: "我已经按新规范继续处理。" },
    ],
    lead: [{ type: "success", content: "已知悉公告" }],
  });

  try {
    seedRelayState(group, [DEV_AGENT, QA_AGENT, LEADER_AGENT]);

    useGroupStore.getState().updateGroupAnnouncement(group.id, "第一条规范\n第二条规范");
    await flushAsyncWork();
    await flushAsyncWork();

    assert.deepEqual(scenario.sentMessages.map((item) => item.agentId).toSorted(), [
      "dev",
      "lead",
      "qa",
    ]);
    assert.equal(
      scenario.sentMessages.every((item) => item.message.includes("📢 群公告已更新：")),
      true,
    );
    assert.equal(
      scenario.sentMessages.every((item) => !item.message.includes("【群公告】")),
      true,
    );

    const broadcastMessages = useGroupStore.getState().messagesByGroupId[group.id] ?? [];
    assert.equal(
      broadcastMessages.some((message) => message.content.includes("📢 群公告已更新：")),
      true,
    );
    const visibleAcknowledgements = broadcastMessages.filter(
      (message) =>
        message.role === "assistant" &&
        ["dev", "lead", "qa"].includes(message.senderId ?? "") &&
        message.content.includes("已知悉公告"),
    );
    assert.equal(visibleAcknowledgements.length, 3);

    await useGroupStore.getState().sendGroupMessage(group.id, "@小李 请继续执行最新规范");
    await flushAsyncWork();

    const qaDispatch = scenario.sentMessages.find(
      (item, index) => item.agentId === "qa" && index >= 3,
    );
    assert.equal(typeof qaDispatch?.message, "string");
    assert.equal(qaDispatch?.message.includes("【群公告】"), false);
    assert.equal(qaDispatch?.message.includes("请继续执行最新规范"), true);
  } finally {
    scenario.restore();
  }
});

void test("智能督促在群主判断无需催促时不会发送可见催促消息", async () => {
  const group = createGroup({
    leaderId: LEADER_AGENT.id,
    members: [toGroupMember(DEV_AGENT), toGroupMember(QA_AGENT)],
    isUrging: true,
    urgeIntervalMinutes: 5,
    urgeStartedAt: nextTimestamp - 10 * 60 * 1_000,
    urgeCount: 0,
    isUrgePaused: false,
    urgeLastCheckedAt: nextTimestamp - 10 * 60 * 1_000,
  });
  const scenario = installGatewayScenario({
    lead: [
      {
        type: "success",
        content: '{"needUrge":false,"targets":[],"reason":"当前没有未完成任务"}',
      },
    ],
  });

  try {
    seedRelayState(group, [DEV_AGENT, QA_AGENT, LEADER_AGENT]);

    useGroupStore.getState().compensateGroupUrge(group.id);
    await flushAsyncWork();

    assert.deepEqual(
      scenario.sentMessages.map((item) => item.agentId),
      ["lead"],
    );
    assert.deepEqual(useGroupStore.getState().messagesByGroupId[group.id] ?? [], []);
    assert.equal(useGroupStore.getState().groups[0]?.urgeCount, 0);
    assert.equal(typeof useGroupStore.getState().groups[0]?.urgeLastCheckedAt, "number");
  } finally {
    scenario.restore();
  }
});

void test("智能督促在群主判断需要催促时只催 targets 中的成员", async () => {
  const group = createGroup({
    leaderId: LEADER_AGENT.id,
    members: [toGroupMember(DEV_AGENT), toGroupMember(QA_AGENT)],
    isUrging: true,
    urgeIntervalMinutes: 5,
    urgeStartedAt: nextTimestamp - 10 * 60 * 1_000,
    urgeCount: 0,
    isUrgePaused: false,
    urgeLastCheckedAt: nextTimestamp - 10 * 60 * 1_000,
  });
  const scenario = installGatewayScenario({
    lead: [
      {
        type: "success",
        content: '{"needUrge":true,"targets":["小李"],"reason":"小李负责的任务还没回复"}',
      },
    ],
    qa: [{ type: "success", content: "我现在补充最新进度。" }],
  });

  try {
    seedRelayState(group, [DEV_AGENT, QA_AGENT, LEADER_AGENT]);

    useGroupStore.getState().compensateGroupUrge(group.id);
    await flushAsyncWork();

    assert.deepEqual(
      scenario.sentMessages.map((item) => item.agentId),
      ["lead", "qa"],
    );
    const messages = useGroupStore.getState().messagesByGroupId[group.id] ?? [];
    assert.equal(
      messages.some((message) => message.content === "@小李 请汇报当前进度"),
      true,
    );
    assert.equal(
      messages.some((message) => message.content === "@小王 请汇报当前进度"),
      false,
    );
    assert.equal(useGroupStore.getState().groups[0]?.urgeCount, 1);
  } finally {
    scenario.restore();
  }
});

void test("智能督促在群主回复格式异常时会降级为默认催促", async () => {
  const group = createGroup({
    leaderId: LEADER_AGENT.id,
    members: [toGroupMember(DEV_AGENT), toGroupMember(QA_AGENT)],
    isUrging: true,
    urgeIntervalMinutes: 5,
    urgeStartedAt: nextTimestamp - 10 * 60 * 1_000,
    urgeCount: 0,
    isUrgePaused: false,
    urgeLastCheckedAt: nextTimestamp - 10 * 60 * 1_000,
  });
  const scenario = installGatewayScenario({
    lead: [{ type: "success", content: "我觉得你自己判断吧" }],
    dev: [{ type: "success", content: "我补一下我的进度。" }],
    qa: [{ type: "success", content: "我也补一下我的进度。" }],
  });

  try {
    seedRelayState(group, [DEV_AGENT, QA_AGENT, LEADER_AGENT]);

    useGroupStore.getState().compensateGroupUrge(group.id);
    await flushAsyncWork();

    assert.deepEqual(scenario.sentMessages.map((item) => item.agentId).toSorted(), [
      "dev",
      "lead",
      "qa",
    ]);
    const messages = useGroupStore.getState().messagesByGroupId[group.id] ?? [];
    assert.equal(
      messages.some((message) => message.content === "@小王 请汇报当前进度"),
      true,
    );
    assert.equal(
      messages.some((message) => message.content === "@小李 请汇报当前进度"),
      true,
    );
    assert.equal(useGroupStore.getState().groups[0]?.urgeCount, 1);
  } finally {
    scenario.restore();
  }
});

void test("督促检查不会打断正在进行的接力任务", async () => {
  const group = createGroup({
    leaderId: LEADER_AGENT.id,
    members: [toGroupMember(DEV_AGENT), toGroupMember(QA_AGENT)],
    isUrging: true,
    urgeIntervalMinutes: 5,
    urgeStartedAt: nextTimestamp - 10 * 60 * 1_000,
    urgeCount: 0,
    isUrgePaused: false,
    urgeLastCheckedAt: nextTimestamp - 10 * 60 * 1_000,
  });
  const scenario = installGatewayScenario({
    dev: [{ type: "success", content: "我先完成这一段，不艾特别人。" }],
    lead: [
      {
        type: "success",
        content: '{"needUrge":false,"targets":[],"reason":"接力还会继续"}',
      },
      { type: "success", content: "我来接手并继续安排 @小李 你接着汇报。" },
    ],
    qa: [{ type: "success", content: "收到，我继续汇报当前进度。" }],
  });

  try {
    seedRelayState(group, [DEV_AGENT, QA_AGENT, LEADER_AGENT]);

    await useGroupStore
      .getState()
      .sendGroupMessage(group.id, "请所有人接力汇报当前进度，@小王 先开始");
    await flushAsyncWork();

    useGroupStore.getState().compensateGroupUrge(group.id);
    await flushAsyncWork();
    useGroupStore.getState().stopGroupUrging(group.id);

    await flushWindowTimers();

    assert.equal(
      scenario.sentMessages.some(
        (item) => item.agentId === "lead" && item.message.includes("[群内接力兜底]"),
      ),
      false,
    );
    assert.equal(
      scenario.sentMessages.some((item) => item.agentId === "dev"),
      true,
    );
    assert.equal(
      scenario.sentMessages.some((item) => item.agentId === "qa"),
      true,
    );
    const messages = useGroupStore.getState().messagesByGroupId[group.id] ?? [];
    assert.equal(
      messages.some((message) => message.content.includes("我先完成这一段，不艾特别人。")),
      true,
    );
    assert.equal(
      messages.some((message) => message.content.includes("收到，我继续汇报当前进度。")),
      true,
    );
  } finally {
    scenario.restore();
  }
});

void test("消息超过阈值时会先压缩上下文，再发送新消息", async () => {
  const group = createGroup({
    members: [toGroupMember(DEV_AGENT)],
    leaderId: DEV_AGENT.id,
  });
  const originalSendAgentTurn = gateway.sendAgentTurn.bind(gateway);
  const originalWaitForAgentRun = gateway.waitForAgentRun.bind(gateway);
  const originalLoadHistory = gateway.loadHistory.bind(gateway);
  const originalResetSession = gateway.resetSession.bind(gateway);
  const originalSendCompactCommand = gateway.sendCompactCommand.bind(gateway);
  const sentMessages: Array<{ runId: string; message: string }> = [];
  const completedRuns = new Set<string>();
  let nextRunId = 1;
  const summaryRunController: { resolve: (() => void) | null } = {
    resolve: null,
  };

  const initialHistory = Array.from({ length: 31 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: [{ type: "text", text: `历史消息 ${index + 1}` }],
    timestamp: 1_742_000_000_000 + index,
  }));

  gateway.sendCompactCommand = (async () => {
    return {
      type: "res",
      id: "compact-unsupported",
      ok: false,
      error: { message: "unsupported" },
    };
  }) as typeof gateway.sendCompactCommand;

  gateway.resetSession = (async () => {
    return {};
  }) as typeof gateway.resetSession;

  gateway.sendAgentTurn = (async (params) => {
    const runId = `run-${nextRunId++}`;
    sentMessages.push({
      runId,
      message: params.message ?? "",
    });
    return { runId };
  }) as typeof gateway.sendAgentTurn;

  gateway.waitForAgentRun = (async (runId: string) => {
    const currentMessage = sentMessages.find((item) => item.runId === runId)?.message ?? "";
    if (currentMessage.includes("请总结以下群聊记录的关键信息")) {
      await new Promise<void>((resolve) => {
        summaryRunController.resolve = () => {
          completedRuns.add(runId);
          resolve();
        };
      });
      return { status: "ok" };
    }

    completedRuns.add(runId);
    return { status: "ok" };
  }) as typeof gateway.waitForAgentRun;

  gateway.loadHistory = (async () => {
    if (completedRuns.has("run-3")) {
      return {
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "新的回复已经正常返回。" }],
            timestamp: Date.now(),
          },
        ],
      };
    }

    if (completedRuns.has("run-2")) {
      return {
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "已整理" }],
            timestamp: Date.now(),
          },
        ],
      };
    }

    if (completedRuns.has("run-1")) {
      return {
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "这是压缩后的摘要，保留关键任务和待办。" }],
            timestamp: Date.now(),
          },
        ],
      };
    }

    return {
      messages: initialHistory,
    };
  }) as typeof gateway.loadHistory;

  try {
    seedRelayState(group, [DEV_AGENT]);
    useGroupStore.setState({
      messagesByGroupId: {
        [group.id]: Array.from({ length: 31 }, (_, index) => ({
          id: `history-${index}`,
          role: "assistant",
          content: `历史消息 ${index + 1}`,
          timestamp: 1_742_000_000_000 + index,
          isNew: false,
          isHistorical: true,
          senderId: DEV_AGENT.id,
          senderName: DEV_AGENT.name,
        })),
      },
    });

    const sendPromise = useGroupStore.getState().sendGroupMessage(group.id, "请继续处理新的任务");
    await flushAsyncWork();

    assert.equal(
      useGroupStore.getState().getThinkingAgentsForGroup(group.id)[0]?.detail,
      "📋 整理记忆中...",
    );

    if (summaryRunController.resolve) {
      summaryRunController.resolve();
    }
    await flushAsyncWork();
    await sendPromise;

    const messages = useGroupStore.getState().messagesByGroupId[group.id] ?? [];
    const relatedMessages = messages.filter(
      (message) =>
        message.senderId === DEV_AGENT.id || message.sessionTargetIds?.includes(DEV_AGENT.id),
    );

    assert.equal(
      sentMessages.some((item) => item.message.includes("请总结以下群聊记录的关键信息")),
      true,
    );
    assert.equal(
      sentMessages.some((item) => item.message.includes("[系统-上下文压缩同步]")),
      true,
    );
    assert.equal(
      relatedMessages.some((message) => message.content.startsWith("📋 [上下文摘要]")),
      true,
    );
    assert.equal(
      relatedMessages.some((message) => message.content === "历史消息 1"),
      false,
    );
    assert.equal(
      relatedMessages.some((message) => message.content === "历史消息 31"),
      true,
    );
    assert.equal(relatedMessages.length, 8);
    assert.equal(
      relatedMessages.some((message) => message.content.includes("新的回复已经正常返回。")),
      true,
    );
    assert.deepEqual(useGroupStore.getState().getThinkingAgentsForGroup(group.id), []);
  } finally {
    gateway.sendAgentTurn = originalSendAgentTurn;
    gateway.waitForAgentRun = originalWaitForAgentRun;
    gateway.loadHistory = originalLoadHistory;
    gateway.resetSession = originalResetSession;
    gateway.sendCompactCommand = originalSendCompactCommand;
  }
});

void test("消息达到阈值时发送下一条也会先压缩上下文", async () => {
  const group = createGroup({
    members: [toGroupMember(DEV_AGENT)],
    leaderId: DEV_AGENT.id,
  });
  const originalSendAgentTurn = gateway.sendAgentTurn.bind(gateway);
  const originalWaitForAgentRun = gateway.waitForAgentRun.bind(gateway);
  const originalLoadHistory = gateway.loadHistory.bind(gateway);
  const originalResetSession = gateway.resetSession.bind(gateway);
  const originalSendCompactCommand = gateway.sendCompactCommand.bind(gateway);
  const sentMessages: Array<{ runId: string; message: string }> = [];
  const completedRuns = new Set<string>();
  let nextRunId = 1;
  const summaryRunController: { resolve: (() => void) | null } = {
    resolve: null,
  };

  const initialHistory = Array.from({ length: 30 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: [{ type: "text", text: `边界历史消息 ${index + 1}` }],
    timestamp: 1_742_000_000_000 + index,
  }));

  gateway.sendCompactCommand = (async () => {
    return {
      type: "res",
      id: "compact-threshold",
      ok: false,
      error: { message: "unsupported" },
    };
  }) as typeof gateway.sendCompactCommand;

  gateway.resetSession = (async () => {
    return {};
  }) as typeof gateway.resetSession;

  gateway.sendAgentTurn = (async (params) => {
    const runId = `run-threshold-${nextRunId++}`;
    sentMessages.push({
      runId,
      message: params.message ?? "",
    });
    return { runId };
  }) as typeof gateway.sendAgentTurn;

  gateway.waitForAgentRun = (async (runId: string) => {
    const currentMessage = sentMessages.find((item) => item.runId === runId)?.message ?? "";
    if (currentMessage.includes("请总结以下群聊记录的关键信息")) {
      await new Promise<void>((resolve) => {
        summaryRunController.resolve = () => {
          completedRuns.add(runId);
          resolve();
        };
      });
      return { status: "ok" };
    }

    completedRuns.add(runId);
    return { status: "ok" };
  }) as typeof gateway.waitForAgentRun;

  gateway.loadHistory = (async () => {
    if (completedRuns.has("run-threshold-3")) {
      return {
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "边界场景的新回复已返回。" }],
            timestamp: Date.now(),
          },
        ],
      };
    }

    if (completedRuns.has("run-threshold-2")) {
      return {
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "边界场景已整理" }],
            timestamp: Date.now(),
          },
        ],
      };
    }

    if (completedRuns.has("run-threshold-1")) {
      return {
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "这是边界值压缩后的摘要。" }],
            timestamp: Date.now(),
          },
        ],
      };
    }

    return {
      messages: initialHistory,
    };
  }) as typeof gateway.loadHistory;

  try {
    seedRelayState(group, [DEV_AGENT]);
    useGroupStore.setState({
      messagesByGroupId: {
        [group.id]: Array.from({ length: 30 }, (_, index) => ({
          id: `threshold-history-${index}`,
          role: "assistant",
          content: `边界历史消息 ${index + 1}`,
          timestamp: 1_742_000_000_000 + index,
          isNew: false,
          isHistorical: true,
          senderId: DEV_AGENT.id,
          senderName: DEV_AGENT.name,
        })),
      },
    });

    const sendPromise = useGroupStore.getState().sendGroupMessage(group.id, "请继续处理边界值任务");
    await flushAsyncWork();

    assert.equal(
      useGroupStore.getState().getThinkingAgentsForGroup(group.id)[0]?.detail,
      "📋 整理记忆中...",
    );

    if (summaryRunController.resolve) {
      summaryRunController.resolve();
    }
    await flushAsyncWork();
    await sendPromise;

    const messages = useGroupStore.getState().messagesByGroupId[group.id] ?? [];
    const relatedMessages = messages.filter(
      (message) =>
        message.senderId === DEV_AGENT.id || message.sessionTargetIds?.includes(DEV_AGENT.id),
    );

    assert.equal(
      sentMessages.some((item) => item.message.includes("请总结以下群聊记录的关键信息")),
      true,
    );
    assert.equal(
      relatedMessages.some((message) => message.content.startsWith("📋 [上下文摘要]")),
      true,
    );
    assert.equal(
      relatedMessages.some((message) => message.content === "边界历史消息 1"),
      false,
    );
    assert.equal(
      relatedMessages.some((message) => message.content === "边界历史消息 30"),
      true,
    );
    assert.equal(relatedMessages.length, 8);
    assert.equal(
      relatedMessages.some((message) => message.content.includes("边界场景的新回复已返回。")),
      true,
    );
  } finally {
    gateway.sendAgentTurn = originalSendAgentTurn;
    gateway.waitForAgentRun = originalWaitForAgentRun;
    gateway.loadHistory = originalLoadHistory;
    gateway.resetSession = originalResetSession;
    gateway.sendCompactCommand = originalSendCompactCommand;
  }
});
