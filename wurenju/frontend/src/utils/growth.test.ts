import assert from "node:assert/strict";
import test from "node:test";
import type { Agent } from "@/types/agent";
import { buildLeaderboard, compareMetricSnapshots, createWeeklyWindow } from "@/utils/growth";
import { createEmptyHealthRecord } from "@/utils/health";
import { createHourlyStatsKey, type HourlyStats } from "@/utils/stats";

function createStatsEntry(
  params: Partial<HourlyStats> &
    Pick<HourlyStats, "agentId" | "bucketStartAt" | "date" | "hour" | "id">,
): HourlyStats {
  return {
    id: params.id,
    agentId: params.agentId,
    date: params.date,
    hour: params.hour,
    bucketStartAt: params.bucketStartAt,
    messageCount: params.messageCount ?? 0,
    turnCount: params.turnCount ?? 0,
    tokenInput: params.tokenInput ?? 0,
    tokenOutput: params.tokenOutput ?? 0,
    tokenCacheRead: params.tokenCacheRead ?? 0,
    tokenCacheWrite: params.tokenCacheWrite ?? 0,
    tokenTotal: params.tokenTotal ?? 0,
    totalResponseMs: params.totalResponseMs ?? 0,
    responseSampleCount: params.responseSampleCount ?? 0,
    avgResponseMs: params.avgResponseMs ?? 0,
    errorCount: params.errorCount ?? 0,
    fallbackCount: params.fallbackCount ?? 0,
    modelUsed: params.modelUsed ?? null,
    modelCounts: params.modelCounts ?? {},
    updatedAt: params.updatedAt ?? params.bucketStartAt,
  };
}

void test("compareMetricSnapshots 能识别明显改善与恶化", () => {
  const before = {
    agentId: "alpha",
    label: "before",
    startAt: 0,
    endAt: 1,
    sampleDays: 7,
    messageCount: 80,
    turnCount: 80,
    avgResponseMs: 2600,
    errorCount: 8,
    errorRate: 0.1,
    errorTypes: { timeout: 8 },
    tokenTotal: 12_000,
    tokenEfficiency: 6.6,
    tokenPerMessage: 150,
    healthScore: 70,
    healthLevel: "warning" as const,
    modelUsed: "openai/gpt-5.4",
    mainModel: "openai/gpt-5.4",
    backupModel: null,
    fallbackCount: 1,
    modelCounts: { "openai/gpt-5.4": 80 },
  };

  const improved = compareMetricSnapshots(before, {
    ...before,
    label: "after",
    avgResponseMs: 1400,
    errorCount: 3,
    errorRate: 0.0375,
    tokenEfficiency: 8.2,
    healthScore: 82,
  });
  const degraded = compareMetricSnapshots(before, {
    ...before,
    label: "after",
    avgResponseMs: 3800,
    errorCount: 13,
    errorRate: 0.1625,
    tokenEfficiency: 5.1,
    healthScore: 58,
  });

  assert.equal(improved.status, "improved");
  assert.equal(improved.scoreDelta > 0, true);
  assert.equal(degraded.status, "degraded");
  assert.equal(degraded.scoreDelta < 0, true);
});

void test("buildLeaderboard 会按综合分输出排名和成长标记", () => {
  const window = createWeeklyWindow();
  const agents: Agent[] = [
    { id: "alpha", name: "Alpha", emoji: "🦞" },
    { id: "beta", name: "Beta", emoji: "🤖" },
  ];
  const hourlyStatsByKey: Record<string, HourlyStats> = {
    [createHourlyStatsKey("alpha", "2026-03-19", 9)]: createStatsEntry({
      id: createHourlyStatsKey("alpha", "2026-03-19", 9),
      agentId: "alpha",
      date: "2026-03-19",
      hour: 9,
      bucketStartAt: window.startAt + 9 * 60 * 60 * 1000,
      messageCount: 32,
      turnCount: 34,
      tokenTotal: 4200,
      totalResponseMs: 24_000,
      responseSampleCount: 32,
      avgResponseMs: 750,
      modelUsed: "openai/gpt-5.4",
      modelCounts: { "openai/gpt-5.4": 32 },
    }),
    [createHourlyStatsKey("beta", "2026-03-19", 9)]: createStatsEntry({
      id: createHourlyStatsKey("beta", "2026-03-19", 9),
      agentId: "beta",
      date: "2026-03-19",
      hour: 9,
      bucketStartAt: window.startAt + 9 * 60 * 60 * 1000,
      messageCount: 20,
      turnCount: 28,
      tokenTotal: 5200,
      totalResponseMs: 56_000,
      responseSampleCount: 20,
      avgResponseMs: 2800,
      errorCount: 4,
      modelUsed: "openai/gpt-5.4",
      modelCounts: { "openai/gpt-5.4": 20 },
    }),
  };

  const alphaHealth = createEmptyHealthRecord();
  alphaHealth.summary = { ...alphaHealth.summary, score: 92, level: "healthy" };
  const betaHealth = createEmptyHealthRecord();
  betaHealth.summary = { ...betaHealth.summary, score: 66, level: "warning" };

  const entries = buildLeaderboard({
    agents,
    hourlyStatsByKey,
    healthRecordsByAgentId: {
      alpha: alphaHealth,
      beta: betaHealth,
    },
    previousSnapshotsByAgentId: {
      alpha: {
        metrics: {
          agentId: "alpha",
          label: "prev",
          startAt: 0,
          endAt: 1,
          sampleDays: 7,
          messageCount: 20,
          turnCount: 22,
          avgResponseMs: 1600,
          errorCount: 2,
          errorRate: 0.09,
          errorTypes: {},
          tokenTotal: 4000,
          tokenEfficiency: 5,
          tokenPerMessage: 200,
          healthScore: 78,
          healthLevel: "healthy",
          modelUsed: "openai/gpt-5.4",
          mainModel: "openai/gpt-5.4",
          backupModel: null,
          fallbackCount: 0,
          modelCounts: { "openai/gpt-5.4": 20 },
        },
        score: 72,
      },
      beta: null,
    },
    startAt: window.startAt,
    endAt: window.endAt,
    label: "本周",
  });

  assert.equal(entries[0]?.agentId, "alpha");
  assert.equal(entries[0]?.rank, 1);
  assert.equal(entries[0]?.fastestImprover, true);
  assert.equal(entries[1]?.agentId, "beta");
  assert.equal(entries[1]?.rank, 2);
});
