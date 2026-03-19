import type { Agent } from "@/types/agent";
import type {
  AchievementDefinition,
  GrowthLevel,
  GrowthRecordKind,
  MetricSnapshot,
  RankingEntry,
  RankingMetricBreakdown,
} from "@/types/growth";
import type { AgentHealthRecord, HealthErrorType } from "@/utils/health";
import type { ChatMessage } from "@/utils/messageAdapter";
import { getHourlyStatsEntries, aggregateHourlyStats } from "@/utils/stats";

const DAY_MS = 24 * 60 * 60 * 1000;
const GROWTH_SECTION_HEADER = "## 成长指令";
const GROWTH_SECTION_START = "<!-- xiaban-growth:start -->";
const GROWTH_SECTION_END = "<!-- xiaban-growth:end -->";

type ComparisonSummary = {
  status: "improved" | "degraded" | "neutral";
  scoreDelta: number;
  summary: string;
  errorRateChangePct: number | null;
  latencyChangePct: number | null;
  tokenEfficiencyChangePct: number | null;
  healthScoreDelta: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function safeDivide(numerator: number, denominator: number) {
  if (!Number.isFinite(denominator) || denominator === 0) {
    return null;
  }

  return numerator / denominator;
}

function formatPercent(value: number | null, digits = 0) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  const prefix = value > 0 ? "+" : "";
  return `${prefix}${(value * 100).toFixed(digits)}%`;
}

function formatRatioPercent(value: number) {
  return `${(value * 100).toFixed(value >= 0.1 ? 0 : 1)}%`;
}

