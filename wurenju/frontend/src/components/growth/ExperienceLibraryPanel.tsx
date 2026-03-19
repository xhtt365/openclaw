"use client";

import { memo, useMemo } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { useExperienceStore } from "@/stores/experienceStore";
import { formatGrowthDeltaBadge } from "@/utils/growth";

function resolveStatusMeta(status: string) {
  if (status === "verified") {
    return {
      label: "已验证",
      className: "bg-[var(--surface-success-soft)] text-[var(--surface-success-text)]",
    };
  }

  if (status === "rolled_back") {
    return {
      label: "已回滚",
      className: "bg-[var(--surface-danger-soft)] text-[var(--surface-danger-text)]",
    };
  }

  if (status === "failed") {
    return {
      label: "无效",
      className: "bg-[var(--surface-soft-strong)] text-[var(--color-text-secondary)]",
    };
  }

  return {
    label: "待验证",
    className: "bg-[var(--color-bg-brand-soft)] text-[var(--color-brand)]",
  };
}

function formatDelta(entry: { before: number; after?: number | null; reverse?: boolean }) {
  if (typeof entry.after !== "number" || !Number.isFinite(entry.after)) {
    return "—";
  }

  const delta = entry.reverse ? entry.before - entry.after : entry.after - entry.before;
  return formatGrowthDeltaBadge(delta);
}

function ExperienceLibraryPanelInner() {
  const agents = useAgentStore((state) => state.agents);
  const entries = useExperienceStore((state) => state.entries);

  const groups = useMemo(() => {
    const agentMap = new Map(agents.map((agent) => [agent.id, agent]));
    const statuses = ["verified", "pending", "rolled_back", "failed"] as const;

    return statuses.map((status) => ({
      status,
      entries: entries
        .filter((entry) => entry.status === status)
        .toSorted((left, right) => right.createdAt - left.createdAt)
        .map((entry) => ({
          ...entry,
          sourceName: agentMap.get(entry.source)?.name ?? entry.source,
        })),
    }));
  }, [agents, entries]);

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[24px] border border-[var(--modal-shell-border)] bg-[var(--surface-glass)] backdrop-blur-xl">
      <div className="border-b border-[var(--divider)] px-5 py-4">
        <h2 className="text-[22px] font-semibold tracking-tight text-[var(--color-text-primary)]">
          📚 经验库
        </h2>
        <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
          已验证的方法会沉淀成全员可复用的最佳实践。
        </div>
      </div>

      <div className="im-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-5">
          {groups.map((group) => {
            const statusMeta = resolveStatusMeta(group.status);
            return (
              <div key={group.status}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {statusMeta.label}
                  </div>
                  <div className="text-xs text-[var(--color-text-secondary)]">
                    {group.entries.length} 条
                  </div>
                </div>

                {group.entries.length > 0 ? (
                  <div className="space-y-3">
                    {group.entries.map((entry) => (
                      <article
                        key={entry.id}
                        className="rounded-[22px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                                {entry.sourceName}
                              </div>
                              <span
                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusMeta.className}`}
                              >
                                {statusMeta.label}
                              </span>
                            </div>
                            <div className="mt-2 text-sm leading-7 text-[var(--color-text-secondary)]">
                              {entry.suggestion}
                            </div>
                          </div>
                          <div className="shrink-0 text-right text-xs text-[var(--color-text-secondary)]">
                            <div>{new Date(entry.createdAt).toLocaleDateString("zh-CN")}</div>
                            <div className="mt-1">#{entry.id.slice(0, 5)}</div>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-3 py-3">
                            <div className="text-[11px] text-[var(--color-text-secondary)]">
                              响应速度
                            </div>
                            <div className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
                              {formatDelta({
                                before: entry.metrics.before.avgResponseMs ?? 0,
                                after: entry.metrics.after?.avgResponseMs ?? null,
                                reverse: true,
                              })}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-3 py-3">
                            <div className="text-[11px] text-[var(--color-text-secondary)]">
                              错误次数
                            </div>
                            <div className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
                              {formatDelta({
                                before: entry.metrics.before.errorCount,
                                after: entry.metrics.after?.errorCount ?? null,
                                reverse: true,
                              })}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-3 py-3">
                            <div className="text-[11px] text-[var(--color-text-secondary)]">
                              Token 效率
                            </div>
                            <div className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
                              {formatDelta({
                                before: entry.metrics.before.tokenEfficiency ?? 0,
                                after: entry.metrics.after?.tokenEfficiency ?? null,
                              })}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                          <span>已推广给：</span>
                          {entry.appliedTo.length > 0 ? (
                            entry.appliedTo.map((agentId) => (
                              <span
                                key={agentId}
                                className="rounded-full border border-[var(--color-border)] px-2.5 py-1"
                              >
                                {agents.find((agent) => agent.id === agentId)?.name ?? agentId}
                              </span>
                            ))
                          ) : (
                            <span>暂未推广</span>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[22px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">
                    当前分组还没有经验条目
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export const ExperienceLibraryPanel = memo(ExperienceLibraryPanelInner);
ExperienceLibraryPanel.displayName = "ExperienceLibraryPanel";
