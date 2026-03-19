import type { HealthInteraction } from "@/utils/health";

export const STATS_RETENTION_DAYS = 30;
export const STATS_RETENTION_MS = STATS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type StatsTimeRangeKey = "today" | "yesterday" | "week" | "month";

export type HourlyStats = {
  id: string;
  agentId: string;
  date: string;
  hour: number;
  bucketStartAt: number;
  messageCount: number;
  turnCount: number;
  tokenInput: number;
  tokenOutput: number;
  tokenCacheRead: number;
  tokenCacheWrite: number;
  tokenTotal: number;
  totalResponseMs: number;
  responseSampleCount: number;
  avgResponseMs: number;
  errorCount: number;
  fallbackCount: number;
  modelUsed: string | null;
  modelCounts: Record<string, number>;
  updatedAt: number;
};

export type StatsTimeWindow = {
  key: StatsTimeRangeKey;
  startAt: number;
  endAt: number;
  previousStartAt: number;
  previousEndAt: number;
};

export type AggregatedStatsSummary = {
  messageCount: number;
  turnCount: number;
  tokenInput: number;
  tokenOutput: number;
  tokenCacheRead: number;
  tokenCacheWrite: number;
  tokenTotal: number;
  totalResponseMs: number;
  responseSampleCount: number;
  avgResponseMs: number | null;
  errorCount: number;
  fallbackCount: number;
  modelUsed: string | null;
  modelCounts: Record<string, number>;
  activeHours: number[];
  activeHourLabels: string[];
};

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

function startOfDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfWeek(timestamp: number) {
  const date = new Date(timestamp);
  const day = date.getDay();
  const offset = day === 0 ? 6 : day - 1;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - offset);
  return date.getTime();
}

function startOfMonth(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  date.setDate(1);
  return date.getTime();
}

function resolveTopModel(modelCounts: Record<string, number>) {
  let bestModel: string | null = null;
  let bestCount = -1;

  for (const [model, count] of Object.entries(modelCounts)) {
    if (count > bestCount) {
      bestModel = model;
      bestCount = count;
      continue;
    }

    if (count === bestCount && bestModel !== null && model < bestModel) {
      bestModel = model;
    }
  }

  return bestModel;
}

function mergeModelCounts(
  current: Record<string, number>,
  model: string | null | undefined,
  increment = 1,
) {
  const next = { ...current };
  const normalizedModel = typeof model === "string" && model.trim() ? model.trim() : null;
  if (!normalizedModel) {
    return next;
  }

  next[normalizedModel] = (next[normalizedModel] ?? 0) + increment;
  return next;
}

export function createHourlyStatsKey(agentId: string, date: string, hour: number) {
  return `${agentId}:${date}:${hour}`;
}

export function resolveHourlyBucket(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours();

  return {
    date: `${year}-${pad2(month)}-${pad2(day)}`,
    hour,
    bucketStartAt: new Date(year, month - 1, day, hour, 0, 0, 0).getTime(),
  };
}

export function createEmptyHourlyStats(params: {
  agentId: string;
  date: string;
  hour: number;
  bucketStartAt: number;
}) {
  return {
    id: createHourlyStatsKey(params.agentId, params.date, params.hour),
    agentId: params.agentId,
    date: params.date,
    hour: params.hour,
    bucketStartAt: params.bucketStartAt,
    messageCount: 0,
    turnCount: 0,
    tokenInput: 0,
    tokenOutput: 0,
    tokenCacheRead: 0,
    tokenCacheWrite: 0,
    tokenTotal: 0,
    totalResponseMs: 0,
    responseSampleCount: 0,
    avgResponseMs: 0,
    errorCount: 0,
    fallbackCount: 0,
    modelUsed: null,
    modelCounts: {},
    updatedAt: params.bucketStartAt,
  } satisfies HourlyStats;
}

export function applyInteractionToHourlyStats(
  current: HourlyStats | undefined,
  agentId: string,
  interaction: HealthInteraction,
) {
  const bucket = resolveHourlyBucket(interaction.completedAt);
  const base =
    current ??
    createEmptyHourlyStats({
      agentId,
      date: bucket.date,
      hour: bucket.hour,
      bucketStartAt: bucket.bucketStartAt,
    });

  const nextMessageCount = base.messageCount + (interaction.success ? 1 : 0);
  const nextTurnCount = base.turnCount + 1;
  const nextTokenInput = base.tokenInput + (interaction.tokenInput ?? 0);
  const nextTokenOutput = base.tokenOutput + (interaction.tokenOutput ?? 0);
  const nextTokenCacheRead = base.tokenCacheRead + (interaction.tokenCacheRead ?? 0);
  const nextTokenCacheWrite = base.tokenCacheWrite + (interaction.tokenCacheWrite ?? 0);
  const nextTokenTotal = base.tokenTotal + (interaction.tokenTotal ?? 0);
  const hasLatencySample =
    interaction.success && typeof interaction.latencyMs === "number" && interaction.latencyMs >= 0;
  const nextTotalResponseMs =
    base.totalResponseMs + (hasLatencySample ? Math.max(0, interaction.latencyMs ?? 0) : 0);
  const nextResponseSampleCount = base.responseSampleCount + (hasLatencySample ? 1 : 0);
  const nextModelCounts = mergeModelCounts(base.modelCounts, interaction.model);

  return {
    ...base,
    messageCount: nextMessageCount,
    turnCount: nextTurnCount,
    tokenInput: nextTokenInput,
    tokenOutput: nextTokenOutput,
    tokenCacheRead: nextTokenCacheRead,
    tokenCacheWrite: nextTokenCacheWrite,
    tokenTotal: nextTokenTotal,
    totalResponseMs: nextTotalResponseMs,
    responseSampleCount: nextResponseSampleCount,
    avgResponseMs: nextResponseSampleCount > 0 ? nextTotalResponseMs / nextResponseSampleCount : 0,
    errorCount: base.errorCount + (interaction.success ? 0 : 1),
    fallbackCount: base.fallbackCount + (interaction.usedFallback ? 1 : 0),
    modelUsed: resolveTopModel(nextModelCounts),
    modelCounts: nextModelCounts,
    updatedAt: Math.max(base.updatedAt, interaction.completedAt),
  } satisfies HourlyStats;
}

