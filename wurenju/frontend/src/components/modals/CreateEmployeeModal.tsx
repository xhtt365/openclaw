"use client";

import { Check, ChevronLeft, ChevronRight, Loader2, Search, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buildDefaultAgentFiles } from "@/constants/agentTemplates";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { gateway, type GatewayAgentUpdateParams } from "@/services/gateway";
import { useAgentStore } from "@/stores/agentStore";
import type { ModelProviderGroup } from "@/types/model";
import { buildAvailableAgentId } from "@/utils/agentId";

const EMPLOYEE_EMOJIS = [
  "🧑‍💻",
  "👩‍🎨",
  "👨‍🔬",
  "👩‍💼",
  "🧑‍🏫",
  "👨‍⚕️",
  "🦊",
  "🐱",
  "🐶",
  "🦄",
  "🤖",
  "👾",
] as const;

const STEP_ITEMS = [
  { id: 1, label: "1. 基本信息" },
  { id: 2, label: "2. 选择模型" },
  { id: 3, label: "3. 确认创建" },
] as const;

type Step = 1 | 2 | 3;
type CreatingStep = "idle" | "creating" | "writing-files" | "done" | "error";

type EmployeeFormState = {
  displayName: string;
  role: string;
  bio: string;
  emoji: (typeof EMPLOYEE_EMOJIS)[number];
};

const INITIAL_FORM_STATE: EmployeeFormState = {
  displayName: "",
  role: "",
  bio: "",
  emoji: EMPLOYEE_EMOJIS[0],
};

function joinGatewayPath(baseDir: string, leaf: string) {
  const trimmed = baseDir.replace(/[\\/]+$/g, "");
  const separator = trimmed.includes("\\") ? "\\" : "/";
  return `${trimmed}${separator}${leaf}`;
}

function resolveAgentWorkspace(agentId: string, stateDir: string | null) {
  const baseDir = stateDir?.trim() ? stateDir.trim() : "~/.openclaw";
  return joinGatewayPath(baseDir, `workspace-${agentId}`);
}

