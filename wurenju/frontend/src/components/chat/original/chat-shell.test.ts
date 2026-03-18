import assert from "node:assert/strict";
import test from "node:test";
import { html, nothing, type TemplateResult } from "lit";
import { renderOriginalChatShell } from "./chat-shell";

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

void test("renderOriginalChatShell 输出原版聊天顶栏和控制区", () => {
  const markup = templateToString(
    renderOriginalChatShell({
      activeAgentId: "main",
      assistantName: "Main",
      headerTitle: "周杰伦",
      agentNamesById: {
        main: "虾班",
      },
      members: [
        { id: "zhoujielun", name: "周杰伦" },
        { id: "linjunjie", name: "林俊杰" },
      ],
      groups: [
        { id: "group-2", name: "发布组" },
        { id: "group-1", name: "设计组" },
      ],
      currentGroupId: null,
      connected: true,
      loading: false,
      sending: false,
      busy: false,
      themeMode: "dark",
      error: null,
      showThinking: true,
      focusMode: true,
      hideCronSessions: true,
      hiddenCronCount: 2,
      sessions: {
        defaults: {
          model: "MiniMax-M2.5",
        },
        sessions: [
          {
            key: "agent:main:main",
            label: "main",
            updatedAt: Date.now(),
          },
          {
            key: "agent:main:cron:daily-report",
            label: "cron:daily-report",
            updatedAt: Date.now(),
          },
        ],
      },
      sessionKey: "agent:main:main",
      modelValue: "MiniMax-M2.5",
      defaultModelValue: "MiniMax-M2.5",
      modelOptions: [
        {
          value: "MiniMax-M2.5",
          label: "MiniMax-M2.5 · minimax",
        },
        {
          value: "gpt-5.2",
          label: "gpt-5.2 · openai",
        },
      ],
      modelsLoading: false,
      onToggleSearch: () => {},
      onThemeModeChange: () => {},
      onMemberSelect: () => {},
      onGroupSelect: () => {},
      onSessionSelect: () => {},
      onModelSelect: () => {},
      onArchiveConversationClick: () => {},
      onRefresh: () => {},
      onToggleThinking: () => {},
      onToggleFocusMode: () => {},
      onToggleHideCronSessions: () => {},
      body: html`
        <section data-test-id="body-slot">body</section>
      `,
    }),
  );

  assert.match(markup, /openclaw-chat-shell--focus/);
  assert.match(markup, />周杰伦</);
  assert.doesNotMatch(markup, /topbar-search/);
  assert.match(markup, /data-chat-member-select="true"/);
  assert.match(markup, /data-chat-group-select="true"/);
  assert.match(markup, /data-chat-model-select="true"/);
  assert.match(markup, />切换成员</);
  assert.match(markup, />选择项目组</);
  assert.match(markup, />选择模型</);
  assert.match(markup, /MiniMax-M2\.5 · minimax/);
  assert.match(markup, /刷新聊天数据/);
  assert.match(markup, /归档当前会话/);
  assert.match(markup, /切换助手思考\/工作输出/);
  assert.match(markup, /切换专注模式 \(隐藏侧边栏 \+ 页面页眉\)/);
  assert.match(markup, /显示定时任务会话 \(已隐藏 2 个\)/);
  assert.match(markup, /data-test-id="body-slot"/);
});

void test("renderOriginalChatShell 的成员和项目组下拉只渲染本地选项", () => {
  const markup = templateToString(
    renderOriginalChatShell({
      activeAgentId: "zhoujielun",
      assistantName: "周杰伦",
      headerTitle: "周杰伦",
      agentNamesById: {
        zhoujielun: "周杰伦",
      },
      members: [{ id: "zhoujielun", name: "周杰伦" }],
      groups: [{ id: "group-1", name: "演唱会项目组" }],
      currentGroupId: null,
      connected: true,
      loading: false,
      sending: false,
      busy: false,
      themeMode: "dark",
      error: null,
      showThinking: true,
      focusMode: false,
      hideCronSessions: true,
      hiddenCronCount: 0,
      sessions: {
        sessions: [
          {
            key: "agent:zhoujielun:main",
            label: "main",
            updatedAt: Date.now(),
          },
        ],
      },
      sessionKey: "agent:zhoujielun:main",
      modelValue: "",
      defaultModelValue: "",
      modelOptions: [],
      modelsLoading: false,
      onToggleSearch: () => {},
      onThemeModeChange: () => {},
      onMemberSelect: () => {},
      onGroupSelect: () => {},
      onSessionSelect: () => {},
      onModelSelect: () => {},
      onArchiveConversationClick: () => {},
      onRefresh: () => {},
      onToggleThinking: () => {},
      onToggleFocusMode: () => {},
      onToggleHideCronSessions: () => {},
      body: html`
        <section>body</section>
      `,
    }),
  );

  assert.match(markup, />周杰伦<\/option>/);
  assert.match(markup, />演唱会项目组<\/option>/);
  assert.doesNotMatch(markup, /group:xxx/);
});

