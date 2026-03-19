"use client";

import { memo, useMemo, useState } from "react";
import { AgentAvatar } from "@/components/stats/AgentAvatar";
import { cn } from "@/lib/utils";
import type { Agent } from "@/stores/agentStore";
import { useAgentStore } from "@/stores/agentStore";
import { useGrowthStore } from "@/stores/growthStore";
import { useHealthStore } from "@/stores/healthStore";
import { useStatsStore } from "@/stores/statsStore";
import type { RankingEntry } from "@/types/growth";
import { buildLeaderboard, createWeekKey, resolveLevelBadge } from "@/utils/growth";
import {
  aggregateHourlyStats,
  formatLatencyMs,
  formatPercentChange,
  formatTokenCount,
  getStatsEntriesForWindow,
  resolvePercentChange,
  resolveStatsTimeWindow,
  type StatsTimeRangeKey,
} from "@/utils/stats";

const RANGE_OPTIONS: Array<{ key: StatsTimeRangeKey; label: string }> = [
  { key: "today", label: "今日" },
  { key: "yesterday", label: "昨日" },
  { key: "week", label: "本周" },
  { key: "month", label: "本月" },
];

type RankingItem = {
  agent: Agent;
  ranking: RankingEntry;
};

function SummaryCard({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: number | null;
}) {
  return (
    <div className="rounded-[22px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-4">
      <div className="text-xs text-[var(--color-text-secondary)]">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-[var(--color-text-primary)]">{value}</div>
      <div className="mt-2 text-xs text-[var(--color-text-secondary)]">
        较上周期 {formatPercentChange(change)}
      </div>
    </div>
  );
}

