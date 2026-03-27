import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldHideSystemToolMessage,
  shouldHideSystemToolStreamText,
} from "./system-message-filter.ts";

void test("shouldHideSystemToolMessage 会过滤 tool read 文本消息", () => {
  assert.equal(
    shouldHideSystemToolMessage({
      role: "assistant",
      content: [{ type: "text", text: "3 tools read" }],
      timestamp: 1,
    }),
    true,
  );

  assert.equal(
    shouldHideSystemToolMessage({
      role: "assistant",
      text: "Tool output read",
      timestamp: 2,
    }),
    true,
  );
});

void test("shouldHideSystemToolMessage 会过滤 tool 类型和 Tool 标签消息", () => {
  assert.equal(
    shouldHideSystemToolMessage({
      role: "tool_result",
      content: [{ type: "text", text: "tool output" }],
      timestamp: 3,
    }),
    true,
  );

  assert.equal(
    shouldHideSystemToolMessage({
      role: "assistant",
      senderLabel: "Tool",
      content: [{ type: "text", text: "22:32" }],
      timestamp: 4,
    }),
    true,
  );
});

void test("shouldHideSystemToolMessage 会过滤 system 和新会话启动提示", () => {
  assert.equal(
    shouldHideSystemToolMessage({
      role: "system",
      content: [{ type: "text", text: "internal boot message" }],
      timestamp: 5,
    }),
    true,
  );

  assert.equal(
    shouldHideSystemToolMessage({
      role: "assistant",
      content: [
        {
          type: "text",
          text: "A new session was started via /new or /reset. Run your Session Startup sequence now.",
        },
      ],
      timestamp: 6,
    }),
    true,
  );

  assert.equal(
    shouldHideSystemToolMessage({
      role: "assistant",
      text: "Tool output: hidden debug text",
      timestamp: 7,
    }),
    true,
  );
});

void test("shouldHideSystemToolMessage 保留正常 assistant 文本", () => {
  assert.equal(
    shouldHideSystemToolMessage({
      role: "assistant",
      content: [{ type: "text", text: "嘿老板！我是小虾，有什么需要帮忙的吗？" }],
      timestamp: 8,
    }),
    false,
  );

  assert.equal(shouldHideSystemToolStreamText("1 tool read"), true);
  assert.equal(
    shouldHideSystemToolStreamText(
      "A new session was started via /new or /reset. Run your Session Startup sequence now.",
    ),
    true,
  );
  assert.equal(shouldHideSystemToolStreamText("Tool output: hidden debug text"), true);
  assert.equal(shouldHideSystemToolStreamText("正常流式回复"), false);
});
