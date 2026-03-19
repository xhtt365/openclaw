"use client";

import { memo, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAchievementStore } from "@/stores/achievementStore";
import { useGrowthStore } from "@/stores/growthStore";
import { useHealthStore } from "@/stores/healthStore";
import { usePromptVersionStore } from "@/stores/promptVersionStore";
import { useStatsStore } from "@/stores/statsStore";
import type { MetricSnapshot } from "@/types/growth";
import {
  collectRollingMetricSnapshot,
  describeMetricSnapshot,
  resolveLevelBadge,
} from "@/utils/growth";

function resolveStatusBadge(status: string) {
  if (status === "verified") {
    return "bg-[var(--surface-success-soft)] text-[var(--surface-success-text)]";
  }

  if (status === "applied") {
    return "bg-[var(--color-bg-brand-soft)] text-[var(--color-brand)]";
  }

  if (status === "rolled_back") {
    return "bg-[var(--surface-danger-soft)] text-[var(--surface-danger-text)]";
  }

  if (status === "failed") {
    return "bg-[var(--surface-soft-strong)] text-[var(--color-text-secondary)]";
  }

  return "bg-[var(--surface-soft)] text-[var(--color-text-secondary)]";
}

function resolveStatusLabel(status: string) {
  if (status === "verified") {
    return "已验证";
  }

  if (status === "applied") {
    return "已应用";
  }

  if (status === "rolled_back") {
    return "已回滚";
  }

  if (status === "failed") {
    return "无效";
  }

  return "待审批";
}