function ActivityBars({ values }: { values: number[] }) {
  const maxValue = Math.max(1, ...values);

  return (
    <div className="rounded-[22px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[var(--color-text-primary)]">活跃时段分布</div>
          <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
            按消息量汇总 24 小时分布
          </div>
        </div>
        <div className="text-xs text-[var(--color-text-secondary)]">24h</div>
      </div>

      <div className="mt-4">
        <div className="flex h-28 items-end gap-1">
          {values.map((value, hour) => {
            const height = value > 0 ? Math.max(10, (value / maxValue) * 100) : 6;

            return (
              <div
                key={hour}
                className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2"
              >
                <div
                  className={cn(
                    "w-full rounded-t-md transition-[height,background-color]",
                    value > 0
                      ? "bg-[var(--color-brand)]"
                      : "bg-[color:color-mix(in_srgb,var(--color-border)_78%,transparent)]",
                  )}
                  style={{ height: `${height}%` }}
                  title={`${hour.toString().padStart(2, "0")}:00 · ${value} 条消息`}
                />
                <span className="text-[10px] text-[var(--color-text-secondary)]">
                  {hour % 3 === 0 ? hour.toString().padStart(2, "0") : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RankingCard({ item }: { item: RankingItem }) {
  return (
    <div className="rounded-[22px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <AgentAvatar
            agent={item.agent}
            className="h-10 w-10 rounded-2xl border border-[var(--color-border)] object-cover"
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
              #{item.ranking.rank} {item.agent.name}
            </div>
            <div className="truncate text-xs text-[var(--color-text-secondary)]">
              {item.agent.role?.trim() || "AI 员工"} · {resolveLevelBadge(item.ranking.level)}
            </div>
          </div>
        </div>
        <div className="rounded-full bg-[var(--color-bg-brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--color-brand)]">
          {item.ranking.score} 分
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <div className="text-[11px] text-[var(--color-text-secondary)]">对话轮次</div>
          <div className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
            {item.ranking.metrics.turnCount}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--color-text-secondary)]">错误率</div>
          <div className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
            {(item.ranking.metrics.errorRate * 100).toFixed(
              item.ranking.metrics.errorRate >= 0.1 ? 0 : 1,
            )}
            %
          </div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--color-text-secondary)]">平均延迟</div>
          <div className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
            {formatLatencyMs(item.ranking.metrics.avgResponseMs)}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-[18px] border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-3 py-3">
          <div className="text-[11px] text-[var(--color-text-secondary)]">本周成长幅度</div>
          <div className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
            {item.ranking.growthDelta !== null
              ? `${item.ranking.growthDelta >= 0 ? "+" : ""}${Math.round(item.ranking.growthDelta)}`
              : "—"}
            {item.ranking.fastestImprover ? " 🔥" : ""}
          </div>
        </div>
        <div className="rounded-[18px] border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-3 py-3">
          <div className="text-[11px] text-[var(--color-text-secondary)]">分数变化</div>
          <div className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
            {item.ranking.scoreDelta !== null
              ? `${item.ranking.scoreDelta >= 0 ? "+" : ""}${item.ranking.scoreDelta}`
              : "—"}
            {item.ranking.warning ? " ⚠️" : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

function OfficeReportsPanelInner() {
  const agents = useAgentStore((state) => state.agents);
  const hourlyStatsByKey = useStatsStore((state) => state.hourlyStatsByKey);
  const healthRecordsByAgentId = useHealthStore((state) => state.recordsByAgentId);
  const weeklySnapshots = useGrowthStore((state) => state.weeklySnapshots);
  const [range, setRange] = useState<StatsTimeRangeKey>("today");

  const report = useMemo(() => {
    const window = resolveStatsTimeWindow(range);
    const currentEntries = getStatsEntriesForWindow(hourlyStatsByKey, window);
    const previousEntries = getStatsEntriesForWindow(hourlyStatsByKey, {
      startAt: window.previousStartAt,
      endAt: window.previousEndAt,
    });
    const currentSummary = aggregateHourlyStats(currentEntries);
    const previousSummary = aggregateHourlyStats(previousEntries);
    const currentWeekKey = createWeekKey(Math.max(window.startAt, window.endAt - 1));
    const previousSnapshotsByAgentId = Object.fromEntries(
      agents.map((agent) => {
        const latestSnapshot =
          weeklySnapshots
            .filter(
              (snapshot) => snapshot.agentId === agent.id && snapshot.weekKey !== currentWeekKey,
            )
            .toSorted((left, right) => right.capturedAt - left.capturedAt)
            .at(0) ?? null;

        return [
          agent.id,
          latestSnapshot ? { metrics: latestSnapshot.metrics, score: latestSnapshot.score } : null,
        ] as const;
      }),
    );
    const rankingEntries = buildLeaderboard({
      agents,
      hourlyStatsByKey,
      healthRecordsByAgentId,
      previousSnapshotsByAgentId,
      startAt: window.startAt,
      endAt: window.endAt,
      label:
        range === "month"
          ? "本月"
          : range === "week"
            ? "本周"
            : range === "yesterday"
              ? "昨日"
              : "今日",
    });

    return {
      currentSummary,
      previousSummary,
      rankingItems: rankingEntries.map((ranking) => ({
        agent: agents.find((agent) => agent.id === ranking.agentId)!,
        ranking,
      })),
    };
  }, [agents, healthRecordsByAgentId, hourlyStatsByKey, range, weeklySnapshots]);

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[24px] border border-[var(--modal-shell-border)] bg-[var(--surface-glass)] backdrop-blur-xl">
      <div className="border-b border-[var(--divider)] px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight text-[var(--color-text-primary)]">
              📊 工作报表
            </h2>
            <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
              按小时聚合团队与员工工作数据
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {RANGE_OPTIONS.map((option) => {
            const active = option.key === range;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setRange(option.key)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "border-[var(--color-brand)] bg-[var(--color-bg-brand-soft)] text-[var(--color-brand)]"
                    : "border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="im-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-4">
          <div>
            <div className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
              团队总览
            </div>
            <div className="grid gap-3">
              <SummaryCard
                label="总消息量"
                value={`${report.currentSummary.messageCount}`}
                change={resolvePercentChange(
                  report.currentSummary.messageCount,
                  report.previousSummary.messageCount,
                )}
              />
              <SummaryCard
                label="总对话轮次"
                value={`${report.currentSummary.turnCount}`}
                change={resolvePercentChange(
                  report.currentSummary.turnCount,
                  report.previousSummary.turnCount,
                )}
              />
              <SummaryCard
                label="总 Token 消耗"
                value={formatTokenCount(report.currentSummary.tokenTotal)}
                change={resolvePercentChange(
                  report.currentSummary.tokenTotal,
                  report.previousSummary.tokenTotal,
                )}
              />
              <ActivityBars values={report.currentSummary.activeHours} />
            </div>
          </div>

          <div>
            <div className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
              员工排行
            </div>
            {report.rankingItems.length > 0 ? (
              <div className="space-y-3">
                {report.rankingItems.map((item) => (
                  <RankingCard key={item.agent.id} item={item} />
                ))}
              </div>
            ) : (
              <div className="rounded-[22px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">
                当前时间范围还没有工作数据
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export const OfficeReportsPanel = memo(OfficeReportsPanelInner);
OfficeReportsPanel.displayName = "OfficeReportsPanel";
