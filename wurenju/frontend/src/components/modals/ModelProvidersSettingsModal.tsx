"use client";

import { Loader2, Plus, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import {
  ModelProviderEditorModal,
  type ModelProviderEditorModelValue,
  type ModelProviderEditorValue,
} from "@/components/modals/ModelProviderEditorModal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";
import { useAgentStore } from "@/stores/agentStore";
import type {
  GatewayConfigProviderEntry,
  GatewayConfigProviderModelEntry,
  GatewayConfigRoot,
} from "@/types/gateway";
import type { ModelApiProtocol } from "@/types/model";
import type { StoredProviderMetaMap } from "@/utils/modelProviders";
import {
  MODEL_PROVIDERS_UPDATED_EVENT,
  MODEL_PROVIDER_STATUS_UPDATED_EVENT,
  PROVIDER_PRESETS,
  getProviderDisplayName,
  getProviderPreset,
  getProviderStatusBadge,
  maskApiKey,
  normalizeProviderId,
  readModelProviderStatusMap,
  readStoredProviderMetaMap,
  saveModelProviderStatusMap,
  saveStoredProviderMetaMap,
} from "@/utils/modelProviders";

type ProviderListItem = {
  providerId: string;
  displayName: string;
  baseUrl: string;
  api: ModelApiProtocol;
  apiKey: string;
  models: ModelProviderEditorModelValue[];
};

const REDACTED_CONFIG_SENTINEL = "__OPENCLAW_REDACTED__";
const DEFAULT_MODEL_MAX_TOKENS = 8192;
const DEFAULT_MODEL_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeApi(value: unknown, fallback: ModelApiProtocol): ModelApiProtocol {
  const normalized = normalizeText(value);
  if (
    normalized === "openai-completions" ||
    normalized === "openai-responses" ||
    normalized === "openai-codex-responses" ||
    normalized === "anthropic-messages" ||
    normalized === "google-generative-ai" ||
    normalized === "github-copilot" ||
    normalized === "bedrock-converse-stream" ||
    normalized === "ollama"
  ) {
    return normalized;
  }

  return fallback;
}

function normalizePositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function createEditorModel(
  partial: Partial<ModelProviderEditorModelValue> = {},
): ModelProviderEditorModelValue {
  return {
    key: partial.key ?? crypto.randomUUID(),
    modelId: partial.modelId?.trim() ?? "",
    displayName: partial.displayName?.trim() ?? "",
    ...(typeof partial.contextWindow === "number" ? { contextWindow: partial.contextWindow } : {}),
  };
}

function resolveStoredModelDisplayName(params: {
  providerId: string;
  modelId: string;
  providerMetaMap: StoredProviderMetaMap;
  configuredName?: unknown;
}) {
  const configuredName = normalizeText(params.configuredName);
  if (configuredName) {
    return configuredName;
  }

  const storedName =
    params.providerMetaMap[params.providerId]?.models?.[params.modelId]?.displayName;
  if (storedName?.trim()) {
    return storedName.trim();
  }

  const presetName = getProviderPreset(params.providerId)?.models.find(
    (model) => model.id === params.modelId,
  )?.displayName;
  return presetName || params.modelId;
}

function mergeProviderModels(params: {
  providerId: string;
  providerMetaMap: StoredProviderMetaMap;
  providerConfig?: GatewayConfigProviderEntry;
}) {
  const configuredModels = Array.isArray(params.providerConfig?.models)
    ? params.providerConfig?.models
    : [];
  const storedModels = params.providerMetaMap[params.providerId]?.models ?? {};
  const models: ModelProviderEditorModelValue[] = [];

  for (const configuredModel of configuredModels) {
    const modelId = normalizeText(configuredModel?.id);
    if (!modelId) {
      continue;
    }

    models.push(
      createEditorModel({
        modelId,
        displayName: resolveStoredModelDisplayName({
          providerId: params.providerId,
          modelId,
          providerMetaMap: params.providerMetaMap,
          configuredName: configuredModel?.name,
        }),
        contextWindow:
          normalizePositiveNumber(configuredModel?.contextWindow) ??
          storedModels[modelId]?.contextWindow,
      }),
    );
  }

  if (models.length > 0) {
    return models;
  }

  return Object.entries(storedModels).map(([modelId, modelMeta]) =>
    createEditorModel({
      modelId,
      displayName: modelMeta.displayName,
      contextWindow: modelMeta.contextWindow,
    }),
  );
}

function getProviderApiKey(
  providerConfig: GatewayConfigProviderEntry | undefined,
  providerMetaMap: StoredProviderMetaMap,
  providerId: string,
) {
  const configApiKey = providerConfig?.apiKey;
  if (
    typeof configApiKey === "string" &&
    configApiKey.trim() &&
    configApiKey !== REDACTED_CONFIG_SENTINEL
  ) {
    return configApiKey.trim();
  }

  return providerMetaMap[providerId]?.apiKey?.trim() ?? "";
}

function buildProviderList(
  config: GatewayConfigRoot | undefined,
  providerMetaMap: StoredProviderMetaMap,
) {
  const providers = isRecord(config?.models?.providers) ? config?.models?.providers : {};

  return Object.entries(providers)
    .map(([providerId, providerConfig]) => {
      const normalizedProviderId = normalizeProviderId(providerId);
      const preset = getProviderPreset(normalizedProviderId);
      return {
        providerId: normalizedProviderId,
        displayName: getProviderDisplayName(normalizedProviderId, providerMetaMap),
        baseUrl:
          normalizeText(providerConfig?.baseUrl) ||
          providerMetaMap[normalizedProviderId]?.baseUrl ||
          preset?.baseUrl ||
          "",
        api: normalizeApi(
          providerConfig?.api ?? providerMetaMap[normalizedProviderId]?.api ?? preset?.api,
          preset?.api ?? "openai-completions",
        ),
        apiKey: getProviderApiKey(providerConfig, providerMetaMap, normalizedProviderId),
        models: mergeProviderModels({
          providerId: normalizedProviderId,
          providerMetaMap,
          providerConfig,
        }),
      } satisfies ProviderListItem;
    })
    .toSorted((left, right) => left.displayName.localeCompare(right.displayName));
}

function createEmptyEditorValue(): ModelProviderEditorValue {
  const defaultPreset =
    PROVIDER_PRESETS.find((preset) => preset.providerId !== "custom") ?? PROVIDER_PRESETS[0];
  return {
    providerType: defaultPreset.providerId,
    providerId: defaultPreset.providerId,
    displayName: defaultPreset.displayName,
    baseUrl: defaultPreset.baseUrl,
    api: defaultPreset.api,
    apiKey: "",
    models: defaultPreset.models.map((model) =>
      createEditorModel({
        modelId: model.id,
        displayName: model.displayName,
        contextWindow: model.contextWindow,
      }),
    ),
  };
}

function toEditorValue(provider: ProviderListItem): ModelProviderEditorValue {
  const providerType = getProviderPreset(provider.providerId)?.providerId ?? "custom";
  return {
    originalProviderId: provider.providerId,
    providerType,
    providerId: provider.providerId,
    displayName: provider.displayName,
    baseUrl: provider.baseUrl,
    api: provider.api,
    apiKey: provider.apiKey,
    models: provider.models.map((model) => createEditorModel(model)),
  };
}

function shouldEnableAuthHeader(api: ModelApiProtocol) {
  return (
    api === "openai-completions" || api === "openai-responses" || api === "openai-codex-responses"
  );
}

function buildGatewayProviderModels(
  models: ModelProviderEditorModelValue[],
  api: ModelApiProtocol,
): GatewayConfigProviderModelEntry[] {
  return models.map((model) => ({
    id: model.modelId.trim(),
    name: model.displayName.trim() || model.modelId.trim(),
    api,
    input: ["text"],
    cost: DEFAULT_MODEL_COST,
    ...(typeof model.contextWindow === "number" ? { contextWindow: model.contextWindow } : {}),
    maxTokens: DEFAULT_MODEL_MAX_TOKENS,
  }));
}

function buildStoredProviderMeta(value: ModelProviderEditorValue) {
  return {
    displayName: value.displayName,
    baseUrl: value.baseUrl,
    api: value.api,
    apiKey: value.apiKey,
    models: Object.fromEntries(
      value.models.map((model) => [
        model.modelId.trim(),
        {
          displayName: model.displayName.trim() || model.modelId.trim(),
          costTier: "paid" as const,
          ...(typeof model.contextWindow === "number"
            ? { contextWindow: model.contextWindow }
            : {}),
        },
      ]),
    ),
  };
}

export function ModelProvidersSettingsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fetchModels = useAgentStore((state) => state.fetchModels);

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [loadError, setLoadError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ModelProviderEditorValue | null>(null);
  const [pendingDeleteProviderId, setPendingDeleteProviderId] = useState<string | null>(null);
  const [, setStatusRevision] = useState(0);

  const pendingDeleteProvider = useMemo(
    () => providers.find((provider) => provider.providerId === pendingDeleteProviderId) ?? null,
    [pendingDeleteProviderId, providers],
  );

  async function loadProviders() {
    setIsLoading(true);
    setLoadError("");

    try {
      const snapshot = await gateway.getConfig();
      const providerMetaMap = readStoredProviderMetaMap();
      setProviders(buildProviderList(snapshot.config, providerMetaMap));
    } catch (error) {
      console.error("[Model] 加载供应商配置失败:", error);
      setLoadError("加载模型供应商失败，请检查 Gateway 连接");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    void loadProviders();
  }, [open]);

  useEffect(() => {
    function handleProviderStorageRefresh() {
      if (!open) {
        return;
      }

      void loadProviders();
    }

    function handleStatusRefresh() {
      setStatusRevision((current) => current + 1);
    }

    window.addEventListener(MODEL_PROVIDERS_UPDATED_EVENT, handleProviderStorageRefresh);
    window.addEventListener(MODEL_PROVIDER_STATUS_UPDATED_EVENT, handleStatusRefresh);
    return () => {
      window.removeEventListener(MODEL_PROVIDERS_UPDATED_EVENT, handleProviderStorageRefresh);
      window.removeEventListener(MODEL_PROVIDER_STATUS_UPDATED_EVENT, handleStatusRefresh);
    };
  }, [open]);

  function openCreateEditor() {
    setEditingProvider(createEmptyEditorValue());
    setEditorOpen(true);
  }

  function openEditEditor(provider: ProviderListItem) {
    setEditingProvider(toEditorValue(provider));
    setEditorOpen(true);
  }

  async function handleSaveProvider(value: ModelProviderEditorValue) {
    setIsSaving(true);

    try {
      const snapshot = await gateway.getConfig();
      const nextConfig = structuredClone(snapshot.config ?? {});
      const nextModels = isRecord(nextConfig.models) ? nextConfig.models : {};
      nextConfig.models = nextModels;

      const nextProviders = isRecord(nextModels.providers) ? nextModels.providers : {};
      nextModels.providers = nextProviders;

      const originalProviderId = normalizeProviderId(value.originalProviderId ?? value.providerId);
      const nextProviderId = normalizeProviderId(value.providerId);
      const existingProviderConfig =
        nextProviders[originalProviderId] ?? nextProviders[nextProviderId] ?? {};

      if (originalProviderId && originalProviderId !== nextProviderId) {
        delete nextProviders[originalProviderId];
      }

      nextProviders[nextProviderId] = {
        ...existingProviderConfig,
        baseUrl: value.baseUrl,
        api: value.api,
        apiKey: value.apiKey,
        authHeader: shouldEnableAuthHeader(value.api),
        models: buildGatewayProviderModels(value.models, value.api),
      };

      await gateway.setConfig(nextConfig as Record<string, unknown>, { baseHash: snapshot.hash });

      const providerMetaMap = readStoredProviderMetaMap();
      if (originalProviderId && originalProviderId !== nextProviderId) {
        delete providerMetaMap[originalProviderId];
      }
      providerMetaMap[nextProviderId] = buildStoredProviderMeta({
        ...value,
        providerId: nextProviderId,
      });
      saveStoredProviderMetaMap(providerMetaMap);

      try {
        await fetchModels(true);
      } catch (error) {
        console.error("[Model] 刷新模型列表失败:", error);
      }

      toast({
        title: "✅ 供应商已保存",
        description: `${value.displayName} 已同步写入 Gateway 配置。`,
      });
      setEditorOpen(false);
      setEditingProvider(null);
      await loadProviders();
    } catch (error) {
      console.error("[Model] 保存供应商失败:", error);
      toast({
        title: "❌ 保存失败",
        description: error instanceof Error && error.message.trim() ? error.message : "请稍后重试",
      });
      throw error;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteProvider() {
    if (!pendingDeleteProvider) {
      return;
    }

    setIsSaving(true);

    try {
      const snapshot = await gateway.getConfig();
      const nextConfig = structuredClone(snapshot.config ?? {});
      const nextModels = isRecord(nextConfig.models) ? nextConfig.models : {};
      nextConfig.models = nextModels;

      const nextProviders = isRecord(nextModels.providers) ? nextModels.providers : {};
      nextModels.providers = nextProviders;

      delete nextProviders[pendingDeleteProvider.providerId];
      await gateway.setConfig(nextConfig as Record<string, unknown>, { baseHash: snapshot.hash });

      const providerMetaMap = readStoredProviderMetaMap();
      delete providerMetaMap[pendingDeleteProvider.providerId];
      saveStoredProviderMetaMap(providerMetaMap);

      const statusMap = readModelProviderStatusMap();
      delete statusMap[pendingDeleteProvider.providerId];
      saveModelProviderStatusMap(statusMap);

      try {
        await fetchModels(true);
      } catch (error) {
        console.error("[Model] 删除后刷新模型列表失败:", error);
      }

      toast({
        title: "✅ 供应商已删除",
        description: `${pendingDeleteProvider.displayName} 已从 Gateway 配置中移除。`,
      });
      setPendingDeleteProviderId(null);
      await loadProviders();
    } catch (error) {
      console.error("[Model] 删除供应商失败:", error);
      toast({
        title: "❌ 删除失败",
        description: error instanceof Error && error.message.trim() ? error.message : "请稍后重试",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="overflow-hidden rounded-[20px] border-[var(--modal-shell-border)] bg-[var(--modal-shell-bg)] p-0 text-[var(--color-text-primary)] shadow-[var(--modal-shell-shadow)] backdrop-blur-xl sm:max-w-5xl">
          <div className="border-b border-border px-6 py-5">
            <DialogHeader className="gap-3 text-left">
              <DialogTitle className="flex items-center gap-2 text-xl">
                <Settings2 className="h-5 w-5" />
                模型供应商管理
              </DialogTitle>
              <DialogDescription>统一管理供应商、模型列表和 API Key。</DialogDescription>
            </DialogHeader>
          </div>

          <div className="max-h-[76vh] overflow-y-auto px-6 py-5">
            <div className="space-y-5">
              <div className="grid w-full grid-cols-1 rounded-2xl bg-[var(--color-bg-soft)] p-1">
                <button
                  type="button"
                  className="rounded-xl bg-[var(--color-bg-card)] px-4 py-2.5 text-sm font-medium text-[var(--color-text-primary)]"
                >
                  模型供应商
                </button>
              </div>

              {loadError ? (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {loadError}
                </div>
              ) : null}

              {isLoading ? (
                <div className="flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在加载模型供应商...
                </div>
              ) : null}

              {!isLoading && providers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
                  还没有配置任何模型供应商，先添加一个再给员工分配模型链。
                </div>
              ) : null}

              {!isLoading ? (
                <div className="space-y-3">
                  {providers.map((provider) => {
                    const statusBadge = getProviderStatusBadge(provider.providerId);

                    return (
                      <section
                        key={provider.providerId}
                        className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] px-5 py-4"
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="text-base font-semibold text-[var(--color-text-primary)]">
                                {provider.displayName}
                              </span>
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 text-xs font-medium",
                                  statusBadge.toneClassName,
                                )}
                              >
                                <span>{statusBadge.icon}</span>
                                <span>{statusBadge.label}</span>
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--color-text-secondary)]">
                              <span>{provider.models.length} 个模型</span>
                              <span>API Key: {maskApiKey(provider.apiKey)}</span>
                              <span className="truncate">地址：{provider.baseUrl}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => openEditEditor(provider)}
                            >
                              编辑
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => setPendingDeleteProviderId(provider.providerId)}
                              className="text-[var(--danger)] hover:bg-[var(--danger-subtle)] hover:text-[var(--danger)]"
                            >
                              删除
                            </Button>
                          </div>
                        </div>
                      </section>
                    );
                  })}
                </div>
              ) : null}

              <Button type="button" onClick={openCreateEditor} className="rounded-2xl">
                <Plus className="h-4 w-4" />+ 添加供应商
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {editingProvider ? (
        <ModelProviderEditorModal
          open={editorOpen}
          onOpenChange={(nextOpen) => {
            setEditorOpen(nextOpen);
            if (!nextOpen) {
              setEditingProvider(null);
            }
          }}
          title={editingProvider.originalProviderId ? "编辑模型供应商" : "添加模型供应商"}
          description="保存后会同步更新 Gateway 配置和前端的供应商元数据。"
          loading={isSaving}
          initialValue={editingProvider}
          onSubmit={handleSaveProvider}
        />
      ) : null}

      <ConfirmModal
        open={pendingDeleteProvider !== null}
        onClose={() => {
          if (isSaving) {
            return;
          }

          setPendingDeleteProviderId(null);
        }}
        onConfirm={() => {
          void handleDeleteProvider();
        }}
        loading={isSaving}
        icon="⚠️"
        iconBgColor="bg-[var(--warn-subtle)]"
        iconTextColor="text-[var(--warn)]"
        title="删除供应商"
        subtitle="会从 Gateway 配置中移除该 provider"
        description={
          pendingDeleteProvider
            ? `确定删除「${pendingDeleteProvider.displayName}」吗？删除后所有使用该供应商模型的员工会自动跳过这些模型。`
            : "确定删除该供应商吗？"
        }
        confirmText="确认删除"
        confirmColor="bg-[var(--danger)] hover:brightness-110"
      />
    </>
  );
}
