import assert from "node:assert/strict";
import { after, afterEach, before } from "node:test";
import test from "node:test";
import type { Agent } from "../stores/agentStore";
import { useGroupStore, type Group, type GroupChatMessage } from "../stores/groupStore";
import {
  addAgentToGroup,
  getAvailableGroupAgents,
  getGroupDisplayMemberCount,
  removeAgentFromGroup,
} from "./groupMembers";

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

function createQuotaExceededError() {
  const error = new Error("Quota exceeded");
  error.name = "QuotaExceededError";
  return error;
}

function createGroup(
  members: Group["members"] = [DEV_AGENT].map((agent) => ({
    id: agent.id,
    name: agent.name,
    emoji: agent.emoji,
    role: agent.role,
  })),
): Group {
  return {
    id: "group-1",
    name: "M14 项目组",
    members,
    leaderId: "dev",
    createdAt: "2026-03-15T12:00:00.000Z",
  };
}

function createMessage(senderId: string): GroupChatMessage {
  return {
    id: `message-${senderId}`,
    role: "assistant",
    content: `${senderId} 的历史消息`,
    timestamp: 1_742_000_000_000,
    isNew: false,
    isHistorical: true,
    senderId,
    senderName: senderId,
  };
}

function resetGroupStore() {
  useGroupStore.setState({
    groups: [],
    selectedGroupId: null,
    selectedArchiveId: null,
    messagesByGroupId: {},
    archives: [],
  });
  memoryStorage.clear();
}

before(() => {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: memoryStorage },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  resetGroupStore();
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

void test("getAvailableGroupAgents 只返回未加入项目组的 Agent，显示人数包含 You", () => {
  const group = createGroup();
  const availableAgents = getAvailableGroupAgents(group, [DEV_AGENT, QA_AGENT]);

  assert.deepEqual(
    availableAgents.map((agent) => agent.id),
    ["qa"],
  );
  assert.equal(getGroupDisplayMemberCount(group), 2);
});

void test("addAgentToGroup 会同步更新 store 和 localStorage", () => {
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

  const result = addAgentToGroup(group.id, QA_AGENT);

  assert.equal(result.changed, true);
  assert.deepEqual(
    useGroupStore.getState().groups[0]?.members.map((member) => member.id),
    ["dev", "qa"],
  );

  const persisted = JSON.parse(memoryStorage.getItem("wurenju.groups.v1") ?? "{}");
  assert.deepEqual(
    persisted.groups[0].members.map((member: { id: string }) => member.id),
    ["dev", "qa"],
  );
});

void test("removeAgentFromGroup 会保留历史消息，并阻止移除群主", () => {
  const group = createGroup([
    {
      id: DEV_AGENT.id,
      name: DEV_AGENT.name,
      emoji: DEV_AGENT.emoji,
      role: DEV_AGENT.role,
    },
    {
      id: QA_AGENT.id,
      name: QA_AGENT.name,
      emoji: QA_AGENT.emoji,
      role: QA_AGENT.role,
    },
  ]);
  const historyMessage = createMessage(QA_AGENT.id);

  useGroupStore.setState({
    groups: [group],
    selectedGroupId: group.id,
    selectedArchiveId: null,
    messagesByGroupId: {
      [group.id]: [historyMessage],
    },
    archives: [],
  });

  const leaderResult = removeAgentFromGroup(group.id, DEV_AGENT.id);
  assert.equal(leaderResult.changed, false);
  assert.equal(leaderResult.reason, "leader_locked");

  const result = removeAgentFromGroup(group.id, QA_AGENT.id);
  assert.equal(result.changed, true);
  assert.deepEqual(
    useGroupStore.getState().groups[0]?.members.map((member) => member.id),
    ["dev"],
  );
  assert.equal(useGroupStore.getState().messagesByGroupId[group.id]?.[0]?.id, historyMessage.id);
  assert.equal(useGroupStore.getState().messagesByGroupId[group.id]?.[1]?.content, "小李 已被移除");

  const persisted = JSON.parse(memoryStorage.getItem("wurenju.groups.v1") ?? "{}");
  assert.equal(persisted.messagesByGroupId[group.id][0].id, historyMessage.id);
  assert.equal(persisted.messagesByGroupId[group.id][1].content, "小李 已被移除");
});

void test("removeAgentFromGroup 在无接力时会清理 thinking 并追加系统提示", () => {
  const group = createGroup([
    {
      id: DEV_AGENT.id,
      name: DEV_AGENT.name,
      emoji: DEV_AGENT.emoji,
      role: DEV_AGENT.role,
    },
    {
      id: QA_AGENT.id,
      name: QA_AGENT.name,
      emoji: QA_AGENT.emoji,
      role: QA_AGENT.role,
    },
  ]);

  useGroupStore.setState({
    groups: [group],
    selectedGroupId: group.id,
    selectedArchiveId: null,
    messagesByGroupId: {
      [group.id]: [],
    },
    archives: [],
    thinkingAgentsByGroupId: new Map([
      [
        group.id,
        new Map([
          [
            QA_AGENT.id,
            {
              id: QA_AGENT.id,
              name: QA_AGENT.name,
              pendingCount: 2,
            },
          ],
        ]),
      ],
    ]),
    isSendingByGroupId: {},
  });

  const result = removeAgentFromGroup(group.id, QA_AGENT.id);

  assert.equal(result.changed, true);
  assert.equal(useGroupStore.getState().thinkingAgentsByGroupId.has(group.id), false);
  assert.equal(useGroupStore.getState().messagesByGroupId[group.id]?.[0]?.content, "小李 已被移除");
});

void test("persistSnapshot 写失败时不会伪造成员变更成功", () => {
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
  const result = addAgentToGroup(group.id, QA_AGENT);

  assert.equal(result.changed, false);
  assert.deepEqual(
    useGroupStore.getState().groups[0]?.members.map((member) => member.id),
    ["dev"],
  );
  assert.equal(memoryStorage.getItem("wurenju.groups.v1"), null);
});
