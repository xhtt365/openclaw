import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyHealthRecord, deriveHealthSummary, trimHealthRecord } from "./health";

void test("deriveHealthSummary 会对离线 session 直接给出异常分数", () => {
  const now = 1_742_350_000_000;
  const record = createEmptyHealthRecord();
  record.hasKnownSession = true;
  record.usageSnapshots = [
    {
      id: "usage-1",
      sessionKey: "agent:designer:main",
      capturedAt: now,
      source: "probe",
      sessionAlive: false,
      contextWindowSize: 128_000,
      currentContextUsed: 18_000,
    },
  ];

  const summary = deriveHealthSummary(record, now);

  assert.equal(summary.score, 0);
  assert.equal(summary.level, "critical");
  assert.equal(summary.sessionState, "dead");
  assert.equal(summary.issues[0]?.code, "session-down");
});

void test("deriveHealthSummary 会综合延迟、fallback、错误和 token 压力扣分", () => {
  const now = 1_742_350_000_000;
  const record = createEmptyHealthRecord();
  record.hasKnownSession = true;
  record.lastKnownModel = "openai/gpt-5.4";
  record.fallbackActive = true;
  record.fallbackModel = "openai/gpt-5.4-mini";
  record.fallbackReason = "主模型连续超时";
  record.fallbackUpdatedAt = now - 1_000;
  record.uptimeStartedAt = now - 30 * 60 * 1000;
  record.interactions = [
    {
      id: "interaction-1",
      kind: "chat.send",
      requestId: "request-1",
      sessionKey: "agent:designer:main",
      startedAt: now - 50_000,
      firstTokenAt: now - 44_000,
      completedAt: now - 42_000,
      latencyMs: 6_000,
      success: true,
      model: "openai/gpt-5.4",
      usedFallback: true,
    },
    {
      id: "interaction-2",
      kind: "chat.send",
      requestId: "request-2",
      sessionKey: "agent:designer:main",
      startedAt: now - 12_000,
      completedAt: now - 10_000,
      success: false,
      errorType: "timeout",
      errorMessage: "timeout",
    },
  ];
  record.usageSnapshots = [
    {
      id: "usage-2",
      sessionKey: "agent:designer:main",
      capturedAt: now - 1_000,
      source: "history",
      sessionAlive: true,
      contextWindowSize: 100_000,
      currentContextUsed: 92_000,
    },
  ];

  const summary = deriveHealthSummary(record, now);

  assert.equal(summary.level, "critical");
  assert.equal(summary.fallbackActive, true);
  assert.equal(summary.currentModel, "openai/gpt-5.4-mini");
  assert.equal(summary.recentErrorCount, 1);
  assert.equal(summary.usageRatio !== null && summary.usageRatio >= 0.9, true);
  assert.equal(
    summary.issues.some((issue) => issue.code === "token-pressure"),
    true,
  );
  assert.equal(
    summary.issues.some((issue) => issue.code === "fallback-active"),
    true,
  );
});

void test("trimHealthRecord 会清理 24 小时之外的历史记录", () => {
  const now = 1_742_350_000_000;
  const oldTimestamp = now - 25 * 60 * 60 * 1000;
  const record = createEmptyHealthRecord();
  record.interactions = [
    {
      id: "old-interaction",
      kind: "agent",
      requestId: "old-request",
      sessionKey: "agent:designer:main",
      startedAt: oldTimestamp,
      completedAt: oldTimestamp,
      success: false,
      errorType: "unknown",
      errorMessage: "old error",
    },
  ];
  record.usageSnapshots = [
    {
      id: "old-usage",
      sessionKey: "agent:designer:main",
      capturedAt: oldTimestamp,
      source: "probe",
      sessionAlive: true,
      contextWindowSize: 50_000,
      currentContextUsed: 12_000,
    },
  ];

  const trimmed = trimHealthRecord(record, now);

  assert.equal(trimmed.interactions.length, 0);
  assert.equal(trimmed.usageSnapshots.length, 0);
});
