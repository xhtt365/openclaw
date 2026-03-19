export const HEALTH_RETENTION_MS = 24 * 60 * 60 * 1000;

export type HealthLevel = "healthy" | "warning" | "critical";
export type HealthSessionState = "alive" | "dead" | "unknown";
export type HealthErrorType =
  | "timeout"
  | "model_unavailable"
  | "context_overflow"
  | "network"
  | "unauthorized"
  | "unknown";
export type HealthRequestKind = "chat.send" | "agent";
export type HealthUsageSource = "history" | "probe";
export type HealthAlertSeverity = "recovery" | "warning" | "critical";

export type HealthInteraction = {
  id: string;
  kind: HealthRequestKind;
  requestId: string;
  runId?: string | null;
  sessionKey: string;
  startedAt: number;
  firstTokenAt?: number | null;
  completedAt: number;
  latencyMs?: number | null;
  success: boolean;
  model?: string | null;
  provider?: string | null;
  usedFallback?: boolean;
  errorType?: HealthErrorType;
  errorMessage?: string;
};

export type HealthUsageSnapshot = {
  id: string;
  sessionKey: string;
  capturedAt: number;
  source: HealthUsageSource;
  sessionAlive: boolean | null;
  contextWindowSize: number | null;
  currentContextUsed: number | null;
};

export type HealthFallbackEvent = {
  id: string;
  sessionKey: string;
  occurredAt: number;
  active: boolean;
  selectedModel: string;
  activeModel: string;
  previousModel?: string | null;
  reason?: string | null;
  attempts: string[];
};

export type HealthAlert = {
  id: string;
  agentId: string;
  severity: HealthAlertSeverity;
  code: "fallback" | "session" | "tokens" | "errors";
  timestamp: number;
  message: string;
  detail?: string;
};

export type AgentHealthAlertFlags = {
  fallbackActive: boolean;
  sessionDown: boolean;
  tokenPressure: boolean;
  errorStorm: boolean;
};

export type AgentHealthIssue = {
  code: string;
  label: string;
  detail: string;
};

export type AgentHealthSummary = {
  score: number;
  level: HealthLevel;
  sessionState: HealthSessionState;
  currentModel: string | null;
  avgLatencyMs: number | null;
  lastLatencyMs: number | null;
  usageRatio: number | null;
  contextWindowSize: number | null;
  currentContextUsed: number | null;
  recentErrorCount: number;
  errorCount24h: number;
  fallbackActive: boolean;
  fallbackModel: string | null;
  fallbackReason: string | null;
  lastErrorType: HealthErrorType | null;
  lastErrorMessage: string | null;
  lastUpdatedAt: number | null;
  consecutiveAvailableMs: number | null;
  hasRecentData: boolean;
  issues: AgentHealthIssue[];
};

export type AgentHealthRecord = {
  interactions: HealthInteraction[];
  usageSnapshots: HealthUsageSnapshot[];
  fallbackEvents: HealthFallbackEvent[];
  alerts: HealthAlert[];
  lastKnownModel: string | null;
  fallbackActive: boolean;
  fallbackModel: string | null;
  fallbackReason: string | null;
  fallbackUpdatedAt: number | null;
  uptimeStartedAt: number | null;
  hasKnownSession: boolean;
  alertFlags: AgentHealthAlertFlags;
  summary: AgentHealthSummary;
};

export const EMPTY_HEALTH_SUMMARY: AgentHealthSummary = {
  score: 88,
  level: "healthy",
  sessionState: "unknown",
  currentModel: null,
  avgLatencyMs: null,
  lastLatencyMs: null,
  usageRatio: null,
  contextWindowSize: null,
  currentContextUsed: null,
  recentErrorCount: 0,
  errorCount24h: 0,
  fallbackActive: false,
  fallbackModel: null,
  fallbackReason: null,
  lastErrorType: null,
  lastErrorMessage: null,
  lastUpdatedAt: null,
  consecutiveAvailableMs: null,
  hasRecentData: false,
  issues: [
    {
      code: "no-data",
      label: "观察中",
      detail: "最近 24 小时还没有足够的交互样本。",
    },
  ],
};

export function createEmptyHealthRecord(): AgentHealthRecord {
  return {
    interactions: [],
    usageSnapshots: [],
    fallbackEvents: [],
    alerts: [],
    lastKnownModel: null,
    fallbackActive: false,
    fallbackModel: null,
    fallbackReason: null,
    fallbackUpdatedAt: null,
    uptimeStartedAt: null,
    hasKnownSession: false,
    alertFlags: {
      fallbackActive: false,
      sessionDown: false,
      tokenPressure: false,
      errorStorm: false,
    },
    summary: EMPTY_HEALTH_SUMMARY,
  };
}

