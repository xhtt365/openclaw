"use client";

import { Eye, EyeOff, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import type { ModelApiProtocol } from "@/types/model";
import { PROVIDER_PRESETS, getProviderPreset, normalizeProviderId } from "@/utils/modelProviders";

export interface ModelProviderEditorModelValue {
  key: string;
  modelId: string;
  displayName: string;
  contextWindow?: number;
}

export interface ModelProviderEditorValue {
  originalProviderId?: string;
  providerType: string;
  providerId: string;
  displayName: string;
  baseUrl: string;
  api: ModelApiProtocol;
  apiKey: string;
  models: ModelProviderEditorModelValue[];
}

type ModelProviderEditorModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  loading?: boolean;
  initialValue: ModelProviderEditorValue;
  onSubmit: (value: ModelProviderEditorValue) => Promise<void> | void;
};

function createModelDraft(
  partial: Partial<ModelProviderEditorModelValue> = {},
): ModelProviderEditorModelValue {
  return {
    key: partial.key ?? crypto.randomUUID(),
    modelId: partial.modelId?.trim() ?? "",
    displayName: partial.displayName?.trim() ?? "",
    ...(typeof partial.contextWindow === "number" ? { contextWindow: partial.contextWindow } : {}),
  };
}

function findPresetModel(providerType: string, modelId: string) {
  const normalizedModelId = modelId.trim().toLowerCase();
  if (!normalizedModelId) {
    return null;
  }

  return (
    getProviderPreset(providerType)?.models.find(
      (model) => model.id.trim().toLowerCase() === normalizedModelId,
    ) ?? null
  );
}

function resolveModelDraft(
  providerType: string,
  modelId: string,
  previous?: Partial<ModelProviderEditorModelValue>,
) {
  const normalizedModelId = modelId.trim();
  const presetModel = findPresetModel(providerType, normalizedModelId);

  return createModelDraft({
    ...previous,
    modelId: normalizedModelId,
    displayName: presetModel?.displayName || normalizedModelId || previous?.displayName?.trim(),
    contextWindow: presetModel?.contextWindow ?? previous?.contextWindow,
  });
}

function buildPresetModels(providerType: string) {
  const preset = getProviderPreset(providerType);
  if (!preset) {
    return [];
  }

  return preset.models.map((model) =>
    createModelDraft({
      modelId: model.id,
      displayName: model.displayName,
      contextWindow: model.contextWindow,
    }),
  );
}

function buildDraftForType(
  providerType: string,
  previous: ModelProviderEditorValue,
): ModelProviderEditorValue {
  if (providerType === "custom") {
    return {
      ...previous,
      providerType,
      providerId:
        previous.providerType === "custom"
          ? previous.providerId
          : normalizeProviderId(previous.displayName),
      displayName: previous.displayName,
      baseUrl: previous.providerType === "custom" ? previous.baseUrl : "",
      api: previous.providerType === "custom" ? previous.api : "openai-completions",
      models: previous.providerType === "custom" ? previous.models.map(createModelDraft) : [],
    };
  }

  const preset = getProviderPreset(providerType);
  if (!preset) {
    return previous;
  }

  return {
    ...previous,
    providerType,
    providerId: preset.providerId,
    displayName: preset.displayName,
    baseUrl: preset.baseUrl,
    api: preset.api,
    models: buildPresetModels(providerType),
  };
}

function FieldHint({ children }: { children: string }) {
  return <p className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">{children}</p>;
}

function SectionCard(props: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5">
      <div className="mb-4">
        <div className="text-base font-semibold text-[var(--color-text-primary)]">
          {props.title}
        </div>
        <div className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">
          {props.description}
        </div>
      </div>
      <div className="space-y-4">{props.children}</div>
    </section>
  );
}

