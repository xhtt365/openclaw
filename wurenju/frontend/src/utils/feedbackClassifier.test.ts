import assert from "node:assert/strict";
import test from "node:test";
import { classifyFeedback } from "./feedbackClassifier";

void test("classifyFeedback 优先识别负面反馈", () => {
  assert.deepEqual(classifyFeedback("错了，应该先保存"), {
    type: "negative_explicit",
    keywords: ["错", "应该先"],
    confidence: 0.8,
  });
});

void test("classifyFeedback 能识别强正面与弱正面反馈", () => {
  assert.deepEqual(classifyFeedback("这就是我要的答案，完美"), {
    type: "positive_explicit",
    keywords: ["这就是", "完美"],
    confidence: 0.7,
  });

  assert.deepEqual(classifyFeedback("谢谢你的帮助"), {
    type: "positive_weak",
    keywords: ["谢谢"],
    confidence: 0.5,
  });

  assert.deepEqual(classifyFeedback("好的，明白了"), {
    type: "positive_weak",
    keywords: ["好", "明白"],
    confidence: 0.4,
  });
});

void test("classifyFeedback 会同时提取任务类型关键词", () => {
  assert.deepEqual(classifyFeedback("不对，重新介绍一下产品"), {
    type: "negative_explicit",
    keywords: ["不对", "重新来", "介绍"],
    confidence: 0.8,
  });
});

void test("classifyFeedback 对无匹配内容返回中性结果", () => {
  assert.deepEqual(classifyFeedback("今天天气不错"), {
    type: "neutral",
    keywords: [],
    confidence: 0.3,
  });
});
