import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeAssistantText } from "./messageSanitizer";

void test("sanitizeAssistantText 会移除 <final> 包装标签并保留正文", () => {
  const content = "<final>\n大家好，我是 Main。\n</final>";

  assert.equal(sanitizeAssistantText(content), "\n大家好，我是 Main。\n");
});

void test("sanitizeAssistantText 不会改动普通文本", () => {
  const content = "大家好，我是 Main。";

  assert.equal(sanitizeAssistantText(content), content);
});
