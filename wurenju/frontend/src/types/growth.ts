import type { HealthErrorType, HealthLevel } from "@/utils/health";

export type GrowthRecordKind = "weekly_review" | "peer_teach";
export type GrowthTriggerKind = "cron" | "manual" | "peer_teach";
export type GrowthSuggestionStatus =
  | "pending_approval"
  | "applied"
  | "rejected"
  | "verified"
  | "rolled_back"
  | "failed";
export type GrowthLevel = "newbie" | "skilled" | "elite" | "expert";
export type PromptChangeSource =
  | "manual"
  | "self_review"
  | "experience_lib"
  | "peer_teach"
  | "rollback";
export type ExperienceStatus = "pending" | "verified" | "failed" | "rolled_back";
export type TeachingDispatchStatus = "pending" | "sent" | "applied" | "skipped";
export type AchievementId =
  | "flash_reply"
  | "zero_error_week"
  | "rapid_growth"
  | "monthly_mvp"
  | "experience_contributor"
  | "mentor_friend"
  | "streak_king"
  | "token_saver";
export type GrowthEventTone = "system" | "done" | "error" | "executing" | "thinking";

export type MetricSnapshot = {
  agentId: string;
  label: string;
  startAt: number;
  endAt: number;
  sampleDays: number;
  messageCount: number;
  turnCount: number;
  avgResponseMs: number | null;
  errorCount: number;
  errorRate: number;
  errorTypes: Partial<Record<HealthErrorType, number>>;
  tokenTotal: number;
  tokenEfficiency: number | null;
  tokenPerMessage: number | null;
  healthScore: number;
  healthLevel: HealthLevel;
  modelUsed: string | null;
  mainModel: string | null;
  backupModel: string | null;
  fallbackCount: number;
  modelCounts: Record<string, number>;
};

export type RankingMetricBreakdown = {
  volume: number;
  speed: number;
  error: number;
  token: number;
  growth: number;
};

export type RankingEntry = {
  agentId: string;
  score: number;
  rank: number;
  scoreDelta: number | null;
  growthDelta: number | null;
  level: GrowthLevel;
  fastestImprover: boolean;
  warning: boolean;
  metrics: MetricSnapshot;
  breakdown: RankingMetricBreakdown;
};

export type WeeklyGrowthSnapshot = {
  id: string;
  agentId: string;
  weekKey: string;
  weekLabel: string;
  capturedAt: number;
  metrics: MetricSnapshot;
  score: number;
  rank: number | null;
  scoreDelta: number | null;
  growthDelta: number | null;
  level: GrowthLevel;
};

export type GrowthReviewRecord = {
  id: string;
  agentId: string;
  kind: GrowthRecordKind;
  trigger: GrowthTriggerKind;
  weekKey: string;
  createdAt: number;
  prompt: string;
  report: string;
  suggestion: string;
  snapshot: WeeklyGrowthSnapshot;
  previousSnapshot: WeeklyGrowthSnapshot | null;
  status: GrowthSuggestionStatus;
  sourceAgentId?: string;
  sourceExperienceId?: string;
  promptVersionId?: string;
  experienceId?: string;
  note?: string;
  appliedAt?: number;
  rejectedAt?: number;
  verifiedAt?: number;
  rolledBackAt?: number;
};

export type ExperienceEntry = {
  id: string;
  source: string;
  sourceReviewId?: string;
  basedOnExperienceId?: string;
  weekKey: string;
  suggestion: string;
  appliedTo: string[];
  status: ExperienceStatus;
  createdAt: number;
  evaluationDueAt: number;
  metrics: {
    before: MetricSnapshot;
    after?: MetricSnapshot;
  };
};

export type PromptVersion = {
  id: string;
  version: string;
  agentId: string;
  fileName: "IDENTITY.md" | "SOUL.md";
  timestamp: string;
  changeDescription: string;
  content: string;
  source: PromptChangeSource;
  metrics: MetricSnapshot;
};

export type PromptRollbackRecord = {
  id: string;
  agentId: string;
  fileName: "IDENTITY.md" | "SOUL.md";
  fromVersionId: string;
  toVersionId: string;
  reason: string;
  createdAt: number;
  metricsBeforeRollback: MetricSnapshot;
};

export type AchievementDefinition = {
  id: AchievementId;
  icon: string;
  name: string;
  description: string;
};

export type AchievementUnlock = {
  id: string;
  agentId: string;
  achievementId: AchievementId;
  unlockedAt: number;
  detail: string;
};

export type RankingSnapshot = {
  id: string;
  weekKey: string;
  createdAt: number;
  items: RankingEntry[];
};

export type TeachingDispatch = {
  id: string;
  experienceId: string;
  sourceAgentId: string;
  targetAgentId: string;
  suggestion: string;
  scheduledAt: number;
  createdAt: number;
  status: TeachingDispatchStatus;
  deliveredAt?: number;
  relatedReviewId?: string;
};

export type GrowthEvent = {
  id: string;
  time: number;
  tone: GrowthEventTone;
  title: string;
  text: string;
  agentId?: string;
  agentName?: string;
};
