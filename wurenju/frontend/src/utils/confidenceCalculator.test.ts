import assert from "node:assert/strict";
import test from "node:test";
import { calculateConfidence } from "./confidenceCalculator";

void test("calculateConfidence 按反馈类型和重复命中次数计算置信度", () => {
  assert.equal(calculateConfidence({ feedbackType: "negative_explicit", repeatedHits: 3 }), 0.9);
  assert.equal(calculateConfidence({ feedbackType: "positive_explicit" }), 0.7);
  assert.equal(calculateConfidence({ feedbackType: "positive_weak" }), 0.5);
  assert.equal(calculateConfidence({ feedbackType: "neutral" }), 0.3);
});

void test("calculateConfidence 会对极值做夹取并处理礼貌回复", () => {
  assert.equal(
    calculateConfidence({
      feedbackType: "negative_explicit",
      repeatedHits: 20,
      isPoliteResponse: true,
    }),
    0.9,
  );
  assert.equal(
    calculateConfidence({
      feedbackType: "positive_weak",
      isPoliteResponse: true,
    }),
    0.4,
  );
});

void test("calculateConfidence 对未知类型和非法重复命中走安全兜底", () => {
  assert.equal(
    calculateConfidence({
      feedbackType: "unknown",
      repeatedHits: -3,
    }),
    0.3,
  );
});
