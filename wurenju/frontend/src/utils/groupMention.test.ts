import assert from "node:assert/strict";
import test from "node:test";
import {
  findActiveGroupMention,
  insertGroupMention,
  matchesGroupMentionQuery,
} from "./groupMention";

void test("findActiveGroupMention 能识别群聊输入中的活动 @ 片段", () => {
  const text = "请 @马老师 看一下";
  const caret = "请 @马".length;

  assert.deepEqual(findActiveGroupMention(text, caret), {
    start: 2,
    end: 6,
    query: "马",
  });
});

void test("findActiveGroupMention 不会把邮箱误判成成员提及", () => {
  const text = "邮箱 test@example.com";

  assert.equal(findActiveGroupMention(text, text.length), null);
});

void test("insertGroupMention 会整段替换当前提及 token，避免残留旧名字", () => {
  const text = "请 @马老师 今天同步";
  const caret = "请 @马".length;
  const match = findActiveGroupMention(text, caret);

  assert.deepEqual(insertGroupMention(text, "产品经理", match, caret), {
    value: "请 @产品经理 今天同步",
    caret: "请 @产品经理".length,
  });
});

void test("insertGroupMention 在没有活动提及时会按光标位置插入", () => {
  assert.deepEqual(insertGroupMention("你好世界", "马老师", null, 2), {
    value: "你好 @马老师 世界",
    caret: 8,
  });
});

void test("matchesGroupMentionQuery 支持中文名称模糊过滤", () => {
  assert.equal(matchesGroupMentionQuery("马老师", "马"), true);
  assert.equal(matchesGroupMentionQuery("产品经理", "马"), false);
});
