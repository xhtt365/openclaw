"use client";

import { Bot, Clock3, Loader2, Lock, MessageSquareText, Repeat, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { GatewayCronJob } from "@/services/gateway";
import { useAgentStore } from "@/stores/agentStore";
import { useCronStore, type CronUpsertInput } from "@/stores/cronStore";
import { useGroupStore } from "@/stores/groupStore";
import {
  buildCronScheduleFromDraft,
  createDefaultCronScheduleDraft,
  decodeXiabanCronMeta,
  getDefaultCronTimezone,
  resolveCronScheduleDraft,
  resolveCronScheduleSummary,
  type CronFrequencyPreset,
  type XiabanCronReplyMode,
} from "@/utils/cronTask";

type CronTaskFormPanelProps = {
  job?: GatewayCronJob | null;
  lockedAgentId?: string | null;
  defaultReplyMode?: XiabanCronReplyMode;
  defaultGroupId?: string | null;
  title?: string;
  description?: string;
  className?: string;
  showFooterBorder?: boolean;
  showCancelButton?: boolean;
  resetAfterSave?: boolean;
  onCancel?: () => void;
  onSaved?: (job: GatewayCronJob) => void;
};

type CronTaskFormState = CronUpsertInput;

const INPUT_CLASS_NAME =
  "h-11 rounded-2xl border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]";
const TEXTAREA_CLASS_NAME =
  "min-h-[132px] rounded-[20px] border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]";

const FREQUENCY_OPTIONS: Array<{
  value: CronFrequencyPreset;
  title: string;
  description: string;
}> = [
  {
    value: "daily",
    title: "每天",
    description: "每天固定时刻执行",
  },
  {
    value: "weekly",
    title: "每周",
    description: "按星期几循环",
  },
  {
    value: "intervalHours",
    title: "每隔 N 小时",
    description: "按间隔循环执行",
  },
  {
    value: "custom",
    title: "自定义",
    description: "手填 cron 表达式",
  },
];

const REPLY_MODE_OPTIONS: Array<{
  value: XiabanCronReplyMode;
  title: string;
  description: string;
  icon: typeof MessageSquareText;
}> = [
  {
    value: "direct",
    title: "发到当前 1v1 聊天",
    description: "员工会把结果回到自己的私聊窗口",
    icon: MessageSquareText,
  },
  {
    value: "group",
    title: "发到指定群聊",
    description: "任务完成后把回复同步到目标群聊",
    icon: Users,
  },
  {
    value: "silent",
    title: "仅执行不发送",
    description: "只跑任务，不往聊天窗口落消息",
    icon: Clock3,
  },
];

function buildInitialCronTaskFormState(params: {
  job?: GatewayCronJob | null;
  lockedAgentId?: string | null;
  defaultReplyMode?: XiabanCronReplyMode;
  defaultGroupId?: string | null;
}): CronTaskFormState {
  const meta = decodeXiabanCronMeta(params.job?.description);
  const agentId = params.lockedAgentId?.trim() || params.job?.agentId?.trim() || "";
  const replyMode = meta?.replyMode ?? params.defaultReplyMode ?? "direct";
  const defaultScheduleDraft = createDefaultCronScheduleDraft();

  return {
    name: params.job?.name?.trim() || "",
    agentId,
    instruction:
      params.job?.payload?.kind === "agentTurn" ? params.job.payload.message?.trim() || "" : "",
    replyMode,
    groupId:
      replyMode === "group"
        ? meta?.groupId?.trim() || params.defaultGroupId?.trim() || ""
        : params.defaultGroupId?.trim() || "",
    enabled: params.job?.enabled ?? true,
    scheduleDraft: params.job?.schedule
      ? resolveCronScheduleDraft(params.job.schedule)
      : {
          ...defaultScheduleDraft,
          timezone: getDefaultCronTimezone(),
        },
  };
}

type CronTaskFormPanelInnerProps = CronTaskFormPanelProps & {
  initialForm: CronTaskFormState;
};

function CronTaskFormPanelInner({
  initialForm,
  job = null,
  lockedAgentId = null,
  defaultReplyMode = "direct",
  defaultGroupId = null,
  title,
  description,
  className,
  showFooterBorder = true,
  showCancelButton = true,
  resetAfterSave = false,
  onCancel,
  onSaved,
}: CronTaskFormPanelInnerProps) {
  const agents = useAgentStore((state) => state.agents);
  const groups = useGroupStore((state) => state.groups);
  const submitting = useCronStore((state) => state.submitting);
  const createJob = useCronStore((state) => state.createJob);
  const updateJob = useCronStore((state) => state.updateJob);
  const [form, setForm] = useState<CronTaskFormState>(initialForm);

  const isEditMode = Boolean(job);
  const lockedAgent = lockedAgentId?.trim() || "";
  const canSelectGroup = groups.length > 0;

  const schedulePreview = useMemo(() => {
    try {
      return resolveCronScheduleSummary(buildCronScheduleFromDraft(form.scheduleDraft));
    } catch (error) {
      return error instanceof Error ? error.message : "频率配置有误";
    }
  }, [form.scheduleDraft]);

  const selectedAgentName =
    agents.find((agent) => agent.id === form.agentId)?.name?.trim() || form.agentId || "未选择员工";
  const targetGroupName =
    groups.find((group) => group.id === form.groupId)?.name?.trim() || form.groupId || "未选择群聊";

  function patchForm(patch: Partial<CronTaskFormState>) {
    setForm((current) => ({
      ...current,
      ...patch,
    }));
  }

  function patchScheduleDraft(patch: Partial<CronTaskFormState["scheduleDraft"]>) {
    setForm((current) => ({
      ...current,
      scheduleDraft: {
        ...current.scheduleDraft,
        ...patch,
      },
    }));
  }

  async function handleSubmit() {
    try {
      const payload: CronUpsertInput = {
        ...form,
        name: form.name.trim(),
        agentId: (lockedAgent || form.agentId).trim(),
        instruction: form.instruction.trim(),
        groupId: form.groupId?.trim() || undefined,
      };

      const savedJob = job ? await updateJob(job.id, payload) : await createJob(payload);

      toast({
        title: job ? "定时任务已更新" : "定时任务已创建",
        description: `${payload.name} · ${selectedAgentName}`,
      });

      if (!job && resetAfterSave) {
        setForm(
          buildInitialCronTaskFormState({
            lockedAgentId,
            defaultReplyMode,
            defaultGroupId,
          }),
        );
      }

      onSaved?.(savedJob);
    } catch (error) {
      toast({
        title: job ? "保存任务失败" : "创建任务失败",
        description: error instanceof Error && error.message.trim() ? error.message : "请稍后重试",
        variant: "destructive",
      });
    }
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {title || description ? (
        <div className="mb-4">
          {title ? (
            <div className="text-base font-semibold text-[var(--color-text-primary)]">{title}</div>
          ) : null}
          {description ? (
            <div className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">
              {description}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="im-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-5 pr-1">
          <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
            <label className="block">
              <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                任务名称
              </div>
              <Input
                value={form.name}
                onChange={(event) => {
                  patchForm({ name: event.target.value });
                }}
                placeholder="例如：每天 09:00 工作汇报"
                className={INPUT_CLASS_NAME}
                autoFocus={!isEditMode}
              />
            </label>

            <label className="block">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                <span>执行员工</span>
                {lockedAgent ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-soft)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
                    <Lock className="h-3 w-3" />
                    已锁定
                  </span>
                ) : null}
              </div>
              <div className="relative">
                <select
                  value={lockedAgent || form.agentId}
                  disabled={Boolean(lockedAgent)}
                  onChange={(event) => {
                    patchForm({ agentId: event.target.value });
                  }}
                  className={cn(
                    INPUT_CLASS_NAME,
                    "w-full appearance-none pr-10",
                    lockedAgent ? "cursor-not-allowed opacity-80" : "",
                  )}
                >
                  <option value="">请选择员工</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
                <Bot className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
              </div>
            </label>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
              <Repeat className="h-4 w-4 text-[var(--color-brand)]" />
              <span>执行频率</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {FREQUENCY_OPTIONS.map((option) => {
                const active = form.scheduleDraft.mode === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      patchScheduleDraft({ mode: option.value });
                    }}
                    className={cn(
                      "rounded-[20px] border px-4 py-3 text-left transition-all",
                      active
                        ? "border-[var(--color-brand)] bg-[var(--color-bg-brand-soft)] shadow-[0_0_0_1px_var(--accent-glow)]"
                        : "border-[var(--color-border)] bg-[var(--color-bg-card)] hover:bg-[var(--color-bg-hover)]",
                    )}
                  >
                    <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                      {option.title}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                      {option.description}
                    </div>
                  </button>
                );
              })}
            </div>

            {form.scheduleDraft.mode === "custom" ? (
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                <label className="block">
                  <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                    Cron 表达式
                  </div>
                  <Input
                    value={form.scheduleDraft.expr}
                    onChange={(event) => {
                      patchScheduleDraft({ expr: event.target.value });
                    }}
                    placeholder="例如：0 9 * * *"
                    className={INPUT_CLASS_NAME}
                  />
                </label>
                <label className="block">
                  <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                    时区
                  </div>
                  <Input
                    value={form.scheduleDraft.timezone}
                    onChange={(event) => {
                      patchScheduleDraft({ timezone: event.target.value });
                    }}
                    placeholder="Asia/Shanghai"
                    className={INPUT_CLASS_NAME}
                  />
                </label>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <label className="block">
                  <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                    执行时间
                  </div>
                  <Input
                    type="time"
                    value={form.scheduleDraft.time}
                    onChange={(event) => {
                      patchScheduleDraft({ time: event.target.value });
                    }}
                    className={INPUT_CLASS_NAME}
                  />
                </label>

                {form.scheduleDraft.mode === "weekly" ? (
                  <label className="block">
                    <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                      星期
                    </div>
                    <select
                      value={form.scheduleDraft.weekday}
                      onChange={(event) => {
                        patchScheduleDraft({ weekday: event.target.value });
                      }}
                      className={cn(INPUT_CLASS_NAME, "w-full appearance-none")}
                    >
                      <option value="1">周一</option>
                      <option value="2">周二</option>
                      <option value="3">周三</option>
                      <option value="4">周四</option>
                      <option value="5">周五</option>
                      <option value="6">周六</option>
                      <option value="0">周日</option>
                    </select>
                  </label>
                ) : null}

                {form.scheduleDraft.mode === "intervalHours" ? (
                  <label className="block">
                    <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                      间隔小时数
                    </div>
                    <Input
                      type="number"
                      min={1}
                      max={168}
                      value={String(form.scheduleDraft.intervalHours)}
                      onChange={(event) => {
                        patchScheduleDraft({
                          intervalHours: Math.max(1, Number(event.target.value) || 1),
                        });
                      }}
                      className={INPUT_CLASS_NAME}
                    />
                  </label>
                ) : null}

                {(form.scheduleDraft.mode === "daily" || form.scheduleDraft.mode === "weekly") && (
                  <label className="block">
                    <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                      时区
                    </div>
                    <Input
                      value={form.scheduleDraft.timezone}
                      onChange={(event) => {
                        patchScheduleDraft({ timezone: event.target.value });
                      }}
                      className={INPUT_CLASS_NAME}
                    />
                  </label>
                )}
              </div>
            )}

            <div className="rounded-[20px] border border-[var(--color-border)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
              <div className="font-medium text-[var(--color-text-primary)]">频率预览</div>
              <div className="mt-1 leading-6">{schedulePreview}</div>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
              <MessageSquareText className="h-4 w-4 text-[var(--color-brand)]" />
              <span>任务指令</span>
            </div>
            <Textarea
              value={form.instruction}
              onChange={(event) => {
                patchForm({ instruction: event.target.value });
              }}
              placeholder="这段文字会作为系统消息发给员工，例如：请整理昨晚到现在的项目进展，输出三段式晨报。"
              className={TEXTAREA_CLASS_NAME}
            />
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
              <Users className="h-4 w-4 text-[var(--color-brand)]" />
              <span>回复方式</span>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {REPLY_MODE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const active = form.replyMode === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      patchForm({
                        replyMode: option.value,
                        groupId:
                          option.value === "group"
                            ? form.groupId || defaultGroupId?.trim() || ""
                            : form.groupId,
                      });
                    }}
                    className={cn(
                      "rounded-[20px] border px-4 py-3 text-left transition-all",
                      active
                        ? "border-[var(--color-brand)] bg-[var(--color-bg-brand-soft)] shadow-[0_0_0_1px_var(--accent-glow)]"
                        : "border-[var(--color-border)] bg-[var(--color-bg-card)] hover:bg-[var(--color-bg-hover)]",
                    )}
                  >
                    <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                      <Icon className="h-4 w-4 text-[var(--color-brand)]" />
                      <span>{option.title}</span>
                    </div>
                    <div className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                      {option.description}
                    </div>
                  </button>
                );
              })}
            </div>

            {form.replyMode === "group" ? (
              <label className="block">
                <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                  目标群聊
                </div>
                <select
                  value={form.groupId || ""}
                  disabled={!canSelectGroup}
                  onChange={(event) => {
                    patchForm({ groupId: event.target.value });
                  }}
                  className={cn(
                    INPUT_CLASS_NAME,
                    "w-full appearance-none",
                    !canSelectGroup ? "cursor-not-allowed opacity-80" : "",
                  )}
                >
                  <option value="">{canSelectGroup ? "请选择群聊" : "当前没有可选群聊"}</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </section>

          <section className="grid gap-4 rounded-[22px] border border-[var(--color-border)] bg-[var(--surface-soft)] px-4 py-4 md:grid-cols-3">
            <div>
              <div className="text-xs font-medium tracking-[0.08em] text-[var(--color-text-secondary)]">
                执行员工
              </div>
              <div className="mt-2 text-sm font-semibold text-[var(--color-text-primary)]">
                {selectedAgentName}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium tracking-[0.08em] text-[var(--color-text-secondary)]">
                回复落点
              </div>
              <div className="mt-2 text-sm font-semibold text-[var(--color-text-primary)]">
                {form.replyMode === "group"
                  ? targetGroupName
                  : form.replyMode === "silent"
                    ? "仅执行"
                    : "员工 1v1"}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium tracking-[0.08em] text-[var(--color-text-secondary)]">
                当前状态
              </div>
              <div className="mt-2 text-sm font-semibold text-[var(--color-text-primary)]">
                {form.enabled === false ? "暂停" : "启用"}
              </div>
            </div>
          </section>
        </div>
      </div>

      <div
        className={cn(
          "flex items-center justify-end gap-3 pt-5",
          showFooterBorder ? "mt-5 border-t border-[var(--modal-shell-border)]" : "",
        )}
      >
        {showCancelButton ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-2xl"
          >
            取消
          </Button>
        ) : null}
        <Button
          type="button"
          onClick={() => {
            void handleSubmit();
          }}
          disabled={submitting}
          className="rounded-2xl bg-[var(--color-brand)] text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-light)]"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isEditMode ? "保存修改" : "创建任务"}
        </Button>
      </div>
    </div>
  );
}

