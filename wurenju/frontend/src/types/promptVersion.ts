export type HealthErrorType =
  | "timeout"
  | "model_unavailable"
  | "context_overflow"
  | "network"
  | "unauthorized"
  | "unknown";

export type HealthLevel = "healthy" | "warning" | "critical" | "offline";

export type PromptChangeSource =
  | "manual"
  | "self_review"
  | "experience_lib"
  | "peer_teach"
  | "rollback";

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
