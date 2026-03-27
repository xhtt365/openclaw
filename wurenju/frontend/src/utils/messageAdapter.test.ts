import assert from "node:assert/strict";
import test from "node:test";
import { adaptSidebarSyncMessages } from "./messageAdapter";

void test("adaptSidebarSyncMessages 支持 runtime final 的 text 形状消息", () => {
  const messages = adaptSidebarSyncMessages([
    {
      id: "runtime-final",
      role: "assistant",
      text: "最新回复",
      timestamp: 1_742_203_720_000,
    },
  ]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.id, "runtime-final");
  assert.equal(messages[0]?.content, "最新回复");
  assert.equal(messages[0]?.isHistorical, false);
});

void test("adaptSidebarSyncMessages 保留已适配消息的 string content", () => {
  const messages = adaptSidebarSyncMessages([
    {
      id: "sidebar-user",
      role: "user",
      content: "你：先整理需求",
      timestamp: 1_742_203_600_000,
      isNew: true,
      isHistorical: false,
    },
  ]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.content, "你：先整理需求");
  assert.equal(messages[0]?.isNew, true);
  assert.equal(messages[0]?.isHistorical, false);
});