void test("renderOriginalChatShell 不会在按钮区左侧额外渲染错误 pill", () => {
  const markup = templateToString(
    renderOriginalChatShell({
      activeAgentId: "alice",
      assistantName: "设计评审组",
      headerTitle: "设计评审组",
      agentNamesById: {
        alice: "设计评审组",
      },
      members: [{ id: "alice", name: "Alice" }],
      groups: [{ id: "design-review", name: "设计评审组" }],
      currentGroupId: "design-review",
      connected: true,
      loading: false,
      sending: false,
      busy: false,
      themeMode: "dark",
      error: "Failed to set model",
      showThinking: true,
      focusMode: false,
      hideCronSessions: true,
      hiddenCronCount: 0,
      sessions: {
        sessions: [],
      },
      sessionKey: "agent:alice:group:design-review",
      modelValue: "",
      defaultModelValue: "项目组会话",
      modelOptions: [],
      modelsLoading: true,
      onToggleSearch: () => {},
      onThemeModeChange: () => {},
      onMemberSelect: () => {},
      onGroupSelect: () => {},
      onSessionSelect: () => {},
      onModelSelect: () => {},
      onArchiveConversationClick: () => {},
      onRefresh: () => {},
      onToggleThinking: () => {},
      onToggleFocusMode: () => {},
      onToggleHideCronSessions: () => {},
      body: html`
        <section>body</section>
      `,
    }),
  );

  assert.doesNotMatch(markup, /pill danger/);
  assert.doesNotMatch(markup, /Failed to set model/);
});

void test("renderOriginalChatShell 在群聊模式下渲染项目组专属标题、双下拉和功能按钮", () => {
  const markup = templateToString(
    renderOriginalChatShell({
      activeAgentId: "leader",
      assistantName: "设计项目组",
      headerTitle: "设计项目组",
      isGroupMode: true,
      groupHeader: {
        name: "设计项目组",
        avatarText: "组",
        avatarUrl: "group.png",
        memberCount: 8,
        members: [
          { id: "leader", name: "Leader", avatarText: "L", avatarUrl: "leader.png" },
          { id: "alice", name: "Alice", avatarText: "A" },
          { id: "bob", name: "Bob", avatarText: "B" },
        ],
      },
      hasAnnouncement: true,
      isUrging: true,
      isUrgePaused: false,
      agentNamesById: {
        leader: "设计项目组",
      },
      members: [{ id: "alice", name: "Alice" }],
      groups: [{ id: "group-1", name: "设计项目组" }],
      currentGroupId: "group-1",
      connected: true,
      loading: false,
      sending: false,
      busy: false,
      themeMode: "dark",
      error: null,
      showThinking: true,
      focusMode: false,
      hideCronSessions: true,
      hiddenCronCount: 1,
      sessions: {
        sessions: [],
      },
      sessionKey: "agent:leader:group:group-1",
      modelValue: "",
      defaultModelValue: "项目组会话",
      modelOptions: [],
      modelsLoading: false,
      onToggleSearch: () => {},
      onThemeModeChange: () => {},
      onMemberSelect: () => {},
      onGroupSelect: () => {},
      onSessionSelect: () => {},
      onModelSelect: () => {},
      onGroupHeaderMemberClick: () => {},
      onArchiveConversationClick: () => {},
      onAnnouncementClick: () => {},
      onUrgeClick: () => {},
      onRefresh: () => {},
      onToggleThinking: () => {},
      onToggleFocusMode: () => {},
      onToggleHideCronSessions: () => {},
      body: html`
        <section>body</section>
      `,
    }),
  );

  assert.match(markup, /surface-group-topbar/);
  assert.match(markup, />设计项目组</);
  assert.match(markup, /surface-group-topbar__title-row[\s\S]*surface-group-topbar__members/);
  assert.match(markup, /surface-group-identity-avatar/);
  assert.match(markup, /leader\.png/);
  assert.match(markup, /\(8人\)/);
  assert.match(markup, />私聊成员</);
  assert.match(markup, />切换项目组</);
  assert.doesNotMatch(markup, /data-chat-model-select="true"/);
  assert.match(markup, />群公告</);
  assert.match(markup, />督促中</);
  assert.match(markup, /surface-group-more/);
  assert.match(markup, /更多操作/);
  assert.match(markup, /surface-group-more__dot/);
  assert.match(markup, /surface-group-topbar__avatar-btn/);
  assert.match(markup, />关闭消息提醒</);
  assert.match(markup, />关闭音效</);
  assert.match(markup, />编辑项目组</);
  assert.match(markup, />成员管理</);
  assert.match(markup, />重置对话</);
  assert.doesNotMatch(markup, /搜索消息/);
});
