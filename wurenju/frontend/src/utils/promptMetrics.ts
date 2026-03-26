import type { MetricSnapshot } from "@/types/promptVersion";

const DAY_MS = 24 * 60 * 60 * 1000;

export function collectRollingMetricSnapshot(params: {
  agentId: string;
  endAt?: number;
  durationDays?: number;
  label: string;
}) {
  const endAt = params.endAt ?? Date.now();
  const durationDays = Math.max(1, params.durationDays ?? 7);
  const startAt = endAt - durationDays * DAY_MS;

  return {
    agentId: params.agentId,
    label: params.label,
    startAt,
    endAt,
    sampleDays: durationDays,
    messageCount: 0,
    turnCount: 0,
    avgResponseMs: null,
    errorCount: 0,
    errorRate: 0,
    errorTypes: {},
    tokenTotal: 0,
    tokenEfficiency: null,
    tokenPerMessage: null,
    healthScore: 0,
    healthLevel: "offline",
    modelUsed: null,
    mainModel: null,
    backupModel: null,
    fallbackCount: 0,
    modelCounts: {},
  } satisfies MetricSnapshot;
}
