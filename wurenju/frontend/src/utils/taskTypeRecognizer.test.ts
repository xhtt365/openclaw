import assert from "node:assert/strict";
import test from "node:test";
import { inspectSequentialRelayRequest } from "./taskTypeRecognizer";

void test("inspectSequentialRelayRequest 能识别明确任务类型", () => {
  assert.deepEqual(inspectSequentialRelayRequest("帮我介绍一下产品"), {
    matchedTaskKeywords: ["介绍"],
    hasClearIntent: true,
  });

  assert.deepEqual(inspectSequentialRelayRequest("汇报一下本周进度"), {
    matchedTaskKeywords: ["汇报进度"],
    hasClearIntent: true,
  });
});

void test("inspectSequentialRelayRequest 会合并多个任务关键词并去重", () => {
  assert.deepEqual(inspectSequentialRelayRequest("请说明一下方案，并总结本周进度"), {
    matchedTaskKeywords: ["说明", "汇报进度"],
    hasClearIntent: true,
  });
});

void test("inspectSequentialRelayRequest 在空文本或无意图时返回空结果", () => {
  assert.deepEqual(inspectSequentialRelayRequest("   "), {
    matchedTaskKeywords: [],
    hasClearIntent: false,
  });

  assert.deepEqual(inspectSequentialRelayRequest("今天天气不错"), {
    matchedTaskKeywords: [],
    hasClearIntent: false,
  });
});