export function trimHealthRecord(record: AgentHealthRecord, now = Date.now()): AgentHealthRecord {
  const cutoff = now - HEALTH_RETENTION_MS;
  return {
    ...record,
    interactions: record.interactions.filter((item) => item.completedAt >= cutoff).slice(-60),
    usageSnapshots: record.usageSnapshots.filter((item) => item.capturedAt >= cutoff).slice(-60),
    fallbackEvents: record.fallbackEvents.filter((item) => item.occurredAt >= cutoff).slice(-20),
    alerts: record.alerts.filter((item) => item.timestamp >= cutoff).slice(-20),
  };
}

export function classifyHealthError(message: string): {
  type: HealthErrorType;
  label: string;
} {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return { type: "unknown", label: "未知错误" };
  }

  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return { type: "timeout", label: "超时" };
  }

  if (
    normalized.includes("context window") ||
    normalized.includes("context length") ||
    normalized.includes("too many tokens") ||
    normalized.includes("maximum context") ||
    normalized.includes("上下文")
  ) {
    return { type: "context_overflow", label: "上下文溢出" };
  }

  if (
    normalized.includes("model") &&
    (normalized.includes("unavailable") ||
      normalized.includes("not found") ||
      normalized.includes("not available"))
  ) {
    return { type: "model_unavailable", label: "模型不可用" };
  }

  if (
    normalized.includes("401") ||
    normalized.includes("unauthorized") ||
    normalized.includes("api key")
  ) {
    return { type: "unauthorized", label: "鉴权失败" };
  }

  if (
    normalized.includes("gateway") ||
    normalized.includes("network") ||
    normalized.includes("econn") ||
    normalized.includes("socket") ||
    normalized.includes("disconnect") ||
    normalized.includes("502") ||
    normalized.includes("503")
  ) {
    return { type: "network", label: "网络异常" };
  }

  return { type: "unknown", label: "未知错误" };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function countTrailingErrors(interactions: HealthInteraction[]) {
  let total = 0;
  for (let index = interactions.length - 1; index >= 0; index -= 1) {
    if (interactions[index]?.success) {
      break;
    }
    total += 1;
  }
  return total;
}

function resolveLatencyPenalty(latencyMs: number | null) {
  if (latencyMs === null) {
    return 0;
  }

  if (latencyMs >= 15_000) {
    return 30;
  }
  if (latencyMs >= 8_000) {
    return 22;
  }
  if (latencyMs >= 4_000) {
    return 14;
  }
  if (latencyMs >= 2_000) {
    return 8;
  }
  if (latencyMs >= 1_000) {
    return 4;
  }
  return 0;
}

function resolveUsagePenalty(usageRatio: number | null) {
  if (usageRatio === null) {
    return 0;
  }

  if (usageRatio >= 0.95) {
    return 24;
  }
  if (usageRatio >= 0.85) {
    return 16;
  }
  if (usageRatio >= 0.75) {
    return 10;
  }
  if (usageRatio >= 0.6) {
    return 4;
  }
  return 0;
}

function resolveErrorPenalty(errorRate: number, trailingErrors: number) {
  const ratePenalty = clamp(Math.round(errorRate * 36), 0, 36);
  const streakPenalty = trailingErrors >= 3 ? 10 : trailingErrors >= 2 ? 6 : 0;
  return clamp(ratePenalty + streakPenalty, 0, 42);
}

