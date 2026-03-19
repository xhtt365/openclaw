"use client";

import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pause,
  Pencil,
  Play,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { GatewayCronJob } from "@/services/gateway";
import { useAgentStore } from "@/stores/agentStore";
import { useCronStore } from "@/stores/cronStore";
import { useGroupStore } from "@/stores/groupStore";
import { getAgentAvatarInfo } from "@/utils/agentAvatar";
import {
  decodeXiabanCronMeta,
  isEditableXiabanCronJob,
  resolveCronDisplayStatus,
  resolveCronLastRunText,
  resolveCronNextRunText,
  resolveCronReplyTargetLabel,
  resolveCronScheduleSummary,
  resolveCronStatusLabel,
  type XiabanCronReplyMode,
} from "@/utils/cronTask";
import { CronTaskModal } from "./CronTaskModal";

type CronTaskListProps = {
  jobs: GatewayCronJob[];
  title?: string;
  description?: string;
  createLabel?: string;
  emptyText: string;
  showAgent?: boolean;
  lockedAgentId?: string | null;
  defaultReplyMode?: XiabanCronReplyMode;
  defaultGroupId?: string | null;
  className?: string;
};

function resolveStatusClasses(job: GatewayCronJob) {
  const status = resolveCronDisplayStatus(job);
  if (status === "ERROR") {
    return "bg-[var(--surface-danger-soft)] text-[var(--surface-danger-text)]";
  }

  if (status === "STOPPED") {
    return "bg-[var(--surface-soft-strong)] text-[var(--color-text-secondary)]";
  }

  return "bg-[var(--surface-success-soft)] text-[var(--surface-success-text)]";
}