function buildCronTaskFormResetKey(params: {
  job?: GatewayCronJob | null;
  lockedAgentId?: string | null;
  defaultReplyMode?: XiabanCronReplyMode;
  defaultGroupId?: string | null;
}) {
  const instruction =
    params.job?.payload?.kind === "agentTurn" ? params.job.payload.message?.trim() || "" : "";

  return [
    params.job?.id?.trim() || "new",
    params.job?.name?.trim() || "",
    params.job?.description?.trim() || "",
    params.job?.agentId?.trim() || "",
    instruction,
    params.job?.enabled === false ? "disabled" : "enabled",
    JSON.stringify(params.job?.schedule ?? null),
    params.lockedAgentId?.trim() || "",
    params.defaultReplyMode ?? "direct",
    params.defaultGroupId?.trim() || "",
  ].join("::");
}

export function CronTaskFormPanel({
  job = null,
  lockedAgentId = null,
  defaultReplyMode = "direct",
  defaultGroupId = null,
  title,
  description,
  className,
  showFooterBorder = true,
  showCancelButton = true,
  resetAfterSave = false,
  onCancel,
  onSaved,
}: CronTaskFormPanelProps) {
  const initialForm = useMemo(
    () =>
      buildInitialCronTaskFormState({
        job,
        lockedAgentId,
        defaultReplyMode,
        defaultGroupId,
      }),
    [defaultGroupId, defaultReplyMode, job, lockedAgentId],
  );
  const resetKey = useMemo(
    () =>
      buildCronTaskFormResetKey({
        job,
        lockedAgentId,
        defaultReplyMode,
        defaultGroupId,
      }),
    [defaultGroupId, defaultReplyMode, job, lockedAgentId],
  );

  return (
    <CronTaskFormPanelInner
      key={resetKey}
      initialForm={initialForm}
      job={job}
      lockedAgentId={lockedAgentId}
      defaultReplyMode={defaultReplyMode}
      defaultGroupId={defaultGroupId}
      title={title}
      description={description}
      className={className}
      showFooterBorder={showFooterBorder}
      showCancelButton={showCancelButton}
      resetAfterSave={resetAfterSave}
      onCancel={onCancel}
      onSaved={onSaved}
    />
  );
}