export function pruneHourlyStatsByKey(
  hourlyStatsByKey: Record<string, HourlyStats>,
  now = Date.now(),
) {
  const cutoff = now - STATS_RETENTION_MS;
  return Object.fromEntries(
    Object.entries(hourlyStatsByKey).filter(([, item]) => item.bucketStartAt >= cutoff),
  );
}

export function getHourlyStatsEntries(hourlyStatsByKey: Record<string, HourlyStats>) {
  return Object.values(hourlyStatsByKey).toSorted(
    (left, right) => right.bucketStartAt - left.bucketStartAt,
  );
}

export function resolveStatsTimeWindow(
  range: StatsTimeRangeKey,
  now = Date.now(),
): StatsTimeWindow {
  if (range === "yesterday") {
    const endAt = startOfDay(now);
    const startAt = endAt - DAY_MS;
    return {
      key: range,
      startAt,
      endAt,
      previousStartAt: startAt - DAY_MS,
      previousEndAt: startAt,
    };
  }

  const startAt =
    range === "today" ? startOfDay(now) : range === "week" ? startOfWeek(now) : startOfMonth(now);
  const endAt = now;
  const duration = Math.max(DAY_MS, endAt - startAt);

  return {
    key: range,
    startAt,
    endAt,
    previousStartAt: startAt - duration,
    previousEndAt: startAt,
  };
}

export function getStatsEntriesForWindow(
  hourlyStatsByKey: Record<string, HourlyStats>,
  window: Pick<StatsTimeWindow, "startAt" | "endAt">,
  agentId?: string | null,
) {
  return getHourlyStatsEntries(hourlyStatsByKey).filter((item) => {
    if (agentId && item.agentId !== agentId) {
      return false;
    }

    return item.bucketStartAt >= window.startAt && item.bucketStartAt < window.endAt;
  });
}

export function aggregateHourlyStats(entries: HourlyStats[]): AggregatedStatsSummary {
  const activeHours = Array.from({ length: 24 }, () => 0);
  const activeHourSet = new Set<number>();
  let messageCount = 0;
  let turnCount = 0;
  let tokenInput = 0;
  let tokenOutput = 0;
  let tokenCacheRead = 0;
  let tokenCacheWrite = 0;
  let tokenTotal = 0;
  let totalResponseMs = 0;
  let responseSampleCount = 0;
  let errorCount = 0;
  let fallbackCount = 0;
  let modelCounts: Record<string, number> = {};

  for (const item of entries) {
    messageCount += item.messageCount;
    turnCount += item.turnCount;
    tokenInput += item.tokenInput;
    tokenOutput += item.tokenOutput;
    tokenCacheRead += item.tokenCacheRead;
    tokenCacheWrite += item.tokenCacheWrite;
    tokenTotal += item.tokenTotal;
    totalResponseMs += item.totalResponseMs;
    responseSampleCount += item.responseSampleCount;
    errorCount += item.errorCount;
    fallbackCount += item.fallbackCount;
    activeHours[item.hour] += item.messageCount;
    if (item.turnCount > 0) {
      activeHourSet.add(item.hour);
    }

    for (const [model, count] of Object.entries(item.modelCounts)) {
      modelCounts = mergeModelCounts(modelCounts, model, count);
    }
  }

  const activeHourLabels = [...activeHourSet]
    .toSorted((left, right) => left - right)
    .map(formatHourLabel);

  return {
    messageCount,
    turnCount,
    tokenInput,
    tokenOutput,
    tokenCacheRead,
    tokenCacheWrite,
    tokenTotal,
    totalResponseMs,
    responseSampleCount,
    avgResponseMs: responseSampleCount > 0 ? totalResponseMs / responseSampleCount : null,
    errorCount,
    fallbackCount,
    modelUsed: resolveTopModel(modelCounts),
    modelCounts,
    activeHours,
    activeHourLabels,
  };
}

export function resolvePercentChange(current: number, previous: number) {
  if (previous <= 0) {
    return current > 0 ? null : 0;
  }

  return ((current - previous) / previous) * 100;
}

export function formatPercentChange(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(Math.abs(value) >= 10 ? 0 : 1)}%`;
}

export function formatTokenCount(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "—";
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return `${Math.round(value)}`;
}

export function formatLatencyMs(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "—";
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}s`;
  }

  return `${Math.round(value)}ms`;
}

export function formatHourLabel(hour: number) {
  return `${pad2(hour)}:00-${pad2(hour)}:59`;
}
