"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { AgentHealthSummary, HealthLevel } from "@/utils/health";

type HealthBadgeProps = {
  summary: AgentHealthSummary;
  compact?: boolean;
  showTooltip?: boolean;
  className?: string;
};

const HEALTH_META: Record<
  HealthLevel,
  {
    dot: string;
    label: string;
    pillClassName: string;
    scoreClassName: string;
  }
> = {
  healthy: {
    dot: "🟢",
    label: "健康",
    pillClassName:
      "border-[var(--surface-success-border)] bg-[var(--surface-success-soft)] text-[var(--surface-success-text)]",
    scoreClassName: "text-[var(--surface-success-text)]",
  },
  warning: {
    dot: "🟡",
    label: "警告",
    pillClassName:
      "border-[var(--surface-warning-border)] bg-[var(--surface-warning-soft)] text-[var(--surface-warning-text)]",
    scoreClassName: "text-[var(--surface-warning-text)]",
  },
  critical: {
    dot: "🔴",
    label: "异常",
    pillClassName:
      "border-[var(--surface-danger-border)] bg-[var(--surface-danger-soft)] text-[var(--surface-danger-text)]",
    scoreClassName: "text-[var(--surface-danger-text)]",
  },
};

function formatDurationMs(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "—";
  }

  if (value >= 60 * 60 * 1000) {
    return `${(value / (60 * 60 * 1000)).toFixed(1)}h`;
  }
  if (value >= 60 * 1000) {
    return `${(value / (60 * 1000)).toFixed(1)}m`;
  }
  return `${(value / 1000).toFixed(1)}s`;
}

function formatLatency(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "—";
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}s`;
  }
  return `${Math.round(value)}ms`;
}

function formatTokenCount(value: number | null | undefined) {
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

export function formatHealthWarningTitle(summary: AgentHealthSummary) {
  if (summary.level === "healthy") {
    return null;
  }

  const headline = summary.issues[0]?.detail ?? "员工当前健康状态异常";
  const extras = [
    `健康分 ${summary.score}`,
    summary.currentModel ? `模型 ${summary.currentModel}` : null,
    summary.avgLatencyMs ? `平均延迟 ${formatLatency(summary.avgLatencyMs)}` : null,
    summary.lastErrorMessage ? `最近错误 ${summary.lastErrorMessage}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return extras ? `${headline}\n${extras}` : headline;
}

function HealthTooltip({ summary }: { summary: AgentHealthSummary }) {
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-3 w-[240px] -translate-x-1/2 rounded-2xl border border-[var(--modal-shell-border)] bg-[var(--color-bg-card)] p-3 text-left text-xs text-[var(--color-text-primary)] shadow-[var(--shadow-lg)]">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">健康详情</span>
        <span className={cn("font-semibold", HEALTH_META[summary.level].scoreClassName)}>
          {summary.score}
        </span>
      </div>
      <div className="mt-2 space-y-1.5 text-[var(--color-text-secondary)]">
        <div>模型：{summary.currentModel ?? "未知"}</div>
        <div>平均延迟：{formatLatency(summary.avgLatencyMs)}</div>
        <div>
          Token：{formatTokenCount(summary.currentContextUsed)} /{" "}
          {formatTokenCount(summary.contextWindowSize)}
        </div>
        <div>最近错误：{summary.recentErrorCount} 次</div>
        <div>连续可用：{formatDurationMs(summary.consecutiveAvailableMs)}</div>
        <div className="pt-1 text-[var(--color-text-primary)]">
          {summary.issues[0]?.detail ?? "最近没有发现明显异常。"}
        </div>
      </div>
    </div>
  );
}

export function HealthBadge({
  summary,
  compact = false,
  showTooltip = false,
  className,
}: HealthBadgeProps) {
  const [open, setOpen] = useState(false);
  const meta = HEALTH_META[summary.level];

  return (
    <div
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
          meta.pillClassName,
          compact ? "px-2 py-0.5 text-[10px]" : "",
        )}
        tabIndex={showTooltip ? 0 : -1}
        title={!showTooltip ? (formatHealthWarningTitle(summary) ?? undefined) : undefined}
      >
        <span aria-hidden="true">{meta.dot}</span>
        <span>{summary.score}</span>
        {!compact ? <span>{meta.label}</span> : null}
      </div>
      {showTooltip && open ? <HealthTooltip summary={summary} /> : null}
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="text-[var(--color-text-secondary)]">{label}</span>
      <span className="text-right font-medium text-[var(--color-text-primary)]">{value}</span>
    </div>
  );
}

export function HealthStatusPanel({ summary }: { summary: AgentHealthSummary }) {
  const meta = HEALTH_META[summary.level];
  const usageText =
    summary.currentContextUsed !== null || summary.contextWindowSize !== null
      ? `${formatTokenCount(summary.currentContextUsed)} / ${formatTokenCount(summary.contextWindowSize)}`
      : "—";

  return (
    <section className="rounded-[24px] border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-4 shadow-[var(--shadow-sm)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[var(--color-text-primary)]">💓 健康状态</div>
          <div className="mt-1 text-xs leading-6 text-[var(--color-text-secondary)]">
            基于最近 24 小时交互、Fallback、错误和上下文压力综合计算。
          </div>
        </div>
        <HealthBadge summary={summary} />
      </div>

      <div className="mt-4 rounded-[20px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-2">
        <MetricRow label="平均响应延迟" value={formatLatency(summary.avgLatencyMs)} />
        <MetricRow label="当前模型" value={summary.currentModel ?? "未知"} />
        <MetricRow label="Token 用量" value={usageText} />
        <MetricRow label="最近 24h 错误" value={`${summary.errorCount24h} 次`} />
        <MetricRow label="连续可用时长" value={formatDurationMs(summary.consecutiveAvailableMs)} />
      </div>

      <div className="mt-3 space-y-2">
        {summary.issues.map((issue) => (
          <div
            key={issue.code}
            className={cn("rounded-2xl border px-3 py-2 text-sm", meta.pillClassName)}
          >
            <div className="font-medium">{issue.label}</div>
            <div className="mt-1 text-xs leading-6 opacity-90">{issue.detail}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function formatHealthLatency(value: number | null | undefined) {
  return formatLatency(value);
}