function formatLatency(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}s`;
  }

  return `${Math.round(value)}ms`;
}

function formatTokenValue(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return "0";
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return `${Math.round(value)}`;
}

function pickTopModel(modelCounts: Record<string, number>) {
  return (
    Object.entries(modelCounts)
      .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))
      .at(0)?.[0] ?? null
  );
}

function countErrorTypes(
  record: AgentHealthRecord | undefined,
  startAt: number,
  endAt: number,
): Partial<Record<HealthErrorType, number>> {
  if (!record) {
    return {};
  }

  const next: Partial<Record<HealthErrorType, number>> = {};
  for (const interaction of record.interactions) {
    if (
      interaction.success ||
      interaction.completedAt < startAt ||
      interaction.completedAt > endAt
    ) {
      continue;
    }

    const key = interaction.errorType ?? "unknown";
    next[key] = (next[key] ?? 0) + 1;
  }

  return next;
}

function resolveBackupModel(record: AgentHealthRecord | undefined, startAt: number, endAt: number) {
  if (!record) {
    return null;
  }

  const fallbackEvent = [...record.fallbackEvents]
    .toReversed()
    .find((item) => item.occurredAt >= startAt && item.occurredAt <= endAt);

  return fallbackEvent?.activeModel ?? fallbackEvent?.selectedModel ?? record.fallbackModel ?? null;
}

function resolveWeekStart(timestamp: number) {
  const date = new Date(timestamp);
  const day = date.getDay();
  const offset = day === 0 ? 6 : day - 1;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - offset);
  return date.getTime();
}

function resolveIsoWeekNumber(timestamp: number) {
  const date = new Date(timestamp);
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil(((target.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return {
    year: target.getUTCFullYear(),
    week: weekNumber,
  };
}

export function createWeekKey(timestamp: number) {
  const { year, week } = resolveIsoWeekNumber(timestamp);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function createWeekLabel(timestamp: number) {
  const startAt = resolveWeekStart(timestamp);
  const endAt = startAt + 6 * DAY_MS;
  const startDate = new Date(startAt);
  const endDate = new Date(endAt);
  return `${startDate.getMonth() + 1}/${startDate.getDate()}-${endDate.getMonth() + 1}/${endDate.getDate()}`;
}

export function createWeeklyWindow(now = Date.now()) {
  const startAt = resolveWeekStart(now);
  return {
    startAt,
    endAt: startAt + 7 * DAY_MS,
    previousStartAt: startAt - 7 * DAY_MS,
    previousEndAt: startAt,
    weekKey: createWeekKey(now),
    weekLabel: createWeekLabel(now),
  };
}

export function collectMetricSnapshot(params: {
  agentId: string;
  hourlyStatsByKey: Record<string, ReturnType<typeof getHourlyStatsEntries>[number]>;
  healthRecord?: AgentHealthRecord;
  startAt: number;
  endAt: number;
  label: string;
  fallbackHealthScore?: number | null;
}) {
  const entries = getHourlyStatsEntries(params.hourlyStatsByKey).filter(
    (item) =>
      item.agentId === params.agentId &&
      item.bucketStartAt >= params.startAt &&
      item.bucketStartAt < params.endAt,
  );
  const summary = aggregateHourlyStats(entries);
  const errorTypes = countErrorTypes(params.healthRecord, params.startAt, params.endAt);
  const tokenEfficiency =
    summary.tokenTotal > 0 ? (summary.messageCount / summary.tokenTotal) * 1000 : null;
  const tokenPerMessage =
    summary.messageCount > 0 ? summary.tokenTotal / Math.max(summary.messageCount, 1) : null;
  const errorRate = summary.turnCount > 0 ? summary.errorCount / Math.max(summary.turnCount, 1) : 0;
  const healthScore =
    typeof params.fallbackHealthScore === "number" && Number.isFinite(params.fallbackHealthScore)
      ? params.fallbackHealthScore
      : (params.healthRecord?.summary.score ?? 88);
  const healthLevel = params.healthRecord?.summary.level ?? "healthy";
  const mainModel = pickTopModel(summary.modelCounts);
  const sampleDays = Math.max(1, Math.ceil((params.endAt - params.startAt) / DAY_MS));

  return {
    agentId: params.agentId,
    label: params.label,
    startAt: params.startAt,
    endAt: params.endAt,
    sampleDays,
    messageCount: summary.messageCount,
    turnCount: summary.turnCount,
    avgResponseMs: summary.avgResponseMs,
    errorCount: summary.errorCount,
    errorRate,
    errorTypes,
    tokenTotal: summary.tokenTotal,
    tokenEfficiency,
    tokenPerMessage,
    healthScore,
    healthLevel,
    modelUsed: summary.modelUsed,
    mainModel,
    backupModel: resolveBackupModel(params.healthRecord, params.startAt, params.endAt),
    fallbackCount: summary.fallbackCount,
    modelCounts: summary.modelCounts,
  } satisfies MetricSnapshot;
}

export function collectRollingMetricSnapshot(params: {
  agentId: string;
  hourlyStatsByKey: Record<string, ReturnType<typeof getHourlyStatsEntries>[number]>;
  healthRecord?: AgentHealthRecord;
  endAt?: number;
  durationDays?: number;
  label: string;
  fallbackHealthScore?: number | null;
}) {
  const endAt = params.endAt ?? Date.now();
  const durationDays = Math.max(1, params.durationDays ?? 7);
  return collectMetricSnapshot({
    agentId: params.agentId,
    hourlyStatsByKey: params.hourlyStatsByKey,
    healthRecord: params.healthRecord,
    startAt: endAt - durationDays * DAY_MS,
    endAt,
    label: params.label,
    fallbackHealthScore: params.fallbackHealthScore,
  });
}

export function compareMetricSnapshots(
  before: MetricSnapshot,
  after: MetricSnapshot,
): ComparisonSummary {
  const errorRateChangePct = safeDivide(
    after.errorRate - before.errorRate,
    Math.max(before.errorRate, 0.05),
  );
  const latencyChangePct =
    before.avgResponseMs && after.avgResponseMs
      ? safeDivide(after.avgResponseMs - before.avgResponseMs, before.avgResponseMs)
      : null;
  const tokenEfficiencyChangePct =
    before.tokenEfficiency && after.tokenEfficiency
      ? safeDivide(after.tokenEfficiency - before.tokenEfficiency, before.tokenEfficiency)
      : null;
  const healthScoreDelta = after.healthScore - before.healthScore;
  const messageDeltaPct = safeDivide(
    after.messageCount - before.messageCount,
    Math.max(before.messageCount, 10),
  );

  const errorImprovement = errorRateChangePct === null ? 0 : clamp(-errorRateChangePct, -1, 1);
  const latencyImprovement = latencyChangePct === null ? 0 : clamp(-latencyChangePct, -1, 1);
  const tokenImprovement =
    tokenEfficiencyChangePct === null ? 0 : clamp(tokenEfficiencyChangePct, -1, 1);
  const healthImprovement = clamp(healthScoreDelta / 18, -1, 1);
  const messageImprovement = messageDeltaPct === null ? 0 : clamp(messageDeltaPct, -1, 1);

  const weighted =
    errorImprovement * 0.34 +
    latencyImprovement * 0.22 +
    tokenImprovement * 0.18 +
    healthImprovement * 0.16 +
    messageImprovement * 0.1;
  const scoreDelta = Math.round(weighted * 25);

  const strongImprove =
    (errorRateChangePct !== null &&
      errorRateChangePct <= -0.15 &&
      after.errorCount <= Math.max(0, before.errorCount - 1)) ||
    (latencyChangePct !== null && latencyChangePct <= -0.12) ||
    (tokenEfficiencyChangePct !== null && tokenEfficiencyChangePct >= 0.12) ||
    healthScoreDelta >= 5;
  const strongDegrade =
    (errorRateChangePct !== null &&
      errorRateChangePct >= 0.25 &&
      after.errorCount >= before.errorCount + 1) ||
    (latencyChangePct !== null && latencyChangePct >= 0.18) ||
    (tokenEfficiencyChangePct !== null && tokenEfficiencyChangePct <= -0.15) ||
    healthScoreDelta <= -8;

  const status =
    strongImprove || scoreDelta >= 4
      ? "improved"
      : strongDegrade || scoreDelta <= -5
        ? "degraded"
        : "neutral";

  const signals: string[] = [];
  if (errorRateChangePct !== null) {
    signals.push(`错误率 ${formatPercent(-errorRateChangePct)}`);
  }
  if (latencyChangePct !== null) {
    signals.push(`响应速度 ${formatPercent(-latencyChangePct)}`);
  }
  if (tokenEfficiencyChangePct !== null) {
    signals.push(`Token 效率 ${formatPercent(tokenEfficiencyChangePct)}`);
  }
  if (healthScoreDelta !== 0) {
    signals.push(`健康分 ${healthScoreDelta > 0 ? "+" : ""}${healthScoreDelta}`);
  }

  return {
    status,
    scoreDelta,
    summary: signals.length > 0 ? signals.join("，") : "暂无足够的对比信号",
    errorRateChangePct,
    latencyChangePct,
    tokenEfficiencyChangePct,
    healthScoreDelta,
  };
}

function resolveLevel(score: number): GrowthLevel {
  if (score >= 90) {
    return "expert";
  }

  if (score >= 75) {
    return "elite";
  }

  if (score >= 60) {
    return "skilled";
  }

  return "newbie";
}

export function resolveLevelBadge(level: GrowthLevel) {
  if (level === "expert") {
    return "👑 专家";
  }

  if (level === "elite") {
    return "⭐⭐⭐ 精英";
  }

  if (level === "skilled") {
    return "⭐⭐ 熟练";
  }

  return "⭐ 新人";
}

function scoreSpeed(avgResponseMs: number | null) {
  if (avgResponseMs === null) {
    return 55;
  }
  if (avgResponseMs < 1000) {
    return 100;
  }
  if (avgResponseMs < 2000) {
    return 88;
  }
  if (avgResponseMs < 4000) {
    return 74;
  }
  if (avgResponseMs < 8000) {
    return 58;
  }
  if (avgResponseMs < 12_000) {
    return 42;
  }
  return 28;
}

function scoreError(errorRate: number, errorCount: number) {
  return clamp(100 - errorRate * 220 - errorCount * 2.6, 10, 100);
}

function scoreByMax(value: number, maxValue: number, emptyScore = 50) {
  if (maxValue <= 0) {
    return emptyScore;
  }

  return clamp((value / maxValue) * 100, 12, 100);
}

function buildBreakdown(params: {
  metrics: MetricSnapshot;
  maxMessageCount: number;
  maxTokenEfficiency: number;
  growthDelta: number | null;
}): RankingMetricBreakdown {
  const volume = scoreByMax(params.metrics.messageCount, params.maxMessageCount, 50);
  const speed = scoreSpeed(params.metrics.avgResponseMs);
  const error = scoreError(params.metrics.errorRate, params.metrics.errorCount);
  const token = scoreByMax(params.metrics.tokenEfficiency ?? 0, params.maxTokenEfficiency, 55);
  const growth = clamp(50 + (params.growthDelta ?? 0) * 2.8, 10, 100);

  return {
    volume,
    speed,
    error,
    token,
    growth,
  };
}

export function buildLeaderboard(params: {
  agents: Agent[];
  hourlyStatsByKey: Record<string, ReturnType<typeof getHourlyStatsEntries>[number]>;
  healthRecordsByAgentId: Record<string, AgentHealthRecord>;
  previousSnapshotsByAgentId?: Record<string, { metrics: MetricSnapshot; score: number } | null>;
  startAt?: number;
  endAt?: number;
  label?: string;
}) {
  const now = Date.now();
  const window = createWeeklyWindow(now);
  const startAt = params.startAt ?? window.startAt;
  const endAt = params.endAt ?? Math.min(window.endAt, now);
  const label = params.label ?? "本周";

  const currentMetrics = params.agents.map((agent) =>
    collectMetricSnapshot({
      agentId: agent.id,
      hourlyStatsByKey: params.hourlyStatsByKey,
      healthRecord: params.healthRecordsByAgentId[agent.id],
      startAt,
      endAt,
      label,
    }),
  );
  const maxMessageCount = Math.max(0, ...currentMetrics.map((item) => item.messageCount));
  const maxTokenEfficiency = Math.max(
    0,
    ...currentMetrics.map((item) => item.tokenEfficiency ?? 0),
  );

  const entries = currentMetrics
    .filter(
      (metrics) => metrics.messageCount > 0 || metrics.turnCount > 0 || metrics.errorCount > 0,
    )
    .map((metrics) => {
      const previous = params.previousSnapshotsByAgentId?.[metrics.agentId] ?? null;
      const growthDelta = previous
        ? compareMetricSnapshots(previous.metrics, metrics).scoreDelta
        : null;
      const breakdown = buildBreakdown({
        metrics,
        maxMessageCount,
        maxTokenEfficiency,
        growthDelta,
      });
      const score = Math.round(
        breakdown.volume * 0.2 +
          breakdown.speed * 0.2 +
          breakdown.error * 0.25 +
          breakdown.token * 0.15 +
          breakdown.growth * 0.2,
      );
      const scoreDelta = previous ? score - previous.score : null;

      return {
        agentId: metrics.agentId,
        score,
        rank: 0,
        scoreDelta,
        growthDelta,
        level: resolveLevel(score),
        fastestImprover: false,
        warning: Boolean((scoreDelta ?? 0) <= -8 || (growthDelta ?? 0) <= -6),
        metrics,
        breakdown,
      } satisfies RankingEntry;
    })
    .toSorted((left, right) => {
      return (
        right.score - left.score ||
        right.metrics.messageCount - left.metrics.messageCount ||
        left.metrics.errorRate - right.metrics.errorRate ||
        (left.metrics.avgResponseMs ?? Number.MAX_SAFE_INTEGER) -
          (right.metrics.avgResponseMs ?? Number.MAX_SAFE_INTEGER)
      );
    })
    .map((item, index) => ({
      ...item,
      rank: index + 1,
    }));

  const bestGrowth = entries
    .filter((item) => (item.growthDelta ?? 0) > 0)
    .toSorted((left, right) => (right.growthDelta ?? 0) - (left.growthDelta ?? 0))[0];

  return entries.map((item) => ({
    ...item,
    fastestImprover: bestGrowth?.agentId === item.agentId && (item.growthDelta ?? 0) >= 8,
  }));
}

export function mapLeaderboardByAgentId(entries: RankingEntry[]) {
  return Object.fromEntries(
    entries.map((item) => [item.agentId, item] satisfies [string, RankingEntry]),
  );
}

export function summarizeConversation(messages: ChatMessage[]) {
  const excerpts = messages
    .filter((message) => message.content.trim())
    .slice(-6)
    .map((message) => {
      const roleLabel = message.role === "user" ? "董事长" : "员工";
      const text = message.content.replace(/\s+/g, " ").trim().slice(0, 90);
      return `- ${roleLabel}：${text}`;
    });

  return excerpts.length > 0 ? excerpts.join("\n") : "- 本周暂无足够的典型对话样本";
}

function summarizeErrorTypes(errorTypes: MetricSnapshot["errorTypes"]) {
  const items = Object.entries(errorTypes)
    .filter(([, count]) => typeof count === "number" && count > 0)
    .toSorted((left, right) => (right[1] ?? 0) - (left[1] ?? 0))
    .map(([type, count]) => `${type}×${count}`);

  return items.length > 0 ? items.join("、") : "无";
}

export function hasMetricSnapshotData(snapshot: MetricSnapshot) {
  return (
    snapshot.messageCount > 0 ||
    snapshot.turnCount > 0 ||
    snapshot.tokenTotal > 0 ||
    snapshot.errorCount > 0 ||
    snapshot.avgResponseMs !== null
  );
}

export function buildWeeklyReviewPrompt(params: {
  agentName: string;
  snapshot: MetricSnapshot;
  previousSnapshot?: { metrics: MetricSnapshot; score: number } | null;
  ranking?: RankingEntry | null;
  conversationSummary: string;
}) {
  const previousMetrics = params.previousSnapshot?.metrics ?? null;
  const healthTrend = previousMetrics
    ? `${params.snapshot.healthScore - previousMetrics.healthScore > 0 ? "↑" : "↓"}${Math.abs(params.snapshot.healthScore - previousMetrics.healthScore)}`
    : "暂无对比数据";
  const averageLatencyLabel =
    params.snapshot.avgResponseMs === null
      ? "暂无"
      : `${Math.round(params.snapshot.avgResponseMs)}ms`;

  return [
    "【系统成长任务 / 周度自评】",
    `你是虾班公司的员工 ${params.agentName}。`,
    "以下数据来自 statsStore 的真实统计结果，严禁编造、补全或猜测任何不存在的数字。",
    "如果某项数据为空，就直接按“暂无”理解，不要自己补数字。",
    "",
    "【statsStore 真实工作数据】",
    `- 消息量：${params.snapshot.messageCount} 条`,
    `- 对话轮次：${params.snapshot.turnCount} 轮`,
    `- Token 消耗：${formatTokenValue(params.snapshot.tokenTotal)}`,
    `- 错误次数：${params.snapshot.errorCount} 次（${summarizeErrorTypes(params.snapshot.errorTypes)}）`,
    `- 平均延迟：${averageLatencyLabel}`,
    "",
    "【辅助分析数据】",
    `- 健康评分：${params.snapshot.healthScore}`,
    `- 平均响应时间：${formatLatency(params.snapshot.avgResponseMs)}`,
    `- 模型使用：主模型 ${params.snapshot.mainModel ?? "未识别"}，备用模型 ${params.snapshot.backupModel ?? "未触发"}`,
    `- 健康评分变化：${healthTrend}`,
    params.ranking
      ? `- 本周综合评分：${params.ranking.score}（排名 #${params.ranking.rank}，成长变化 ${(params.ranking.growthDelta ?? 0) >= 0 ? "↑" : "↓"}${Math.abs(params.ranking.growthDelta ?? 0)}）`
      : "- 本周综合评分：暂无排名",
    "",
    "典型对话摘要：",
    params.conversationSummary,
    "",
    "请基于以上真实数据写一份简短的周度自评（200 字以内），严格包含以下 3 点：",
    "1. 本周做得最好的一件事，为什么好？",
    "2. 本周最大的失误或不足，原因是什么？",
    "3. 给自己提一条具体、可执行的改进建议",
    "禁止引用上面没有出现过的统计数字。",
  ].join("\n");
}

