import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptGroupMessagesToSurfaceMessages,
  buildGroupSurfaceSessionKey,
  buildGroupSurfaceSessions,
} from "./groupSurfaceAdapter";

void test("buildGroupSurfaceSessionKey 生成原版聊天壳可识别的群会话 key", () => {
  assert.equal(
    buildGroupSurfaceSessionKey({
      id: "Design Review",
      leaderId: "alice",
    }),
    "agent:alice:group:design%20review",
  );
});

void test("adaptGroupMessagesToSurfaceMessages 会保留群聊发言人的显示名", () => {
  const messages = adaptGroupMessagesToSurfaceMessages([
    {
      id: "user-1",
      role: "user",
      content: "大家先对齐一下需求",
      timestamp: 10,
      isNew: false,
      isHistorical: true,
    },
    {
      id: "assistant-1",
      role: "assistant",
      content: "我先补充接口方案",
      thinking: "先确认上下文",
      senderName: "Alice",
      timestamp: 20,
      isNew: false,
      isHistorical: true,
    },
  ]);

  assert.deepEqual(messages[0], {
    id: "user-1",
    role: "user",
    content: [{ type: "text", text: "大家先对齐一下需求" }],
    timestamp: 10,
    senderLabel: "你",
    senderId: undefined,
    senderAvatarUrl: undefined,
    senderAvatarText: undefined,
    model: undefined,
    usage: undefined,
  });
  assert.deepEqual(messages[1], {
    id: "assistant-1",
    role: "assistant",
    content: [
      { type: "thinking", thinking: "先确认上下文" },
      { type: "text", text: "我先补充接口方案" },
    ],
    timestamp: 20,
    senderLabel: "Alice",
    senderId: undefined,
    senderAvatarUrl: undefined,
    senderAvatarText: "A",
    model: undefined,
    usage: undefined,
  });
});

void test("adaptGroupMessagesToSurfaceMessages 会在消息缺少头像时回填成员缓存里的真实头像", () => {
  const messages = adaptGroupMessagesToSurfaceMessages(
    [
      {
        id: "assistant-2",
        role: "assistant",
        content: "我来补充排期",
        senderId: "alice",
        senderName: "Alice",
        timestamp: 30,
        isNew: false,
        isHistorical: true,
      },
    ],
    [
      {
        id: "alice",
        name: "Alice",
        avatarUrl: "https://cdn.example.com/alice-real.png",
      },
    ],
  );

  assert.equal(messages[0]?.senderAvatarUrl, "https://cdn.example.com/alice-real.png");
  assert.equal(messages[0]?.senderAvatarText, "A");
});

void test("buildGroupSurfaceSessions 会把项目组包装成单一原版会话", () => {
  const sessions = buildGroupSurfaceSessions({
    group: {
      id: "design-review",
      name: "设计评审组",
      members: [
        {
          id: "alice",
          name: "Alice",
        },
      ],
      leaderId: "alice",
      createdAt: "2026-03-16T08:00:00.000Z",
    },
    messages: [
      {
        id: "assistant-1",
        role: "assistant",
        content: "先看首页动线",
        senderName: "Alice",
        model: "gpt-5",
        timestamp: 42,
        isNew: false,
        isHistorical: true,
      },
    ],
    contextTokens: 8192,
  });

  assert.deepEqual(sessions, {
    defaults: {
      contextTokens: 8192,
      model: null,
    },
    sessions: [
      {
        key: "agent:alice:group:design-review",
        label: "设计评审组",
        displayName: "设计评审组",
        updatedAt: 42,
        contextTokens: 8192,
        model: "gpt-5",
      },
    ],
  });
});