export function ModelProviderEditorModal({
  open,
  onOpenChange,
  title,
  description,
  loading = false,
  initialValue,
  onSubmit,
}: ModelProviderEditorModalProps) {
  const [draft, setDraft] = useState<ModelProviderEditorValue>(() => initialValue);
  const [showApiKey, setShowApiKey] = useState(false);
  const [pendingModelId, setPendingModelId] = useState("");
  const [error, setError] = useState("");

  const isCustom = draft.providerType === "custom";
  const normalizedModelIds = useMemo(
    () => new Set(draft.models.map((model) => model.modelId.trim().toLowerCase()).filter(Boolean)),
    [draft.models],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    setDraft(initialValue);
    setShowApiKey(false);
    setPendingModelId("");
    setError("");
  }, [initialValue, open]);

  function updateDraft(patch: Partial<ModelProviderEditorValue>) {
    setDraft((current) => ({
      ...current,
      ...patch,
    }));
  }

  function updateModelId(key: string, modelId: string) {
    setDraft((current) => ({
      ...current,
      models: current.models.map((model) =>
        model.key === key ? resolveModelDraft(current.providerType, modelId, model) : model,
      ),
    }));
  }

  function removeModel(key: string) {
    setDraft((current) => ({
      ...current,
      models: current.models.filter((model) => model.key !== key),
    }));
  }

  function addModelById() {
    const modelId = pendingModelId.trim();
    if (!modelId) {
      return;
    }

    if (normalizedModelIds.has(modelId.toLowerCase())) {
      setError("模型 ID 不能重复");
      return;
    }

    setDraft((current) => ({
      ...current,
      models: [...current.models, resolveModelDraft(current.providerType, modelId)],
    }));
    setPendingModelId("");
    setError("");
  }

  async function handleSubmit() {
    setError("");

    const providerId = normalizeProviderId(draft.providerId);
    const displayName = draft.displayName.trim();
    const baseUrl = draft.baseUrl.trim();
    const apiKey = draft.apiKey.trim();
    const hasEmptyModelId = draft.models.some((model) => !model.modelId.trim());

    if (!providerId) {
      setError("供应商标识不能为空");
      return;
    }

    if (!displayName) {
      setError("供应商名称不能为空");
      return;
    }

    if (!baseUrl) {
      setError("API 地址不能为空");
      return;
    }

    if (!apiKey) {
      setError("API Key 不能为空");
      return;
    }

    if (hasEmptyModelId) {
      setError("模型 ID 不能为空");
      return;
    }

    const normalizedModels = draft.models.map((model) =>
      resolveModelDraft(draft.providerType, model.modelId, model),
    );
    if (normalizedModels.length === 0) {
      setError("至少需要添加 1 个模型");
      return;
    }

    const modelIdSet = new Set<string>();
    for (const model of normalizedModels) {
      const normalizedModelId = model.modelId.trim().toLowerCase();
      if (modelIdSet.has(normalizedModelId)) {
        setError("模型 ID 不能重复");
        return;
      }

      modelIdSet.add(normalizedModelId);
    }

    try {
      await onSubmit({
        ...draft,
        providerId,
        displayName,
        baseUrl,
        apiKey,
        models: normalizedModels,
      });
    } catch (submitError) {
      if (submitError instanceof Error && submitError.message.trim()) {
        setError(submitError.message);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden rounded-[20px] border-[var(--modal-shell-border)] bg-[var(--modal-shell-bg)] p-0 text-[var(--color-text-primary)] shadow-[var(--modal-shell-shadow)] backdrop-blur-xl sm:max-w-4xl">
        <div className="border-b border-border px-6 py-5">
          <DialogHeader className="gap-2 text-left">
            <DialogTitle className="text-xl">{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
        </div>

        <div className="max-h-[75vh] space-y-5 overflow-y-auto px-6 py-5">
          <SectionCard
            title="供应商信息"
            description="选择预设供应商后会自动填入 API 地址，一般不需要改。"
          >
            <label className="block">
              <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                供应商名称
              </div>
              <select
                value={draft.providerType}
                onChange={(event) => {
                  const nextType = event.target.value;
                  setDraft((current) => buildDraftForType(nextType, current));
                  setPendingModelId("");
                  setError("");
                }}
                className="h-11 w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 text-sm text-[var(--color-text-primary)] outline-none transition-[border-color,box-shadow] focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-subtle)]"
              >
                {PROVIDER_PRESETS.map((preset) => (
                  <option key={preset.providerId} value={preset.providerId}>
                    {preset.displayName}
                  </option>
                ))}
              </select>
            </label>

            {isCustom ? (
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                    显示名称
                  </div>
                  <Input
                    value={draft.displayName}
                    placeholder="例如：Anthropic"
                    onChange={(event) => updateDraft({ displayName: event.target.value })}
                    className="h-11 rounded-2xl border-[var(--color-border)] bg-[var(--color-bg-card)]"
                  />
                </label>

                <label className="block">
                  <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                    Provider ID
                  </div>
                  <Input
                    value={draft.providerId}
                    placeholder="例如：anthropic"
                    onChange={(event) => updateDraft({ providerId: event.target.value })}
                    className="h-11 rounded-2xl border-[var(--color-border)] bg-[var(--color-bg-card)]"
                  />
                  <FieldHint>
                    {`会写入 Gateway 的 models.providers.${draft.providerId || "provider-id"}。`}
                  </FieldHint>
                </label>
              </div>
            ) : (
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
                当前会保存为{" "}
                <span className="font-medium text-[var(--color-text-primary)]">
                  {draft.displayName}
                </span>{" "}
                (provider id: <code>{draft.providerId}</code>)
              </div>
            )}

            <label className="block">
              <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                API 地址
              </div>
              <Input
                value={draft.baseUrl}
                placeholder="https://example.com/v1"
                onChange={(event) => updateDraft({ baseUrl: event.target.value })}
                className="h-11 rounded-2xl border-[var(--color-border)] bg-[var(--color-bg-card)]"
              />
              <FieldHint>
                {isCustom
                  ? "选择「自定义」时需要手动填写。"
                  : "选择预设供应商后会自动填入，一般不需要改。"}
              </FieldHint>
            </label>

            <label className="block">
              <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                API Key
              </div>
              <div className="relative">
                <Input
                  type={showApiKey ? "text" : "password"}
                  value={draft.apiKey}
                  placeholder="粘贴供应商的 API Key"
                  onChange={(event) => updateDraft({ apiKey: event.target.value })}
                  className="h-11 rounded-2xl border-[var(--color-border)] bg-[var(--color-bg-card)] pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((current) => !current)}
                  className="absolute inset-y-0 right-0 inline-flex items-center justify-center px-3 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
                  aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <FieldHint>在供应商开放平台里复制，保存时会同步写入 Gateway 配置。</FieldHint>
            </label>
          </SectionCard>

          <SectionCard
            title="模型列表"
            description="填写该供应商支持的模型 ID。不确定模型 ID 可以到供应商开放平台查看。"
          >
            <div className="space-y-3">
              {draft.models.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4 py-5 text-sm text-[var(--color-text-secondary)]">
                  还没有添加模型，先输入一个模型 ID。
                </div>
              ) : null}

              {draft.models.map((model) => (
                <div
                  key={model.key}
                  className="grid gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3 md:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <Input
                    value={model.modelId}
                    placeholder="输入模型 ID"
                    onChange={(event) => updateModelId(model.key, event.target.value)}
                    className="h-11 rounded-2xl border-[var(--color-border)] bg-[var(--color-bg-card)]"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeModel(model.key)}
                    className="justify-self-end text-[var(--danger)] hover:bg-[var(--danger-subtle)] hover:text-[var(--danger)]"
                  >
                    <Trash2 className="h-4 w-4" />
                    删除
                  </Button>
                </div>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                value={pendingModelId}
                placeholder="输入模型 ID，按 Enter 添加"
                onChange={(event) => setPendingModelId(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") {
                    return;
                  }

                  event.preventDefault();
                  addModelById();
                }}
                className="h-11 rounded-2xl border-[var(--color-border)] bg-[var(--color-bg-card)]"
              />
              <Button
                type="button"
                variant="outline"
                onClick={addModelById}
                className="rounded-2xl"
              >
                <Plus className="h-4 w-4" />
                添加模型
              </Button>
            </div>

            <FieldHint>至少需要添加 1 个模型才能保存。</FieldHint>
          </SectionCard>

          {error ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            取消
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