export function buildPeerTeachPrompt(params: {
  sourceAgentName: string;
  suggestion: string;
  comparison: ComparisonSummary;
}) {
  return [
    "【系统成长任务 / 同事带教】",
    `你的同事 ${params.sourceAgentName} 分享了一个工作方法：`,
    "",
    params.suggestion,
    "",
    `这个方法在 ${params.sourceAgentName} 身上的效果：${params.comparison.summary}`,
    "",
    "请根据你自己的工作特点，思考：",
    "1. 这个方法是否适用于你？",
    "2. 如果适用，你会如何调整自己的工作方式？",
    "",
    "请给出一条具体建议，控制在 160 字以内。",
  ].join("\n");
}

export function extractSuggestionFromReport(report: string) {
  const normalized = report.replace(/\r\n/g, "\n").trim();
  const sectionMatch = normalized.match(
    /(?:^|\n)\s*(?:3[.、]|三[、.．]|改进建议[:：])\s*([\s\S]+)$/u,
  );
  if (sectionMatch?.[1]?.trim()) {
    return sectionMatch[1]
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ")
      .slice(0, 200);
  }

  const sentences = normalized
    .split(/[\n。！？]/u)
    .map((item) => item.trim())
    .filter(Boolean);
  return sentences.at(-1) ?? "保持稳定输出，并减少重复性失误。";
}

