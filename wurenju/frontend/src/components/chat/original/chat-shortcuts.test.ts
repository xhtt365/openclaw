import assert from "node:assert/strict";
import test from "node:test";
import { isChatSearchShortcut } from "./chat-shortcuts";

void test("isChatSearchShortcut 支持 Cmd/Ctrl + F 和 Cmd/Ctrl + K", () => {
  assert.equal(isChatSearchShortcut({ key: "f", metaKey: true }), true);
  assert.equal(isChatSearchShortcut({ key: "F", ctrlKey: true }), true);
  assert.equal(isChatSearchShortcut({ key: "k", metaKey: true }), true);
  assert.equal(isChatSearchShortcut({ key: "K", ctrlKey: true }), true);
});

void test("isChatSearchShortcut 会排除无效组合", () => {
  assert.equal(isChatSearchShortcut({ key: "k", shiftKey: true, metaKey: true }), false);
  assert.equal(isChatSearchShortcut({ key: "p", metaKey: true }), false);
  assert.equal(isChatSearchShortcut({ key: "f" }), false);
});
