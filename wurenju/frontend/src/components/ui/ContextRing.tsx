"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

type ContextRingProps = {
  currentUsed: number;
  total: number;
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;
  totalConsumed: number;
  className?: string;
};

const tokenNumberFormatter = new Intl.NumberFormat("en-US");

function formatTokenCount(value: number) {
  return tokenNumberFormatter.format(Math.max(0, Math.floor(value)));
}

function getProgressPercent(currentUsed: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (currentUsed / total) * 100));
}

function getRingStrokeClass(progressPercent: number) {
  if (progressPercent > 80) {
    return "stroke-red-500";
  }
  if (progressPercent >= 50) {
    return "stroke-amber-500";
  }
  return "stroke-slate-500 dark:stroke-slate-300";
}

export function ContextRing({
  currentUsed,
  total,
  inputTokens,
  outputTokens,
  cacheHitTokens,
  totalConsumed,
  className,
}: ContextRingProps) {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const size = 36;
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  // 用圆周长和 dashoffset 控制圆环填充弧长度。
  const circumference = 2 * Math.PI * radius;
  const progressPercent = getProgressPercent(currentUsed, total);
  const dashOffset = circumference * (1 - progressPercent / 100);
  const totalLabel = total > 0 ? formatTokenCount(total) : "--";
  const percentLabel = Math.round(progressPercent);

  return (
    <div
      className={cn("relative shrink-0", className)}
      onMouseEnter={() => setIsTooltipVisible(true)}
      onMouseLeave={() => setIsTooltipVisible(false)}
    >
      <div
        className="rounded-full bg-gray-50/80 p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 dark:bg-zinc-800/60 dark:focus-visible:ring-amber-300/40"
        role="progressbar"
        aria-label="当前上下文用量"
        aria-valuemin={0}
        aria-valuemax={total > 0 ? total : 100}
        aria-valuenow={total > 0 ? Math.max(0, Math.floor(currentUsed)) : 0}
        aria-valuetext={`已用 ${formatTokenCount(currentUsed)} / ${totalLabel}`}
        tabIndex={0}
        onFocus={() => setIsTooltipVisible(true)}
        onBlur={() => setIsTooltipVisible(false)}
      >
        <svg
          aria-hidden="true"
          className="-rotate-90 overflow-visible"
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          width={size}
        >
          <circle
            className="fill-none stroke-gray-200 dark:stroke-zinc-700"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={strokeWidth}
          />
          <circle
            className={cn(
              "fill-none transition-[stroke-dashoffset,stroke] duration-300 ease-out",
              getRingStrokeClass(progressPercent)
            )}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            strokeWidth={strokeWidth}
          />
        </svg>
      </div>

      {isTooltipVisible ? (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-3 -translate-x-1/2 rounded-lg border border-white/10 bg-gray-800 px-3 py-2 text-xs text-white shadow-2xl dark:bg-zinc-800">
          <div className="space-y-1 whitespace-nowrap">
            <div>
              上下文：已用 {formatTokenCount(currentUsed)} / {totalLabel} ({percentLabel}%)
            </div>
            <div>输入 tokens：{formatTokenCount(inputTokens)}</div>
            <div>输出 tokens：{formatTokenCount(outputTokens)}</div>
            <div>缓存命中：{formatTokenCount(cacheHitTokens)}</div>
            <div>合计：{formatTokenCount(totalConsumed)}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