export function deriveHealthSummary(
  record: AgentHealthRecord,
  now = Date.now(),
): AgentHealthSummary {
  const interactions = record.interactions;
  const recentInteractions = interactions.slice(-8);
  const latestInteraction = interactions.at(-1) ?? null;
  const latestSuccess = [...interactions].toReversed().find((item) => item.success) ?? null;
  const latestUsage = record.usageSnapshots.at(-1) ?? null;
  const lastError = [...interactions].toReversed().find((item) => !item.success) ?? null;
  const latencySamples = interactions
    .filter((item) => item.success && typeof item.latencyMs === "number")
    .slice(-5)
    .map((item) => item.latencyMs ?? 0);
  const avgLatencyMs = average(latencySamples);
  const recentErrorCount = recentInteractions.filter((item) => !item.success).length;
  const errorCount24h = interactions.filter((item) => !item.success).length;
  const trailingErrors = countTrailingErrors(recentInteractions);
  const usageRatio =
    latestUsage &&
    typeof latestUsage.contextWindowSize === "number" &&
    latestUsage.contextWindowSize > 0 &&
    typeof latestUsage.currentContextUsed === "number"
      ? clamp(latestUsage.currentContextUsed / latestUsage.contextWindowSize, 0, 1.6)
      : null;

  const sessionState: HealthSessionState =
    latestUsage?.sessionAlive === false
      ? "dead"
      : latestUsage?.sessionAlive === true
        ? "alive"
        : record.hasKnownSession
          ? "alive"
          : "unknown";

  const issues: AgentHealthIssue[] = [];
  const hasRecentData =
    interactions.length > 0 || record.usageSnapshots.length > 0 || record.fallbackEvents.length > 0;

  if (!hasRecentData) {
    return {
      ...EMPTY_HEALTH_SUMMARY,
      currentModel: record.lastKnownModel,
      fallbackActive: record.fallbackActive,
      fallbackModel: record.fallbackModel,
      fallbackReason: record.fallbackReason,
    };
  }

  if (sessionState === "dead" && record.hasKnownSession) {
    issues.push({
      code: "session-down",
      label: "会话离线",
      detail: "最近一次办公室探测未找到该员工 session。",
    });
  }

  if (record.fallbackActive) {
    issues.push({
      code: "fallback-active",
      label: "备用模型运行中",
      detail: record.fallbackReason?.trim() || "主模型异常，当前已切到备用模型。",
    });
  }

  if (usageRatio !== null && usageRatio >= 0.85) {
    issues.push({
      code: "token-pressure",
      label: "上下文压力偏高",
      detail: `当前上下文占用约 ${(usageRatio * 100).toFixed(0)}%，建议尽快压缩。`,
    });
  }

  if (avgLatencyMs !== null && avgLatencyMs >= 4_000) {
    issues.push({
      code: "latency-high",
      label: "响应偏慢",
      detail: `最近平均首包延迟约 ${(avgLatencyMs / 1000).toFixed(1)}s。`,
    });
  }

  if (recentErrorCount > 0 && lastError) {
    const label = classifyHealthError(lastError.errorMessage ?? "").label;
    issues.push({
      code: "recent-errors",
      label: "近期有失败",
      detail: `最近 8 次交互里有 ${recentErrorCount} 次失败，最新为${label}。`,
    });
  }

  let score = 100;
  if (sessionState === "dead" && record.hasKnownSession) {
    score = 0;
  } else {
    const errorRate =
      recentInteractions.length > 0 ? recentErrorCount / recentInteractions.length : 0;
    score -= resolveLatencyPenalty(avgLatencyMs);
    score -= resolveUsagePenalty(usageRatio);
    score -= resolveErrorPenalty(errorRate, trailingErrors);
    if (record.fallbackActive) {
      score -= 12;
    }
    if (lastError && now - lastError.completedAt < 10 * 60 * 1000) {
      score -= 6;
    }
  }

  score = clamp(Math.round(score), 0, 100);

  const level: HealthLevel = score >= 80 ? "healthy" : score >= 55 ? "warning" : "critical";
  const lastUpdatedAt = Math.max(
    latestInteraction?.completedAt ?? 0,
    latestUsage?.capturedAt ?? 0,
    record.fallbackUpdatedAt ?? 0,
  );

  return {
    score,
    level,
    sessionState,
    currentModel: record.fallbackModel ?? latestSuccess?.model ?? record.lastKnownModel,
    avgLatencyMs,
    lastLatencyMs: latestSuccess?.latencyMs ?? null,
    usageRatio,
    contextWindowSize: latestUsage?.contextWindowSize ?? null,
    currentContextUsed: latestUsage?.currentContextUsed ?? null,
    recentErrorCount,
    errorCount24h,
    fallbackActive: record.fallbackActive,
    fallbackModel: record.fallbackModel,
    fallbackReason: record.fallbackReason,
    lastErrorType: lastError?.errorType ?? null,
    lastErrorMessage: lastError?.errorMessage ?? null,
    lastUpdatedAt: lastUpdatedAt > 0 ? lastUpdatedAt : null,
    consecutiveAvailableMs:
      record.uptimeStartedAt !== null ? Math.max(0, now - record.uptimeStartedAt) : null,
    hasRecentData,
    issues:
      issues.length > 0
        ? issues
        : [
            {
              code: "healthy",
              label: "运行稳定",
              detail: "最近样本稳定，没有发现明显异常。",
            },
          ],
  };
}
