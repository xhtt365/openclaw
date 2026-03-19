"use client";

import { useStatsStore } from "@/stores/statsStore";
import {
  aggregateHourlyStats,
  formatLatencyMs,
  formatTokenCount,
  getStatsEntriesForWindow,
  resolveStatsTimeWindow,
} from "@/utils/stats";

type AgentWorkStatsPanelProps = {
  agentId: string;
};

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-3">
      <div className="text-xs text-[var(--color-text-secondary)]">{label}</div>
      <div className="mt-2 text-base font-semibold text-[var(--color-text-primary)]">{value}</div>
    </div>
  );
}

export function AgentWorkStatsPanel({ agentId }: AgentWorkStatsPanelProps) {
  const hourlyStatsByKey = useStatsStore((state) => state.hourlyStatsByKey);
  const window = resolveStatsTimeWindow("today");
  const summary = aggregateHourlyStats(getStatsEntriesForWindow(hourlyStatsByKey, window, agentId));

  return (
    <section className="rounded-[24px] border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-4 shadow-[var(--shadow-sm)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[var(--color-text-primary)]">📊 工作统计</div>
          <div className="mt-1 text-xs leading-6 text-[var(--color-text-secondary)]">
            今日已完成交互的工作汇总。
          </div>
        </div>
        <div className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1 text-xs font-medium text-[var(--color-text-secondary)]">
          今日
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <MetricCard label="消息量" value={`${summary.messageCount}`} />
        <MetricCard label="对话轮次" value={`${summary.turnCount}`} />
        <MetricCard label="Token 消耗" value={formatTokenCount(summary.tokenTotal)} />
        <MetricCard label="平均延迟" value={formatLatencyMs(summary.avgResponseMs)} />
        <MetricCard label="错误次数" value={`${summary.errorCount}`} />
      </div>

      <div className="mt-4 rounded-[20px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-3">
        <div className="text-sm font-medium text-[var(--color-text-primary)]">活跃时段</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {summary.activeHourLabels.length > 0 ? (
            summary.activeHourLabels.map((label) => (
              <span
                key={label}
                className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-3 py-1 text-xs text-[var(--color-text-secondary)]"
              >
                {label}
              </span>
            ))
          ) : (
            <span className="text-sm text-[var(--color-text-secondary)]">今日暂无交互</span>
          )}
        </div>
      </div>
    </section>
  );
}
