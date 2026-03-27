import assert from "node:assert/strict";
import test from "node:test";
import type { Group, GroupChatMessage } from "../stores/groupStore";
import { buildGroupExportFilename, formatGroupTranscript } from "./groupTranscript";

function createGroup(): Group {
  return {
    id: "group-1",
    name: "虾班产品群",
    members: [
      {
        id: "leader-1",
        name: "阿明",
        emoji: "🦐",
        role: "组长",
      },
    ],
    leaderId: "leader-1",
    createdAt: "2026-03-15T12:00:00.000Z",
  };
}

function createMessage(overrides: Partial<GroupChatMessage>): GroupChatMessage {
  return {
    id: overrides.id ?? "message-1",
    role: overrides.role ?? "assistant",
    content: overrides.content ?? "默认内容",
    timestamp: overrides.timestamp,
    timestampLabel: overrides.timestampLabel,
    isNew: overrides.isNew ?? false,
    isHistorical: overrides.isHistorical ?? true,
    senderId: overrides.senderId,
    senderName: overrides.senderName,
    senderEmoji: overrides.senderEmoji,
    senderAvatarUrl: overrides.senderAvatarUrl,
  };
}

void test("formatGroupTranscript 会把 markdown 正文包进引用块，避免污染导出结构", () => {
  const group = createGroup();
  const timestamp = new Date(2025, 2, 15, 14, 30).getTime();
  const transcript = formatGroupTranscript(
    [
      createMessage({
        id: "assistant-1",
        senderId: "leader-1",
        senderName: "阿明",
        content: "# 标题\n- 列表项\n普通正文",
        timestamp,
      }),
    ],
    group,
  );

  assert.match(transcript, /\*\*阿明\*\* \| 2025-03-15 14:30/);
  assert.match(transcript, /> # 标题/);
  assert.match(transcript, /> - 列表项/);
  assert.match(transcript, /> 普通正文/);
  assert.doesNotMatch(transcript, /\n# 标题/);
  assert.ok(transcript.trimEnd().endsWith("---"));
});

void test("formatGroupTranscript 会把系统消息标为系统，并保留空消息占位", () => {
  const group = createGroup();
  const transcript = formatGroupTranscript(
    [
      createMessage({
        id: "system-1",
        senderId: "system",
        senderName: "系统提示",
        content: "",
        timestampLabel: "历史消息",
      }),
    ],
    group,
  );

  assert.match(transcript, /\*\*系统\*\* \| 历史消息/);
  assert.match(transcript, /> （空消息）/);
});

void test("buildGroupExportFilename 会按群名和导出时间生成文件名", () => {
  const filename = buildGroupExportFilename("虾班产品群", new Date(2025, 2, 15, 14, 30, 45));

  assert.equal(filename, "虾班产品群_2025-03-15_14-30-45.md");
});