export function CronTaskList({
  jobs,
  title,
  description,
  createLabel,
  emptyText,
  showAgent = false,
  lockedAgentId = null,
  defaultReplyMode = "direct",
  defaultGroupId = null,
  className,
}: CronTaskListProps) {
  const agents = useAgentStore((state) => state.agents);
  const groups = useGroupStore((state) => state.groups);
  const runsByJobId = useCronStore((state) => state.runsByJobId);
  const runsLoadingByJobId = useCronStore((state) => state.runsLoadingByJobId);
  const mutatingJobIds = useCronStore((state) => state.mutatingJobIds);
  const fetchJobRuns = useCronStore((state) => state.fetchJobRuns);
  const pauseJob = useCronStore((state) => state.pauseJob);
  const resumeJob = useCronStore((state) => state.resumeJob);
  const deleteJob = useCronStore((state) => state.deleteJob);
  const [expandedJobIds, setExpandedJobIds] = useState<string[]>([]);
  const [editingJob, setEditingJob] = useState<GatewayCronJob | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pendingDeleteJob, setPendingDeleteJob] = useState<GatewayCronJob | null>(null);

  const agentMap = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);

  async function handleToggleExpand(job: GatewayCronJob) {
    const isExpanded = expandedJobIds.includes(job.id);
    setExpandedJobIds((current) =>
      isExpanded ? current.filter((id) => id !== job.id) : [...current, job.id],
    );

    if (!isExpanded && !runsByJobId[job.id] && !runsLoadingByJobId[job.id]) {
      try {
        await fetchJobRuns(job.id, 5);
      } catch (error) {
        toast({
          title: "读取执行记录失败",
          description:
            error instanceof Error && error.message.trim() ? error.message : "请稍后重试",
          variant: "destructive",
        });
      }
    }
  }

  async function handleToggleEnabled(job: GatewayCronJob) {
    try {
      if (job.enabled === false) {
        await resumeJob(job.id);
        toast({
          title: "任务已恢复",
          description: job.name,
        });
        return;
      }

      await pauseJob(job.id);
      toast({
        title: "任务已暂停",
        description: job.name,
      });
    } catch (error) {
      toast({
        title: job.enabled === false ? "恢复失败" : "暂停失败",
        description: error instanceof Error && error.message.trim() ? error.message : "请稍后重试",
        variant: "destructive",
      });
    }
  }

  async function handleDeleteJob() {
    if (!pendingDeleteJob) {
      return;
    }

    try {
      await deleteJob(pendingDeleteJob.id);
      toast({
        title: "任务已删除",
        description: pendingDeleteJob.name,
      });
      setPendingDeleteJob(null);
    } catch (error) {
      toast({
        title: "删除失败",
        description: error instanceof Error && error.message.trim() ? error.message : "请稍后重试",
        variant: "destructive",
      });
    }
  }

  return (
    <>
      <div className={cn("flex min-h-0 flex-col", className)}>
        {title || description || createLabel ? (
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {title ? (
                <div className="flex items-center gap-2 text-base font-semibold text-[var(--color-text-primary)]">
                  <CalendarClock className="h-4.5 w-4.5 text-[var(--color-brand)]" />
                  <span>{title}</span>
                </div>
              ) : null}
              {description ? (
                <div className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">
                  {description}
                </div>
              ) : null}
            </div>

            {createLabel ? (
              <Button
                type="button"
                onClick={() => {
                  setShowCreateModal(true);
                }}
                className="shrink-0 rounded-2xl bg-[var(--color-brand)] text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-light)]"
              >
                + {createLabel}
              </Button>
            ) : null}
          </div>
        ) : null}

        <div
          className={cn("im-scroll mt-4 min-h-0 flex-1 overflow-y-auto", jobs.length ? "pr-1" : "")}
        >
          {jobs.length > 0 ? (
            <div className="space-y-3">
              {jobs.map((job) => {
                const expanded = expandedJobIds.includes(job.id);
                const agent = job.agentId ? agentMap.get(job.agentId) : null;
                const agentAvatar = job.agentId
                  ? getAgentAvatarInfo(
                      job.agentId,
                      agent?.avatarUrl ?? agent?.emoji,
                      agent?.name || job.agentId,
                    )
                  : null;
                const meta = decodeXiabanCronMeta(job.description);
                const runs = runsByJobId[job.id] ?? [];
                const loadingRuns = runsLoadingByJobId[job.id];
                const mutating = mutatingJobIds.includes(job.id);
                const editable = isEditableXiabanCronJob(job);

                return (
                  <div
                    key={job.id}
                    className="overflow-hidden rounded-[22px] border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-[var(--shadow-sm)]"
                  >
                    <div className="flex items-start gap-3 px-4 py-4">
                      <button
                        type="button"
                        onClick={() => {
                          void handleToggleExpand(job);
                        }}
                        className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--surface-soft)] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
                        title={expanded ? "收起详情" : "展开详情"}
                      >
                        {expanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                            {job.name?.trim() || job.id}
                          </div>
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide",
                              resolveStatusClasses(job),
                            )}
                          >
                            {resolveCronStatusLabel(resolveCronDisplayStatus(job))}
                          </span>
                          {!editable ? (
                            <span className="rounded-full bg-[var(--surface-soft)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)]">
                              网关原生任务
                            </span>
                          ) : null}
                        </div>

                        {showAgent && agent ? (
                          <div className="mt-2 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                            <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-[var(--color-border)] bg-[var(--surface-soft)] text-xs">
                              {agentAvatar?.type === "image" ? (
                                <img
                                  src={agentAvatar.value}
                                  alt={agent.name}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <span>{agentAvatar?.value ?? agent.name.charAt(0)}</span>
                              )}
                            </span>
                            <span className="truncate">{agent.name}</span>
                          </div>
                        ) : null}

                        <div className="mt-3 grid gap-2 text-xs text-[var(--color-text-secondary)] sm:grid-cols-3">
                          <div>
                            <div className="font-medium text-[var(--color-text-primary)]">
                              下次执行
                            </div>
                            <div className="mt-1">{resolveCronNextRunText(job)}</div>
                          </div>
                          <div>
                            <div className="font-medium text-[var(--color-text-primary)]">
                              执行频率
                            </div>
                            <div className="mt-1">{resolveCronScheduleSummary(job.schedule)}</div>
                          </div>
                          <div>
                            <div className="font-medium text-[var(--color-text-primary)]">
                              回复方式
                            </div>
                            <div className="mt-1">{resolveCronReplyTargetLabel(meta, groups)}</div>
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          className="rounded-full border border-[var(--color-border)] bg-[var(--surface-soft)]"
                          onClick={() => {
                            void handleToggleEnabled(job);
                          }}
                          disabled={mutating}
                          title={job.enabled === false ? "恢复任务" : "暂停任务"}
                        >
                          {mutating ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : job.enabled === false ? (
                            <Play className="h-4 w-4" />
                          ) : (
                            <Pause className="h-4 w-4" />
                          )}
                        </Button>

                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          className="rounded-full border border-[var(--color-border)] bg-[var(--surface-soft)]"
                          onClick={() => {
                            setEditingJob(job);
                          }}
                          disabled={!editable || mutating}
                          title={editable ? "编辑任务" : "当前任务类型暂不支持编辑"}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>

                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          className="rounded-full border border-[var(--surface-danger-border)] bg-[var(--surface-danger-soft)] text-[var(--surface-danger-text)] hover:bg-[var(--surface-danger-soft)]"
                          onClick={() => {
                            setPendingDeleteJob(job);
                          }}
                          disabled={mutating}
                          title="删除任务"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {expanded ? (
                      <div className="border-t border-[var(--color-border)] bg-[var(--surface-soft)] px-4 py-4">
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                          <div className="space-y-3">
                            <div>
                              <div className="text-xs font-medium tracking-[0.08em] text-[var(--color-text-secondary)]">
                                任务指令
                              </div>
                              <div className="mt-2 rounded-[18px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-3 text-sm leading-7 text-[var(--color-text-primary)]">
                                {job.payload?.kind === "agentTurn"
                                  ? job.payload.message?.trim() || "暂无指令"
                                  : "当前任务类型不是虾班可编辑任务"}
                              </div>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="rounded-[18px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-3">
                                <div className="text-xs font-medium tracking-[0.08em] text-[var(--color-text-secondary)]">
                                  最近执行
                                </div>
                                <div className="mt-2 text-sm text-[var(--color-text-primary)]">
                                  {resolveCronLastRunText(job)}
                                </div>
                              </div>
                              <div className="rounded-[18px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-3">
                                <div className="text-xs font-medium tracking-[0.08em] text-[var(--color-text-secondary)]">
                                  最近状态
                                </div>
                                <div className="mt-2 text-sm text-[var(--color-text-primary)]">
                                  {job.state?.lastError?.trim()
                                    ? job.state.lastError.trim()
                                    : job.state?.lastRunStatus || "暂无"}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div>
                            <div className="text-xs font-medium tracking-[0.08em] text-[var(--color-text-secondary)]">
                              最近几次执行记录
                            </div>

                            <div className="mt-2 space-y-2">
                              {loadingRuns ? (
                                <div className="flex items-center gap-2 rounded-[18px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-4 text-sm text-[var(--color-text-secondary)]">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  正在加载执行记录...
                                </div>
                              ) : runs.length > 0 ? (
                                runs.map((run) => (
                                  <div
                                    key={`${job.id}:${run.ts}:${run.sessionId ?? run.summary ?? ""}`}
                                    className="rounded-[18px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-3"
                                  >
                                    <div className="flex items-center justify-between gap-3 text-sm">
                                      <span className="font-medium text-[var(--color-text-primary)]">
                                        {run.status === "error"
                                          ? "执行失败"
                                          : run.status === "skipped"
                                            ? "已跳过"
                                            : "执行完成"}
                                      </span>
                                      <span className="text-[var(--color-text-secondary)]">
                                        {new Date(run.ts).toLocaleString("zh-CN", {
                                          month: "2-digit",
                                          day: "2-digit",
                                          hour: "2-digit",
                                          minute: "2-digit",
                                        })}
                                      </span>
                                    </div>
                                    <div className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
                                      {run.summary?.trim() ||
                                        run.error?.trim() ||
                                        "这次执行没有返回摘要"}
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <div className="rounded-[18px] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-4 text-sm text-[var(--color-text-secondary)]">
                                  暂无执行记录
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex h-full min-h-[160px] items-center justify-center rounded-[22px] border border-dashed border-[var(--color-border)] bg-[var(--surface-soft)] px-4 text-sm text-[var(--color-text-secondary)]">
              {emptyText}
            </div>
          )}
        </div>
      </div>

      <CronTaskModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        lockedAgentId={lockedAgentId}
        defaultReplyMode={defaultReplyMode}
        defaultGroupId={defaultGroupId}
      />

      <CronTaskModal
        open={Boolean(editingJob)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setEditingJob(null);
          }
        }}
        job={editingJob}
        lockedAgentId={lockedAgentId}
      />

      <ConfirmModal
        open={Boolean(pendingDeleteJob)}
        onClose={() => {
          setPendingDeleteJob(null);
        }}
        onConfirm={() => {
          void handleDeleteJob();
        }}
        loading={pendingDeleteJob ? mutatingJobIds.includes(pendingDeleteJob.id) : false}
        icon="⏰"
        iconBgColor="bg-[var(--warn-subtle)]"
        iconTextColor="text-[var(--warn)]"
        title="删除定时任务"
        subtitle={pendingDeleteJob?.name || ""}
        description="删除后不会自动恢复，Gateway 中的这条 cron 任务也会被一并移除。"
        confirmText="确认删除"
        confirmColor="bg-[var(--warn)] hover:brightness-110"
      />
    </>
  );
}
