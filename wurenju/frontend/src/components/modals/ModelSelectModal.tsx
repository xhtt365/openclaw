"use client";

import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
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
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/agentStore";
import type { ModelGroupItem, ModelProviderGroup } from "@/types/model";

type ModalTab = "switch" | "add";

const ADD_MODEL_TEMPLATE = `{
  // provider 名称。
  // 官方 OpenAI 可写 "openai"；第三方 OpenAI 兼容中转站不要写 "openai"，建议写站点名，例如 "vpsairobot"
  "provider": "my-openai-proxy",

  // API 地址。
  // 官方 OpenAI 用 https://api.openai.com/v1；第三方中转站填自己的 baseUrl
  "baseUrl": "https://api.openai.com/v1",

  // API 协议：openai-responses / openai-completions / anthropic-messages
  "api": "openai-responses",

  // 你的 API Key
  "apiKey": "",

  // 模型配置
  "model": {
    "id": "gpt-4o",
    "name": "GPT-4o",
    "contextWindow": 128000,
    "maxTokens": 8192
  }
}`;

function splitModelRef(modelRef: string) {
  const trimmed = modelRef.trim();
  const separatorIndex = trimmed.indexOf("/");
  if (separatorIndex === -1) {
    return {
      provider: "",
      modelId: trimmed,
    };
  }

  return {
    provider: trimmed.slice(0, separatorIndex),
    modelId: trimmed.slice(separatorIndex + 1),
  };
}

function formatCompactNumber(value: number) {
  if (value >= 1_000_000) {
    return `${Number((value / 1_000_000).toFixed(1)).toString()}M`;
  }
  if (value >= 1_000) {
    return `${Number((value / 1_000).toFixed(1)).toString()}K`;
  }
  return String(value);
}

function formatContextWindow(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return `${formatCompactNumber(value)} context`;
}

function flattenModelGroups(groups: ModelProviderGroup[]) {
  return groups.flatMap((group) =>
    group.models.map((model) => ({
      provider: group.provider,
      model,
      modelRef: `${group.provider}/${model.id}`,
    })),
  );
}

function findModelEntry(groups: ModelProviderGroup[], modelRef: string | null) {
  if (!modelRef?.trim()) {
    return null;
  }

  const { provider, modelId } = splitModelRef(modelRef);
  const matchedGroup = groups.find((group) => group.provider === provider);
  const matchedModel = matchedGroup?.models.find((model) => model.id === modelId);

  if (!matchedGroup || !matchedModel) {
    return null;
  }

  return {
    provider,
    model: matchedModel,
  };
}

function resolveCurrentModelInfo(modelRef: string | null, groups: ModelProviderGroup[]) {
  if (!modelRef?.trim()) {
    return {
      title: "未配置",
      metadata: "未配置",
    };
  }

  const matched = findModelEntry(groups, modelRef);
  if (matched) {
    const contextWindow = formatContextWindow(matched.model.contextWindow);
    return {
      title: matched.model.name,
      metadata: contextWindow ? `${matched.provider} · ${contextWindow}` : matched.provider,
    };
  }

  const { provider, modelId } = splitModelRef(modelRef);
  return {
    title: modelId || modelRef,
    metadata: provider || modelRef,
  };
}

function ModelOptionCard({
  provider,
  model,
  selected,
  current,
  onClick,
}: {
  provider: string;
  model: ModelGroupItem;
  selected: boolean;
  current: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start justify-between gap-4 rounded-2xl border px-4 py-4 text-left transition-all",
        selected
          ? "border-orange-500 bg-orange-500/12 shadow-[0_0_0_1px_rgba(249,115,22,0.2)]"
          : "border-transparent bg-[var(--color-bg-card)] hover:border-white/20 hover:bg-[var(--color-bg-hover)]",
      )}
      aria-pressed={selected}
    >
      <div className="min-w-0">
        <div className="truncate text-base font-semibold text-[var(--color-text-primary)]">
          {model.name}
        </div>
        <div className="mt-1 truncate text-sm text-gray-400">{provider}</div>
      </div>

      {current ? (
        <span className="shrink-0 rounded-full border border-orange-500/30 bg-orange-500/10 px-2.5 py-1 text-[11px] text-orange-200">
          当前使用
        </span>
      ) : null}
    </button>
  );
}

