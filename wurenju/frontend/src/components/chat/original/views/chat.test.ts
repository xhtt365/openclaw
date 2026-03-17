import assert from "node:assert/strict";
import test from "node:test";
import { nothing, type TemplateResult } from "lit";
import { groupMessages, renderChat } from "./chat";

function templateToString(value: unknown): string {
  if (value == null || value === false || value === nothing) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map((entry) => templateToString(entry)).join("");
  }

  if (typeof value === "object" && value !== null && "strings" in value && "values" in value) {
    const template = value as TemplateResult;
    let output = "";

    for (let index = 0; index < template.strings.length; index += 1) {
      output += template.strings[index] ?? "";
      if (index < template.values.length) {
        output += templateToString(template.values[index]);
      }
    }

    return output;
  }

  if (typeof value === "function") {
    return "[fn]";
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "symbol"
  ) {
    return String(value);
  }

  return "[obj]";
}

void test("groupMessages 会按 assistant senderLabel 拆分群聊消息分组", () => {
  const grouped = groupMessages([
    {
      kind: "message",
      key: "alice-1",
      message: {
        id: "alice-1",
        role: "assistant",
        senderLabel: "Alice",
        content: [{ type: "text", text: "先看首页" }],
        timestamp: 10,
      },
    },
    {
      kind: "message",
      key: "bob-1",
      message: {
        id: "bob-1",
        role: "assistant",
        senderLabel: "Bob",
        content: [{ type: "text", text: "我补充接口" }],
        timestamp: 20,
      },
    },
  ]);

  assert.equal(grouped.length, 2);
  assert.equal(grouped[0]?.kind, "group");
  assert.equal(grouped[1]?.kind, "group");
  assert.equal(grouped[0] && "senderLabel" in grouped[0] ? grouped[0].senderLabel : null, "Alice");
  assert.equal(grouped[1] && "senderLabel" in grouped[1] ? grouped[1].senderLabel : null, "Bob");
});

void test("groupMessages 会保留成员头像元数据供聊天气泡渲染", () => {
  const grouped = groupMessages([
    {
      kind: "message",
      key: "alice-1",
      message: {
        id: "alice-1",
        role: "assistant",
        senderLabel: "Alice",
        senderId: "alice",
        senderAvatarUrl: "https://cdn.example.com/alice.png",
        content: [{ type: "text", text: "我来补充一下设计稿。" }],
        timestamp: 10,
      },
    },
  ]);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]?.kind, "group");
  assert.equal(grouped[0] && "senderId" in grouped[0] ? grouped[0].senderId : null, "alice");
  assert.equal(
    grouped[0] && "senderAvatarUrl" in grouped[0] ? grouped[0].senderAvatarUrl : null,
    "https://cdn.example.com/alice.png",
  );
  assert.equal(
    grouped[0] && "senderAvatarText" in grouped[0] ? grouped[0].senderAvatarText : null,
    "A",
  );
});

