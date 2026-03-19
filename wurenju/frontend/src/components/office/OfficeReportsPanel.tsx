"use client";

import { memo, useMemo, useState } from "react";
import { AgentAvatar } from "@/components/stats/AgentAvatar";
import { cn } from "@/lib/utils";
import type { Agent } from "@/stores/agentStore";
import { useAgentStore } from "@/stores/agentStore";
import { useStatsStore } from "@/stores/statsStore";
import {
  aggregateHourlyStats,
  formatLatencyMs,
  formatPercentChange,
  formatTokenCount,
  getStatsEntriesForWindow,
  resolvePercentChange,
  resolveStatsTimeWindow,
  type HourlyStats,
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
  summary: ReturnType<typeof aggregateHourlyStats>;
  share: number;
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
              {item.agent.name}
            </div>
            <div className="truncate text-xs text-[var(--color-text-secondary)]">
              {item.agent.role?.trim() || "AI 员工"}
            </div>
          </div>
        </div>
        <div className="rounded-full bg-[var(--color-bg-brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--color-brand)]">
          {item.summary.messageCount} 条
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <div className="text-[11px] text-[var(--color-text-secondary)]">对话轮次</div>
          <div className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
            {item.summary.turnCount}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--color-text-secondary)]">Token 消耗</div>
          <div className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
            {formatTokenCount(item.summary.tokenTotal)}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--color-text-secondary)]">平均延迟</div>
          <div className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
            {formatLatencyMs(item.summary.avgResponseMs)}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3 text-[11px] text-[var(--color-text-secondary)]">
          <span>消息量占比</span>
          <span>{item.share.toFixed(item.share >= 10 ? 0 : 1)}%</span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-[var(--color-bg-soft)]">
          <div
            className="h-full rounded-full bg-[var(--color-brand)] transition-[width]"
            style={{ width: `${Math.max(0, Math.min(100, item.share))}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function buildRankingItems(agents: Agent[], entries: HourlyStats[]) {
  const grouped = new Map<string, HourlyStats[]>();

  for (const item of entries) {
    const current = grouped.get(item.agentId) ?? [];
    grouped.set(item.agentId, [...current, item]);
  }

  const teamMessageCount = Math.max(1, aggregateHourlyStats(entries).messageCount);

  return agents
    .map((agent) => {
      const summary = aggregateHourlyStats(grouped.get(agent.id) ?? []);
      return {
        agent,
        summary,
        share: (summary.messageCount / teamMessageCount) * 100,
      } satisfies RankingItem;
    })
    .filter((item) => item.summary.turnCount > 0 || item.summary.messageCount > 0)
    .toSorted(
      (left, right) =>
        right.summary.messageCount - left.summary.messageCount ||
        right.summary.turnCount - left.summary.turnCount ||
        right.summary.tokenTotal - left.summary.tokenTotal,
    );
}

function OfficeReportsPanelInner() {
  const agents = useAgentStore((state) => state.agents);
  const hourlyStatsByKey = useStatsStore((state) => state.hourlyStatsByKey);
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

    return {
      currentSummary,
      previousSummary,
      rankingItems: buildRankingItems(agents, currentEntries),
    };
  }, [agents, hourlyStatsByKey, range]);

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