export function ModelSelectModal({
  open,
  onOpenChange,
  agentId,
  agentName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  agentName: string;
}) {
  const availableModels = useAgentStore((state) => state.availableModels);
  const currentAgentModel = useAgentStore((state) => state.currentAgentModel);
  const modelLoading = useAgentStore((state) => state.modelLoading);
  const modelSaving = useAgentStore((state) => state.modelSaving);
  const configLoading = useAgentStore((state) => state.configLoading);
  const modelAdding = useAgentStore((state) => state.modelAdding);
  const fetchModels = useAgentStore((state) => state.fetchModels);
  const setAgentModel = useAgentStore((state) => state.setAgentModel);
  const addModelFromJSON = useAgentStore((state) => state.addModelFromJSON);

  const [activeTab, setActiveTab] = useState<ModalTab>("switch");
  const [selectedModel, setSelectedModel] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [addError, setAddError] = useState("");
  const [collapsedProviders, setCollapsedProviders] = useState<Record<string, boolean>>({});
  const [jsonInput, setJsonInput] = useState(ADD_MODEL_TEMPLATE);

  const currentModelInfo = resolveCurrentModelInfo(currentAgentModel, availableModels);
  const allModels = flattenModelGroups(availableModels);
  const useFlatLayout = allModels.length <= 3;
  const isAddSubmitting = modelAdding || configLoading;

  function resetModalState() {
    setActiveTab("switch");
    setSelectedModel(currentAgentModel ?? "");
    setLoadError("");
    setSaveError("");
    setAddError("");
    setCollapsedProviders({});
    setJsonInput(ADD_MODEL_TEMPLATE);
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetModalState();
    }
    onOpenChange(nextOpen);
  }

  function switchTab(tab: ModalTab) {
    setActiveTab(tab);
    setSaveError("");
    setAddError("");
  }

  function toggleProvider(provider: string) {
    setCollapsedProviders((current) => ({
      ...current,
      [provider]: !current[provider],
    }));
  }

  useEffect(() => {
    if (!open || availableModels.length > 0) {
      return;
    }

    let isActive = true;

    const loadModels = async () => {
      setLoadError("");
      try {
        await fetchModels();
      } catch {
        if (!isActive) {
          return;
        }
        setLoadError("加载模型列表失败，请检查 Gateway 连接");
      }
    };

    void loadModels();

    return () => {
      isActive = false;
    };
  }, [availableModels.length, fetchModels, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSelectedModel(currentAgentModel ?? "");
  }, [currentAgentModel, open]);

  async function handleSave() {
    if (!selectedModel || selectedModel === currentAgentModel) {
      handleDialogOpenChange(false);
      return;
    }

    setSaveError("");

    try {
      await setAgentModel(agentId, selectedModel);
      toast({
        title: "✅ 模型已切换",
        description: `${agentName} 已切换到 ${resolveCurrentModelInfo(selectedModel, availableModels).title}`,
      });
      handleDialogOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim() ? error.message : "模型切换失败，请稍后重试";
      setSaveError(message);
    }
  }

  async function handleAddModel() {
    setAddError("");

    try {
      await addModelFromJSON(jsonInput);
      setJsonInput(ADD_MODEL_TEMPLATE);
      setActiveTab("switch");
      toast({
        title: "✅ 模型已添加",
        description: "新模型已经写入 Gateway 配置，并刷新到可选列表。",
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : "新增模型失败，请检查配置后重试";
      setAddError(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="overflow-hidden rounded-[20px] border-[var(--color-border)] bg-gray-900/95 p-0 text-[var(--color-text-primary)] shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:max-w-3xl">
        <div className="border-b border-border px-6 py-5">
          <DialogHeader className="gap-3 text-left">
            <DialogTitle className="text-xl">🤖 配置模型 — {agentName}</DialogTitle>
            <DialogDescription>
              为当前员工单独指定模型，保存后会立即写入 Gateway 配置。
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="max-h-[72vh] overflow-y-auto px-6 py-5">
          <div className="space-y-5">
            <div className="grid w-full grid-cols-2 rounded-2xl bg-[var(--color-bg-soft)] p-1">
              <button
                type="button"
                onClick={() => switchTab("switch")}
                className={cn(
                  "rounded-xl px-4 py-2.5 text-sm font-medium transition-colors",
                  activeTab === "switch"
                    ? "bg-[var(--color-bg-card)] text-[var(--color-text-primary)]"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
                )}
              >
                切换模型
              </button>
              <button
                type="button"
                onClick={() => switchTab("add")}
                className={cn(
                  "rounded-xl px-4 py-2.5 text-sm font-medium transition-colors",
                  activeTab === "add"
                    ? "bg-[var(--color-bg-card)] text-[var(--color-text-primary)]"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
                )}
              >
                + 新增模型
              </button>
            </div>

            {activeTab === "switch" ? (
              <div className="space-y-5">
                <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
                    当前模型
                  </div>
                  <div className="mt-2 text-base font-semibold text-[var(--color-text-primary)]">
                    {currentModelInfo.title}
                  </div>
                  <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
                    {currentModelInfo.metadata}
                  </div>
                  <div className="mt-3 text-xs text-[var(--color-text-secondary)]">
                    切换后立即生效，当前对话不受影响
                  </div>
                </section>

                {loadError ? (
                  <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    {loadError}
                  </div>
                ) : null}

                {saveError ? (
                  <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    {saveError}
                  </div>
                ) : null}

                {modelLoading ? (
                  <div className="flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    正在加载模型列表...
                  </div>
                ) : null}

                {!modelLoading && availableModels.length === 0 && !loadError ? (
                  <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
                    当前没有可选模型，请检查 Gateway 的模型配置。
                  </div>
                ) : null}

                {!modelLoading && availableModels.length > 0 ? (
                  useFlatLayout ? (
                    <div className="space-y-3">
                      {allModels.map(({ provider, model, modelRef }) => (
                        <ModelOptionCard
                          key={modelRef}
                          provider={provider}
                          model={model}
                          selected={selectedModel === modelRef}
                          current={currentAgentModel === modelRef}
                          onClick={() => setSelectedModel(modelRef)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {availableModels.map((group) => {
                        const isCollapsed = collapsedProviders[group.provider];

                        return (
                          <section
                            key={group.provider}
                            className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)]"
                          >
                            <button
                              type="button"
                              onClick={() => toggleProvider(group.provider)}
                              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-bg-hover)]"
                            >
                              <div>
                                <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                                  {group.provider}
                                </div>
                                <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                                  {group.models.length} 个模型
                                </div>
                              </div>
                              {isCollapsed ? (
                                <ChevronRight className="h-4 w-4 text-[var(--color-text-secondary)]" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-[var(--color-text-secondary)]" />
                              )}
                            </button>

                            {!isCollapsed ? (
                              <div className="border-t border-[var(--color-border)] px-3 py-3">
                                <div className="space-y-3">
                                  {group.models.map((model) => {
                                    const modelRef = `${group.provider}/${model.id}`;

                                    return (
                                      <ModelOptionCard
                                        key={modelRef}
                                        provider={group.provider}
                                        model={model}
                                        selected={selectedModel === modelRef}
                                        current={currentAgentModel === modelRef}
                                        onClick={() => setSelectedModel(modelRef)}
                                      />
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}
                          </section>
                        );
                      })}
                    </div>
                  )
                ) : null}
              </div>
            ) : null}

            {activeTab === "add" ? (
              <div className="space-y-5">
                <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4">
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                    输入模型配置（JSON 格式）：
                  </div>
                  <textarea
                    value={jsonInput}
                    onChange={(event) => setJsonInput(event.target.value)}
                    spellCheck={false}
                    className="mt-3 min-h-[320px] w-full resize-y rounded-2xl border border-[var(--color-border)] bg-gray-950 px-4 py-4 font-mono text-sm leading-7 text-gray-100 outline-none transition-[border-color,box-shadow] focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                  />
                  <div className="mt-3 text-xs text-[var(--color-text-secondary)]">
                    如果该 provider 已存在，将只追加模型，不会覆盖现有的 baseUrl、协议和 API
                    Key。第三方 OpenAI 兼容 responses 中转站如果误写成{" "}
                    <code className="mx-1 rounded bg-black/30 px-1 py-0.5">openai</code>
                    ，前端会自动改成自定义 provider 名，避免命中 OpenClaw 的固定 OpenAI 路径。
                  </div>
                  {addError ? (
                    <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                      {addError}
                    </div>
                  ) : null}
                  {isAddSubmitting ? (
                    <div className="mt-4 flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      正在写入配置并等待 Gateway 重载...
                    </div>
                  ) : null}
                </section>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleDialogOpenChange(false)}
            disabled={modelSaving || isAddSubmitting}
          >
            取消
          </Button>

          {activeTab === "switch" ? (
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={modelSaving || !selectedModel || selectedModel === currentAgentModel}
            >
              {modelSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              保存
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => void handleAddModel()}
              disabled={isAddSubmitting || !jsonInput.trim()}
            >
              {isAddSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              添加模型
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