void test("renderChat 在群聊模式下保留真实成员头像和 @ 提及浮层，并渲染快捷 @ 条", () => {
  const markup = templateToString(
    renderChat({
      sessionKey: "agent:leader:group:design-review",
      onSessionKeyChange: () => {},
      thinkingLevel: null,
      showThinking: true,
      loading: false,
      sending: false,
      messages: [
        {
          id: "alice-1",
          role: "assistant",
          senderLabel: "Alice",
          senderId: "alice",
          senderAvatarUrl: "https://cdn.example.com/alice.png",
          content: [{ type: "text", text: "我来补充一下设计稿。" }],
          timestamp: 10,
        },
      ],
      toolMessages: [],
      streamSegments: [],
      stream: null,
      streamStartedAt: null,
      assistantAvatarUrl: "/groups/design-review.png",
      assistantAvatarText: "设",
      assistantAvatarColor: "var(--accent)",
      userAvatar: null,
      userName: "你",
      draft: "@A",
      inputPlaceholder: "输入消息，按 @ 提及成员",
      queue: [],
      connected: true,
      canSend: true,
      disabledReason: null,
      error: null,
      sessions: { sessions: [] },
      focusMode: false,
      assistantName: "设计项目组",
      assistantAvatar: "/groups/design-review.png",
      attachments: [],
      hideAttachmentButton: false,
      groupCompose: {
        previewHtml: "",
        mentionQuery: "A",
        mentionOpen: true,
        mentionActiveIndex: 0,
        mentionMembers: [
          {
            id: "alice",
            name: "Alice",
            avatarText: "A",
            avatarUrl: "https://cdn.example.com/alice.png",
            avatarColor: "var(--color-avatar-1)",
            role: "设计师",
          },
        ],
        quickMentionMembers: [
          {
            id: "alice",
            name: "Alice",
          },
        ],
        onMentionSelect: () => {},
        onMentionNavigate: () => {},
        onMentionActiveIndexChange: () => {},
        onMentionDismiss: () => {},
      },
      onAttachmentsChange: () => {},
      showNewMessages: false,
      onScrollToBottom: () => {},
      onRefresh: () => {},
      onToggleFocusMode: () => {},
      onDraftChange: () => {},
      onDraftSelectionChange: () => {},
      onDraftFocusChange: () => {},
      onRequestUpdate: () => {},
      onSend: () => {},
      onQueueRemove: () => {},
      onNewSession: () => {},
      onUserAvatarClick: () => {},
      agentsList: { agents: [], defaultId: "leader" },
      currentAgentId: "leader",
      onAgentChange: () => {},
      onNavigateToAgent: () => {},
      onSessionSelect: () => {},
      onOpenSidebar: () => {},
      onCloseSidebar: () => {},
      onSplitRatioChange: () => {},
      onChatScroll: () => {},
    }),
  );

  assert.match(markup, /https:\/\/cdn\.example\.com\/alice\.png/);
  assert.match(markup, /surface-group-mention-popover/);
  assert.match(markup, /surface-group-quick-mentions/);
  assert.match(markup, /@Alice/);
  assert.match(markup, /输入消息，按 @ 提及成员/);
  assert.match(markup, /title="Attach file"/);
  assert.ok(
    markup.indexOf("surface-group-quick-mentions") < markup.indexOf("agent-chat__toolbar-right"),
  );
  assert.doesNotMatch(markup, /agent-chat__textarea-preview/);
  assert.doesNotMatch(markup, /agent-chat__textarea--group/);
});

void test("renderChat 在新建会话等待首条正式回复时渲染居中三点加载", () => {
  const markup = templateToString(
    renderChat({
      sessionKey: "agent:shrimp:main",
      onSessionKeyChange: () => {},
      thinkingLevel: null,
      showThinking: true,
      loading: false,
      newSessionLoading: true,
      sending: false,
      messages: [],
      toolMessages: [],
      streamSegments: [],
      stream: null,
      streamStartedAt: null,
      assistantAvatarUrl: null,
      assistantAvatarText: "虾",
      assistantAvatarColor: "var(--accent)",
      userAvatar: null,
      userName: "你",
      draft: "",
      queue: [],
      connected: true,
      canSend: true,
      disabledReason: null,
      error: null,
      sessions: { sessions: [] },
      focusMode: false,
      assistantName: "小虾",
      assistantAvatar: null,
      attachments: [],
      hideAttachmentButton: false,
      onAttachmentsChange: () => {},
      showNewMessages: false,
      onScrollToBottom: () => {},
      onRefresh: () => {},
      onToggleFocusMode: () => {},
      onDraftChange: () => {},
      onRequestUpdate: () => {},
      onSend: () => {},
      onQueueRemove: () => {},
      onNewSession: () => {},
      agentsList: { agents: [], defaultId: "shrimp" },
      currentAgentId: "shrimp",
      onAgentChange: () => {},
    }),
  );

  assert.match(markup, /chat-new-session-loading/);
  assert.match(markup, /正在唤醒助手/);
  assert.doesNotMatch(markup, /agent-chat__welcome/);
});