function getCreatingStepLabel(step: CreatingStep) {
  switch (step) {
    case "creating":
      return "正在创建员工...";
    case "writing-files":
      return "正在初始化配置文件...";
    case "done":
      return "创建完成 ✅";
    case "error":
      return "创建失败";
    default:
      return "";
  }
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function StepIndicator({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-3">
      {STEP_ITEMS.map((item, index) => {
        const isCompleted = step > item.id;
        const isActive = step === item.id;

        return (
          <div key={item.id} className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                  isCompleted && "border-primary bg-primary text-primary-foreground",
                  isActive &&
                    "border-primary bg-primary/12 text-primary shadow-[0_0_0_1px_var(--color-brand-glow)]",
                  !isCompleted &&
                    !isActive &&
                    "border-border bg-[var(--color-bg-card)] text-muted-foreground",
                )}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : item.id}
              </span>
              <span
                className={cn(
                  "truncate text-sm transition-colors",
                  isActive && "font-semibold text-primary",
                  isCompleted && "font-medium text-foreground",
                  !isCompleted && !isActive && "text-muted-foreground",
                )}
              >
                {item.label}
              </span>
            </div>

            {index < STEP_ITEMS.length - 1 ? (
              <div
                className={cn(
                  "h-px flex-1 transition-colors",
                  step > item.id ? "bg-primary" : "bg-border",
                )}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ModelCard({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-[14px] border p-4 text-left transition-all",
        active
          ? "border-primary bg-primary/10 shadow-[0_0_0_1px_var(--color-brand-glow)]"
          : "border-border bg-[var(--color-bg-card)] hover:border-primary/40 hover:bg-[var(--color-bg-hover)]",
      )}
      aria-pressed={active}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{title}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
        </div>
        <span
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
            active ? "border-primary bg-primary text-primary-foreground" : "border-border",
          )}
        >
          {active ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
      </div>
    </button>
  );
}

export function CreateEmployeeModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fetchAgents = useAgentStore((state) => state.fetchAgents);
  const agents = useAgentStore((state) => state.agents);

  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<EmployeeFormState>(INITIAL_FORM_STATE);
  const [models, setModels] = useState<ModelProviderGroup[]>([]);
  const [modelQuery, setModelQuery] = useState("");
  const [selectedModelRef, setSelectedModelRef] = useState("");
  const [defaultModelLabel, setDefaultModelLabel] = useState("全局默认模型");
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [creatingStep, setCreatingStep] = useState<CreatingStep>("idle");
  const [draftAgentId, setDraftAgentId] = useState("");
  const [hasCreatedAgent, setHasCreatedAgent] = useState(false);

  const trimmedDisplayName = form.displayName.trim();
  const trimmedRole = form.role.trim();
  const finalBio = form.bio.trim() || "协助用户完成相关工作";
  const canContinueStep1 = Boolean(trimmedDisplayName) && Boolean(trimmedRole);

  useEffect(() => {
    if (!open) {
      return;
    }

    let active = true;

    const loadModelOptions = async () => {
      setIsLoadingModels(true);
      setModelsError("");

      const [modelsResult, configResult] = await Promise.allSettled([
        gateway.listModels(),
        gateway.getConfigSnapshot(),
      ]);

      if (!active) {
        return;
      }

      if (configResult.status === "fulfilled") {
        const nextDefaultModelLabel = gateway.getDefaultModelLabel(configResult.value);
        if (nextDefaultModelLabel) {
          setDefaultModelLabel(nextDefaultModelLabel);
        }
      }

      if (modelsResult.status === "fulfilled") {
        setModels(modelsResult.value);
      } else {
        console.error("[GW] models.list failed:", modelsResult.reason);
        setModels([]);
        setModelsError("模型列表暂时不可用，当前会使用全局默认模型。");
      }

      setIsLoadingModels(false);
    };

    void loadModelOptions();

    return () => {
      active = false;
    };
  }, [open]);

  const filteredModels = models
    .map((group) => {
      const keyword = modelQuery.trim().toLowerCase();
      if (!keyword) {
        return group;
      }

      const matchedModels = group.models.filter(
        (model) =>
          model.name.toLowerCase().includes(keyword) ||
          model.id.toLowerCase().includes(keyword) ||
          group.provider.toLowerCase().includes(keyword),
      );

      return {
        ...group,
        models: matchedModels,
      };
    })
    .filter((group) => group.models.length > 0);

  const selectedModel = models
    .flatMap((group) =>
      group.models.map((model) => ({
        ...model,
        provider: group.provider,
      })),
    )
    .find((model) => `${model.provider}/${model.id}` === selectedModelRef);
  const selectedModelLabel = selectedModel
    ? `${selectedModel.provider} / ${selectedModel.name}`
    : `使用全局默认模型${defaultModelLabel ? ` (${defaultModelLabel})` : ""}`;

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && isSubmitting) {
      return;
    }

    if (!nextOpen) {
      setStep(1);
      setForm(INITIAL_FORM_STATE);
      setModels([]);
      setModelQuery("");
      setSelectedModelRef("");
      setDefaultModelLabel("全局默认模型");
      setIsLoadingModels(false);
      setModelsError("");
      setSubmitError("");
      setIsSubmitting(false);
      setCreatingStep("idle");
      setDraftAgentId("");
      setHasCreatedAgent(false);
    }

    onOpenChange(nextOpen);
  }

  async function handleCreate() {
    if (!canContinueStep1 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");
    setCreatingStep("creating");

    let agentId =
      draftAgentId ||
      buildAvailableAgentId(
        trimmedDisplayName,
        agents.map((agent) => agent.id),
      );
    const workspace = resolveAgentWorkspace(agentId, gateway.getStateDir());

    try {
      // 中文显示名不能直接作为 agents.create 的 name，否则服务端会规范化成 main。
      if (!hasCreatedAgent) {
        const created = await gateway.createAgent({
          name: agentId,
          workspace,
          emoji: form.emoji,
        });
        agentId = created.agentId;
        setDraftAgentId(agentId);
        setHasCreatedAgent(true);
      }

      const updateParams: GatewayAgentUpdateParams = {
        name: trimmedDisplayName,
      };
      if (selectedModelRef) {
        updateParams.model = selectedModelRef;
      }

      await gateway.updateAgent(agentId, updateParams);
      setCreatingStep("writing-files");

      const defaultAgentFiles = buildDefaultAgentFiles({
        agentName: trimmedDisplayName,
        emoji: form.emoji,
        role: trimmedRole,
        description: finalBio,
      });

      await Promise.all(
        defaultAgentFiles.map(async (file) => {
          try {
            const ok = await gateway.saveAgentFile(agentId, file.name, file.content);
            if (!ok) {
              console.warn(`[Store] 文件写入失败: ${file.name}`);
            }
          } catch (error) {
            console.warn(`[Store] 文件写入失败: ${file.name}`, error);
          }
        }),
      );

      try {
        await fetchAgents();
      } catch (error) {
        console.warn("[Store] 员工列表刷新失败:", error);
      }

      setCreatingStep("done");

      setIsSubmitting(false);
      await wait(500);
      onOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim() ? error.message : "创建失败，请稍后重试";
      setSubmitError(message);
      setCreatingStep("error");
      console.error("[GW] create employee failed:", error);
      toast({
        variant: "destructive",
        title: "创建员工失败",
        description: message,
      });
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="overflow-hidden rounded-[20px] border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-0 text-[var(--color-text-primary)] shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:max-w-3xl">
        <div className="border-b border-border px-6 py-5">
          <DialogHeader className="gap-3 text-left">
            <DialogTitle className="text-xl">创建员工</DialogTitle>
            <DialogDescription>
              填好资料后，前端会直接调用 Gateway API 创建员工，无需终端命令，也不用重启 Gateway。
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5">
            <StepIndicator step={step} />
          </div>
        </div>

        <div className="im-scroll max-h-[72vh] overflow-y-auto px-6 py-5">
          {step === 1 ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <label
                  htmlFor="employee-display-name"
                  className="text-sm font-medium text-foreground"
                >
                  显示名
                </label>
                <Input
                  id="employee-display-name"
                  value={form.displayName}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      displayName: event.target.value,
                    }))
                  }
                  placeholder="周杰伦"
                  autoComplete="off"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="employee-role" className="text-sm font-medium text-foreground">
                  职位
                </label>
                <Input
                  id="employee-role"
                  value={form.role}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      role: event.target.value,
                    }))
                  }
                  placeholder="音乐大师"
                  autoComplete="off"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="employee-bio" className="text-sm font-medium text-foreground">
                  简介
                </label>
                <Textarea
                  id="employee-bio"
                  value={form.bio}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      bio: event.target.value,
                    }))
                  }
                  placeholder="一句话描述职责和风格"
                  rows={4}
                />
              </div>

              <div className="space-y-3">
                <div className="text-sm font-medium text-foreground">头像选择</div>
                <div className="grid grid-cols-6 gap-2">
                  {EMPLOYEE_EMOJIS.map((emoji) => {
                    const isSelected = form.emoji === emoji;

                    return (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            emoji,
                          }))
                        }
                        className={cn(
                          "flex h-12 items-center justify-center rounded-xl border text-2xl transition-all",
                          isSelected
                            ? "border-primary bg-primary/12 shadow-[0_0_0_1px_var(--color-brand-glow)]"
                            : "border-border bg-[var(--color-bg-card)] hover:border-primary/40 hover:bg-[var(--color-bg-hover)]",
                        )}
                        aria-label={`选择头像 ${emoji}`}
                        aria-pressed={isSelected}
                      >
                        {emoji}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-5">
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-foreground">选择员工使用的 AI 模型</h3>
                <p className="text-sm text-muted-foreground">
                  可以直接沿用全局默认模型，也可以为这个员工单独指定模型。
                </p>
              </div>

              <ModelCard
                active={selectedModelRef === ""}
                title="使用全局默认模型"
                description={
                  defaultModelLabel
                    ? `当前默认：${defaultModelLabel}`
                    : "由 Gateway 当前全局配置决定"
                }
                onClick={() => setSelectedModelRef("")}
              />

              {isLoadingModels ? (
                <div className="flex items-center gap-2 rounded-2xl border border-border bg-[var(--color-bg-card)] px-4 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在加载模型列表...
                </div>
              ) : null}

              {!isLoadingModels && models.length > 0 ? (
                <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={modelQuery}
                      onChange={(event) => setModelQuery(event.target.value)}
                      placeholder="搜索 provider、模型名或 model id"
                      className="pl-10"
                    />
                  </div>

                  <div className="space-y-4">
                    {filteredModels.length > 0 ? (
                      filteredModels.map((group) => (
                        <section key={group.provider} className="space-y-3">
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                            {group.provider}
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            {group.models.map((model) => (
                              <ModelCard
                                key={`${group.provider}/${model.id}`}
                                active={selectedModelRef === `${group.provider}/${model.id}`}
                                title={model.name}
                                description={`Model ID: ${group.provider}/${model.id}`}
                                onClick={() => setSelectedModelRef(`${group.provider}/${model.id}`)}
                              />
                            ))}
                          </div>
                        </section>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-border bg-[var(--color-bg-card)] px-4 py-6 text-sm text-muted-foreground">
                        没有找到匹配的模型，继续创建时会使用全局默认模型。
                      </div>
                    )}
                  </div>
                </>
              ) : null}

              {!isLoadingModels && models.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-[var(--color-bg-card)] px-4 py-6 text-sm text-muted-foreground">
                  {modelsError || "当前没有可选模型，将使用全局默认模型。"}
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-5">
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-foreground">确认创建</h3>
                <p className="text-sm text-muted-foreground">
                  确认后会立即写入 Gateway，并刷新左侧员工列表。
                </p>
              </div>

              <section className="rounded-[18px] border border-border bg-[var(--color-bg-card)] p-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-bg-secondary)] text-4xl shadow-sm">
                    {form.emoji}
                  </div>
                  <div className="min-w-0 space-y-4">
                    <div>
                      <div className="text-xl font-semibold text-foreground">
                        {trimmedDisplayName}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">{trimmedRole}</div>
                    </div>

                    <dl className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1">
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          简介
                        </dt>
                        <dd className="text-sm leading-6 text-foreground">{finalBio}</dd>
                      </div>

                      <div className="space-y-1">
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          模型
                        </dt>
                        <dd className="text-sm leading-6 text-foreground">{selectedModelLabel}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </section>

              {creatingStep !== "idle" ? (
                <div
                  className={cn(
                    "flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm",
                    creatingStep === "error"
                      ? "border-destructive/30 bg-destructive/5 text-destructive"
                      : creatingStep === "done"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
                        : "border-primary/20 bg-primary/8 text-primary",
                  )}
                >
                  {creatingStep === "creating" || creatingStep === "writing-files" ? (
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                  ) : creatingStep === "done" ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <div className="space-y-1">
                    <div className="font-medium">{getCreatingStepLabel(creatingStep)}</div>
                    {creatingStep === "creating" ? <div>正在向 Gateway 注册员工信息。</div> : null}
                    {creatingStep === "writing-files" ? (
                      <div>正在写入 IDENTITY.md、SOUL.md 等默认模板。</div>
                    ) : null}
                    {creatingStep === "done" ? (
                      <div>已初始化默认配置文件，正在关闭弹窗。</div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {submitError ? (
                <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="space-y-1">
                    <div className="font-medium">创建失败</div>
                    <div>{submitError}</div>
                    {hasCreatedAgent && draftAgentId ? (
                      <div className="text-xs text-destructive/80">
                        已保留中间状态，再点一次「确认创建」会继续补全，不会重新走一遍流程。
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          {step === 1 ? (
            <>
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                取消
              </Button>
              <Button type="button" onClick={() => setStep(2)} disabled={!canContinueStep1}>
                下一步
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <Button type="button" variant="ghost" onClick={() => setStep(1)}>
                <ChevronLeft className="h-4 w-4" />
                上一步
              </Button>
              <Button type="button" onClick={() => setStep(3)}>
                下一步
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep(2)}
                disabled={isSubmitting}
              >
                <ChevronLeft className="h-4 w-4" />
                上一步
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={isSubmitting}
              >
                取消
              </Button>
              <Button type="button" onClick={() => void handleCreate()} disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {creatingStep === "creating"
                  ? "正在创建员工..."
                  : creatingStep === "writing-files"
                    ? "正在初始化配置文件..."
                    : creatingStep === "done"
                      ? "创建完成 ✅"
                      : "确认创建"}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