function trimGrowthEntries(entries: string[]) {
  return entries.filter(Boolean).slice(0, 8);
}

export function appendGrowthInstructionToIdentity(params: {
  content: string;
  suggestion: string;
  sourceLabel: string;
  timestamp?: number;
}) {
  const normalized = params.content.replace(/\r\n/g, "\n").trimEnd();
  const date = new Date(params.timestamp ?? Date.now()).toLocaleDateString("zh-CN");
  const nextEntry = `- ${date} | ${params.sourceLabel} | ${params.suggestion.trim()}`;

  if (
    normalized.includes(GROWTH_SECTION_HEADER) &&
    normalized.includes(GROWTH_SECTION_START) &&
    normalized.includes(GROWTH_SECTION_END)
  ) {
    const startIndex = normalized.indexOf(GROWTH_SECTION_START);
    const endIndex = normalized.indexOf(GROWTH_SECTION_END);
    const before = normalized.slice(0, startIndex + GROWTH_SECTION_START.length);
    const middle = normalized.slice(startIndex + GROWTH_SECTION_START.length, endIndex);
    const after = normalized.slice(endIndex);
    const nextEntries = trimGrowthEntries([
      nextEntry,
      ...middle
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ]);

    return (
      `${before}\n${nextEntries.join("\n")}\n${after}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n"
    );
  }

  const nextSection = [
    normalized,
    normalized ? "" : "",
    GROWTH_SECTION_HEADER,
    GROWTH_SECTION_START,
    nextEntry,
    GROWTH_SECTION_END,
  ]
    .filter((line, index, array) => !(line === "" && array[index - 1] === ""))
    .join("\n")
    .trimEnd();

  return `${nextSection}\n`;
}

export function describeMetricSnapshot(snapshot: MetricSnapshot) {
  return [
    `消息 ${snapshot.messageCount}`,
    `延迟 ${formatLatency(snapshot.avgResponseMs)}`,
    `错误率 ${formatRatioPercent(snapshot.errorRate)}`,
    `Token 效率 ${snapshot.tokenEfficiency ? snapshot.tokenEfficiency.toFixed(1) : "—"}/1k`,
  ].join(" · ");
}

export function resolveReviewSourceLabel(kind: GrowthRecordKind) {
  return kind === "peer_teach" ? "带教建议" : "周度自评";
}

export function formatGrowthDeltaBadge(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  return `${value >= 0 ? "↑" : "↓"}${Math.abs(Math.round(value))}`;
}

export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  {
    id: "flash_reply",
    icon: "⚡",
    name: "闪电回复",
    description: "连续 8 次响应都快于 1 秒。",
  },
  {
    id: "zero_error_week",
    icon: "🎯",
    name: "零失误周",
    description: "单周至少 10 轮对话且零错误。",
  },
  {
    id: "rapid_growth",
    icon: "📈",
    name: "飞速成长",
    description: "单周综合分提升至少 12 分。",
  },
  {
    id: "monthly_mvp",
    icon: "🏅",
    name: "月度 MVP",
    description: "当月综合分最高。",
  },
  {
    id: "experience_contributor",
    icon: "💡",
    name: "经验贡献者",
    description: "贡献至少 2 条验证有效经验。",
  },
  {
    id: "mentor_friend",
    icon: "🤝",
    name: "良师益友",
    description: "带教至少 2 位同事完成提升。",
  },
  {
    id: "streak_king",
    icon: "🔥",
    name: "连胜王",
    description: "连续 3 周排名第 1。",
  },
  {
    id: "token_saver",
    icon: "💎",
    name: "Token 节约大师",
    description: "单周 Token 效率全队第一，且至少 20 轮对话。",
  },
];