function TrendChart({ points }: { points: Array<{ label: string; score: number }> }) {
  if (points.length === 0) {
    return (
      <div className="rounded-[20px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">
        还没有成长轨迹数据
      </div>
    );
  }

  const width = 360;
  const height = 120;
  const maxScore = Math.max(100, ...points.map((point) => point.score));
  const minScore = Math.min(0, ...points.map((point) => point.score));
  const range = Math.max(1, maxScore - minScore);
  const polyline = points
    .map((point, index) => {
      const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * (width - 20) + 10;
      const y = height - ((point.score - minScore) / range) * (height - 20) - 10;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="rounded-[20px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[140px] w-full">
        <polyline
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={polyline}
        />
        {points.map((point, index) => {
          const x =
            points.length === 1 ? width / 2 : (index / (points.length - 1)) * (width - 20) + 10;
          const y = height - ((point.score - minScore) / range) * (height - 20) - 10;
          return (
            <g key={`${point.label}-${index}`}>
              <circle cx={x} cy={y} r="4.5" fill="var(--color-brand)" />
              <text
                x={x}
                y={height - 2}
                textAnchor="middle"
                className="fill-[var(--color-text-secondary)] text-[10px]"
              >
                {point.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function EmployeeGrowthPanelInner({ agentId }: { agentId: string }) {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const growthStore = useGrowthStore();
  const achievementStore = useAchievementStore();
  const promptVersionStore = usePromptVersionStore();
  const hourlyStatsByKey = useStatsStore((state) => state.hourlyStatsByKey);
  const healthRecord = useHealthStore((state) => state.recordsByAgentId[agentId]);

  const reviews = useMemo(() => growthStore.getReviewsForAgent(agentId), [agentId, growthStore]);
  const snapshots = useMemo(
    () => growthStore.getSnapshotsForAgent(agentId),
    [agentId, growthStore],
  );
  const unlocks = useMemo(
    () => achievementStore.getUnlocksForAgent(agentId),
    [achievementStore, agentId],
  );
  const versions = useMemo(
    () => promptVersionStore.getVersionsForAgent(agentId),
    [agentId, promptVersionStore],
  );
  const activeVersionIdByFileName = {
    "IDENTITY.md": promptVersionStore.getActiveVersionId(agentId, "IDENTITY.md"),
    "SOUL.md": promptVersionStore.getActiveVersionId(agentId, "SOUL.md"),
  } as const;
  const latestSnapshot = snapshots.at(-1) ?? null;
  const currentMetrics: MetricSnapshot =
    latestSnapshot?.metrics ??
    collectRollingMetricSnapshot({
      agentId,
      hourlyStatsByKey,
      healthRecord,
      label: "当前 7 日",
    });
  const selectedVersion =
    versions.find(
      (version) =>
        version.id ===
        (selectedVersionId ?? activeVersionIdByFileName["IDENTITY.md"] ?? versions[0]?.id),
    ) ?? null;

  return (
    <section className="rounded-[24px] border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-4 shadow-[var(--shadow-sm)] backdrop-blur-xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[var(--color-text-primary)]">📈 成长档案</div>
          <div className="mt-1 text-xs leading-6 text-[var(--color-text-secondary)]">
            周报、自评建议、提示词版本和成就都会沉淀在这里。
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="h-9 rounded-2xl px-3"
            onClick={() => {
              void growthStore.runWeeklyReviews({
                agentId,
                force: true,
                trigger: "manual",
              });
            }}
          >
            立即触发周报
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-2xl px-3"
            onClick={() => {
              void growthStore.evaluatePendingChanges({ force: true, agentId });
            }}
          >
            立即验证效果
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="space-y-4">
          <div>
            <div className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
              成长轨迹
            </div>
            <TrendChart
              points={snapshots.map((snapshot) => ({
                label: snapshot.weekLabel,
                score: snapshot.score,
              }))}
            />
          </div>

          <div>
            <div className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
              最近复盘
            </div>
            <div className="space-y-3">
              {reviews.length > 0 ? (
                reviews.slice(0, 6).map((review) => (
                  <article
                    key={review.id}
                    className="rounded-[20px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                            {review.kind === "peer_teach" ? "同事带教" : "周度自评"}
                          </div>
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${resolveStatusBadge(review.status)}`}
                          >
                            {resolveStatusLabel(review.status)}
                          </span>
                        </div>
                        <div className="mt-2 text-xs text-[var(--color-text-secondary)]">
                          {new Date(review.createdAt).toLocaleString("zh-CN")} · 综合分{" "}
                          {review.snapshot.score} · {resolveLevelBadge(review.snapshot.level)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-3 py-3 text-sm leading-7 text-[var(--color-text-secondary)]">
                      {review.report}
                    </div>

                    <div className="mt-3">
                      <div className="text-[11px] text-[var(--color-text-secondary)]">改进建议</div>
                      <div className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
                        {review.suggestion}
                      </div>
                    </div>

                    {review.status === "pending_approval" ? (
                      <div className="mt-4">
                        <Button
                          type="button"
                          className="h-9 rounded-2xl px-3"
                          onClick={() => {
                            void growthStore.applyReviewSuggestion(review.id);
                          }}
                        >
                          应用到 IDENTITY
                        </Button>
                      </div>
                    ) : null}
                  </article>
                ))
              ) : (
                <div className="rounded-[20px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">
                  还没有成长记录，先触发一次周报吧。
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">成就</div>
            {unlocks.length > 0 ? (
              <div className="space-y-3">
                {unlocks.map((unlock) => {
                  const definition = achievementStore.definitions.find(
                    (item) => item.id === unlock.achievementId,
                  );
                  return (
                    <div
                      key={unlock.id}
                      className="rounded-[20px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-3"
                    >
                      <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                        {definition?.icon} {definition?.name}
                      </div>
                      <div className="mt-1 text-xs leading-6 text-[var(--color-text-secondary)]">
                        {unlock.detail}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[20px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">
                还没有解锁成就
              </div>
            )}
          </div>

          <div>
            <div className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
              提示词版本
            </div>
            {versions.length > 0 ? (
              <div className="space-y-3">
                <div className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
                  {versions.map((version) => {
                    const fileActiveVersionId = activeVersionIdByFileName[version.fileName];
                    const isActive = version.id === (selectedVersion?.id ?? fileActiveVersionId);
                    const isCurrent = version.id === fileActiveVersionId;
                    return (
                      <button
                        key={version.id}
                        type="button"
                        onClick={() => {
                          setSelectedVersionId(version.id);
                        }}
                        className={`w-full rounded-[18px] border px-3 py-3 text-left transition-colors ${
                          isActive
                            ? "border-[var(--color-brand)] bg-[var(--color-bg-brand-soft)]"
                            : "border-[var(--color-border)] bg-[var(--color-bg-card)]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                            {version.fileName} · {version.version}
                          </div>
                          {isCurrent ? (
                            <span className="rounded-full bg-[var(--surface-success-soft)] px-2 py-1 text-[11px] font-semibold text-[var(--surface-success-text)]">
                              当前
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                          {new Date(version.timestamp).toLocaleString("zh-CN")} · {version.source}
                        </div>
                        <div className="mt-2 text-sm text-[var(--color-text-secondary)]">
                          {version.changeDescription}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {selectedVersion ? (
                  <div className="rounded-[20px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                          {selectedVersion.fileName} · {selectedVersion.version}
                        </div>
                        <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                          {describeMetricSnapshot(selectedVersion.metrics)}
                        </div>
                      </div>
                      {selectedVersion.id !==
                      activeVersionIdByFileName[selectedVersion.fileName] ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 rounded-2xl px-3"
                          onClick={() => {
                            void promptVersionStore.rollbackToVersion({
                              agentId,
                              fileName: selectedVersion.fileName,
                              versionId: selectedVersion.id,
                              reason: "手动回滚",
                              metrics: currentMetrics,
                            });
                          }}
                        >
                          回滚到此版本
                        </Button>
                      ) : null}
                    </div>
                    <pre className="mt-3 max-h-[260px] overflow-auto whitespace-pre-wrap rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-3 py-3 text-xs leading-6 text-[var(--color-text-secondary)]">
                      {selectedVersion.content}
                    </pre>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-[20px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">
                还没有提示词版本记录
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export const EmployeeGrowthPanel = memo(EmployeeGrowthPanelInner);
EmployeeGrowthPanel.displayName = "EmployeeGrowthPanel";
