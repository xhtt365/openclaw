import type { ModelApiProtocol } from "@/types/model";
import { readLocalStorageItem, writeLocalStorageItem } from "@/utils/storage";

export const MODEL_PROVIDERS_STORAGE_KEY = "xiaban.modelProviders";
export const MODEL_PROVIDER_STATUS_STORAGE_KEY = "xiaban.modelProviderStatus";
export const AGENT_MODEL_ACCESS_STORAGE_KEY = "xiaban.agentModelAccess";
export const MODEL_PROVIDERS_UPDATED_EVENT = "xiaban-model-providers-updated";
export const MODEL_PROVIDER_STATUS_UPDATED_EVENT = "xiaban-model-provider-status-updated";
export const AGENT_MODEL_ACCESS_UPDATED_EVENT = "xiaban-agent-model-access-updated";

export type ModelCostTier = "free" | "paid" | "premium";
export type ModelProviderHealthStatus = "healthy" | "rate_limited" | "quota_exhausted" | "error";

export interface ProviderPresetModel {
  id: string;
  displayName: string;
  costTier: ModelCostTier;
  contextWindow?: number;
}

export interface ProviderPreset {
  providerId: string;
  displayName: string;
  baseUrl: string;
  api: ModelApiProtocol;
  models: ProviderPresetModel[];
  supportsCustomModels?: boolean;
}

export interface StoredProviderModelMeta {
  displayName: string;
  costTier: ModelCostTier;
  contextWindow?: number;
}

export interface StoredProviderMeta {
  displayName: string;
  baseUrl?: string;
  api?: ModelApiProtocol;
  apiKey?: string;
  models: Record<string, StoredProviderModelMeta>;
}

export type StoredProviderMetaMap = Record<string, StoredProviderMeta>;

export interface ModelProviderRuntimeStatus {
  status: ModelProviderHealthStatus;
  cooldownUntil?: number;
  resetAt?: number;
  lastErrorAt: number;
  lastErrorReason: string;
}

export type ModelProviderRuntimeStatusMap = Record<string, ModelProviderRuntimeStatus>;
export type AgentModelAccessMap = Record<string, string[]>;

export interface ModelProviderStatusBadge {
  icon: string;
  label: string;
  toneClassName: string;
}

const MODEL_PROVIDER_BADGES: Record<ModelProviderHealthStatus, ModelProviderStatusBadge> = {
  healthy: {
    icon: "🟢",
    label: "正常",
    toneClassName: "text-[var(--ok)]",
  },
  rate_limited: {
    icon: "🟡",
    label: "限额中",
    toneClassName: "text-[var(--warn)]",
  },
  quota_exhausted: {
    icon: "🔴",
    label: "不可用",
    toneClassName: "text-[var(--danger)]",
  },
  error: {
    icon: "🔴",
    label: "不可用",
    toneClassName: "text-[var(--danger)]",
  },
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    providerId: "minimax",
    displayName: "MiniMax",
    baseUrl: "https://api.minimaxi.com/v1",
    api: "openai-completions",
    models: [
      {
        id: "MiniMax-M2.5",
        displayName: "MiniMax M2.5",
        costTier: "paid",
        contextWindow: 200000,
      },
    ],
  },
  {
    providerId: "bailian",
    displayName: "阿里云百炼",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    api: "openai-completions",
    models: [
      { id: "qwen3-max", displayName: "Qwen3-Max", costTier: "paid", contextWindow: 131072 },
    ],
  },
  {
    providerId: "volcengine",
    displayName: "火山方舟",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    api: "openai-completions",
    models: [
      {
        id: "deepseek-v3.2",
        displayName: "DeepSeek V3.2",
        costTier: "paid",
        contextWindow: 128000,
      },
    ],
  },
  {
    providerId: "deepseek",
    displayName: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    api: "openai-completions",
    models: [
      {
        id: "deepseek-chat",
        displayName: "DeepSeek Chat",
        costTier: "paid",
      },
    ],
  },
  {
    providerId: "openai",
    displayName: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    api: "openai-responses",
    models: [{ id: "gpt-5.4", displayName: "GPT-5.4", costTier: "paid", contextWindow: 1050000 }],
  },
  {
    providerId: "google",
    displayName: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    api: "google-generative-ai",
    models: [
      {
        id: "gemini-2.5-pro",
        displayName: "Gemini 2.5 Pro",
        costTier: "paid",
        contextWindow: 2000000,
      },
    ],
  },
  {
    providerId: "custom",
    displayName: "自定义",
    baseUrl: "",
    api: "openai-completions",
    models: [],
    supportsCustomModels: true,
  },
];

function emitEvent(eventName: string, detail: Record<string, unknown>) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(eventName, { detail }));
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizeModelCostTier(value: unknown): ModelCostTier {
  if (value === "free" || value === "premium") {
    return value;
  }

  return "paid";
}

function isModelApiProtocol(value: string): value is ModelApiProtocol {
  return [
    "openai-completions",
    "openai-responses",
    "openai-codex-responses",
    "anthropic-messages",
    "google-generative-ai",
    "github-copilot",
    "bedrock-converse-stream",
    "ollama",
  ].includes(value);
}

function normalizeApi(value: unknown): ModelApiProtocol | undefined {
  const normalized = normalizeText(value);
  return normalized && isModelApiProtocol(normalized) ? normalized : undefined;
}

function normalizeProviderModelMeta(value: unknown): StoredProviderModelMeta | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const displayName = normalizeText(record.displayName);
  if (!displayName) {
    return null;
  }

  return {
    displayName,
    costTier: normalizeModelCostTier(record.costTier),
    ...(normalizePositiveNumber(record.contextWindow)
      ? { contextWindow: normalizePositiveNumber(record.contextWindow) }
      : {}),
  };
}

function normalizeProviderMetaEntry(value: unknown): StoredProviderMeta | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const displayName = normalizeText(record.displayName);
  if (!displayName) {
    return null;
  }

  const modelEntries = record.models && typeof record.models === "object" ? record.models : {};
  const models: Record<string, StoredProviderModelMeta> = {};

  for (const [modelId, modelMeta] of Object.entries(modelEntries as Record<string, unknown>)) {
    const normalizedModelId = normalizeText(modelId);
    const normalizedMeta = normalizeProviderModelMeta(modelMeta);
    if (!normalizedModelId || !normalizedMeta) {
      continue;
    }

    models[normalizedModelId] = normalizedMeta;
  }

  return {
    displayName,
    ...(normalizeText(record.baseUrl) ? { baseUrl: normalizeText(record.baseUrl) } : {}),
    ...(normalizeApi(record.api) ? { api: normalizeApi(record.api) } : {}),
    ...(normalizeText(record.apiKey) ? { apiKey: normalizeText(record.apiKey) } : {}),
    models,
  };
}

function compactProviderMetaMap(value: StoredProviderMetaMap) {
  const compacted: StoredProviderMetaMap = {};

  for (const [providerId, providerMeta] of Object.entries(value)) {
    const normalizedProviderId = normalizeProviderId(providerId);
    const normalizedEntry = normalizeProviderMetaEntry(providerMeta);
    if (!normalizedProviderId || !normalizedEntry) {
      continue;
    }

    compacted[normalizedProviderId] = normalizedEntry;
  }

  return compacted;
}

function normalizeStatusEntry(value: unknown, now = Date.now()): ModelProviderRuntimeStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const rawStatus = normalizeText(record.status);
  const cooldownUntil = normalizePositiveNumber(record.cooldownUntil);
  const resetAt = normalizePositiveNumber(record.resetAt);

  let status: ModelProviderHealthStatus =
    rawStatus === "rate_limited" ||
    rawStatus === "quota_exhausted" ||
    rawStatus === "error" ||
    rawStatus === "healthy"
      ? rawStatus
      : "healthy";

  if ((status === "rate_limited" || status === "error") && cooldownUntil && cooldownUntil < now) {
    status = "healthy";
  }

  if (status === "quota_exhausted" && resetAt && resetAt < now) {
    status = "healthy";
  }

  return {
    status,
    ...(cooldownUntil ? { cooldownUntil } : {}),
    ...(resetAt ? { resetAt } : {}),
    lastErrorAt: normalizePositiveNumber(record.lastErrorAt) ?? 0,
    lastErrorReason: normalizeText(record.lastErrorReason),
  };
}

function compactStatusMap(value: ModelProviderRuntimeStatusMap, now = Date.now()) {
  const compacted: ModelProviderRuntimeStatusMap = {};

  for (const [providerId, status] of Object.entries(value)) {
    const normalizedProviderId = normalizeProviderId(providerId);
    const normalizedEntry = normalizeStatusEntry(status, now);
    if (!normalizedProviderId || !normalizedEntry) {
      continue;
    }

    compacted[normalizedProviderId] = normalizedEntry;
  }

  return compacted;
}

function normalizeModelRefs(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const refs: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    refs.push(normalized);
  }

  return refs;
}

function compactAgentModelAccessMap(value: AgentModelAccessMap) {
  const compacted: AgentModelAccessMap = {};

  for (const [agentId, modelRefs] of Object.entries(value)) {
    const normalizedAgentId = normalizeText(agentId);
    if (!normalizedAgentId) {
      continue;
    }

    compacted[normalizedAgentId] = normalizeModelRefs(modelRefs);
  }

  return compacted;
}

export function normalizeProviderId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function splitModelRef(modelRef: string) {
  const trimmed = modelRef.trim();
  const separatorIndex = trimmed.indexOf("/");
  if (separatorIndex === -1) {
    return {
      providerId: "",
      modelId: trimmed,
    };
  }

  return {
    providerId: trimmed.slice(0, separatorIndex),
    modelId: trimmed.slice(separatorIndex + 1),
  };
}

export function buildModelRef(providerId: string, modelId: string) {
  return `${providerId.trim()}/${modelId.trim()}`;
}

export function readStoredProviderMetaMap(): StoredProviderMetaMap {
  try {
    const raw = readLocalStorageItem(MODEL_PROVIDERS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    return compactProviderMetaMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveStoredProviderMetaMap(value: StoredProviderMetaMap) {
  const normalized = compactProviderMetaMap(value);
  if (!writeLocalStorageItem(MODEL_PROVIDERS_STORAGE_KEY, JSON.stringify(normalized))) {
    throw new Error("当前环境不支持本地保存");
  }
  emitEvent(MODEL_PROVIDERS_UPDATED_EVENT, { providers: normalized });
  return normalized;
}

export function readModelProviderStatusMap() {
  try {
    const raw = readLocalStorageItem(MODEL_PROVIDER_STATUS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const normalized = compactStatusMap(JSON.parse(raw));
    writeLocalStorageItem(MODEL_PROVIDER_STATUS_STORAGE_KEY, JSON.stringify(normalized), {
      silent: true,
    });
    return normalized;
  } catch {
    return {};
  }
}

export function saveModelProviderStatusMap(value: ModelProviderRuntimeStatusMap) {
  const normalized = compactStatusMap(value);
  if (!writeLocalStorageItem(MODEL_PROVIDER_STATUS_STORAGE_KEY, JSON.stringify(normalized))) {
    return {};
  }
  emitEvent(MODEL_PROVIDER_STATUS_UPDATED_EVENT, { providers: normalized });
  return normalized;
}

export function readAgentModelAccessMap() {
  try {
    const raw = readLocalStorageItem(AGENT_MODEL_ACCESS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    return compactAgentModelAccessMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveAgentModelAccessMap(value: AgentModelAccessMap) {
  const normalized = compactAgentModelAccessMap(value);
  if (!writeLocalStorageItem(AGENT_MODEL_ACCESS_STORAGE_KEY, JSON.stringify(normalized))) {
    throw new Error("当前环境不支持本地保存");
  }
  emitEvent(AGENT_MODEL_ACCESS_UPDATED_EVENT, { access: normalized });
  return normalized;
}

export function readAgentModelAccess(agentId: string) {
  const accessMap = readAgentModelAccessMap();
  return accessMap[agentId.trim()] ?? [];
}

export function saveAgentModelAccess(agentId: string, modelRefs: string[]) {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    return [];
  }

  const accessMap = readAgentModelAccessMap();
  accessMap[normalizedAgentId] = normalizeModelRefs(modelRefs);
  return saveAgentModelAccessMap(accessMap)[normalizedAgentId] ?? [];
}

export function getProviderPreset(providerId: string) {
  const normalizedProviderId = normalizeProviderId(providerId);
  return PROVIDER_PRESETS.find((preset) => preset.providerId === normalizedProviderId) ?? null;
}

export function getProviderDisplayName(
  providerId: string,
  providerMetaMap = readStoredProviderMetaMap(),
) {
  const normalizedProviderId = normalizeProviderId(providerId);
  return (
    providerMetaMap[normalizedProviderId]?.displayName ||
    getProviderPreset(normalizedProviderId)?.displayName ||
    normalizedProviderId
  );
}

export function getModelMeta(
  providerId: string,
  modelId: string,
  providerMetaMap = readStoredProviderMetaMap(),
) {
  const normalizedProviderId = normalizeProviderId(providerId);
  const normalizedModelId = normalizeText(modelId);

  const storedMeta = providerMetaMap[normalizedProviderId]?.models?.[normalizedModelId];
  if (storedMeta) {
    return storedMeta;
  }

  const preset = getProviderPreset(normalizedProviderId);
  const presetModel = preset?.models.find((model) => model.id === normalizedModelId);
  if (!presetModel) {
    return null;
  }

  return {
    displayName: presetModel.displayName,
    costTier: presetModel.costTier,
    ...(presetModel.contextWindow ? { contextWindow: presetModel.contextWindow } : {}),
  } satisfies StoredProviderModelMeta;
}

export function getModelDisplayName(
  providerId: string,
  modelId: string,
  providerMetaMap = readStoredProviderMetaMap(),
) {
  return getModelMeta(providerId, modelId, providerMetaMap)?.displayName || modelId;
}

export function getModelCostTier(
  providerId: string,
  modelId: string,
  providerMetaMap = readStoredProviderMetaMap(),
): ModelCostTier {
  return getModelMeta(providerId, modelId, providerMetaMap)?.costTier ?? "paid";
}

export function getProviderStatus(providerId: string, statusMap = readModelProviderStatusMap()) {
  return statusMap[normalizeProviderId(providerId)]?.status ?? "healthy";
}

export function getProviderStatusBadge(
  providerId: string,
  statusMap = readModelProviderStatusMap(),
) {
  return MODEL_PROVIDER_BADGES[getProviderStatus(providerId, statusMap)];
}

export function maskApiKey(value?: string) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "未配置";
  }

  const suffix = normalized.slice(-4);
  return `****${suffix}`;
}

export function listPremiumModels(providerMetaMap = readStoredProviderMetaMap()) {
  return Object.entries(providerMetaMap)
    .flatMap(([providerId, providerMeta]) =>
      Object.entries(providerMeta.models)
        .filter(([, modelMeta]) => modelMeta.costTier === "premium")
        .map(([modelId, modelMeta]) => ({
          providerId,
          providerDisplayName:
            providerMeta.displayName || getProviderDisplayName(providerId, providerMetaMap),
          modelId,
          modelDisplayName: modelMeta.displayName,
          modelRef: buildModelRef(providerId, modelId),
        })),
    )
    .toSorted((left, right) => {
      const providerCompare = left.providerDisplayName.localeCompare(right.providerDisplayName);
      if (providerCompare !== 0) {
        return providerCompare;
      }
      return left.modelDisplayName.localeCompare(right.modelDisplayName);
    });
}

export function isModelRefAuthorizedForAgent(
  agentId: string,
  modelRef: string,
  providerMetaMap = readStoredProviderMetaMap(),
) {
  const { providerId, modelId } = splitModelRef(modelRef);
  if (!providerId || !modelId) {
    return false;
  }

  if (getModelCostTier(providerId, modelId, providerMetaMap) !== "premium") {
    return true;
  }

  return readAgentModelAccess(agentId).includes(modelRef.trim());
}

export function pruneUnauthorizedPremiumModelRefs(
  agentId: string,
  modelRefs: string[],
  providerMetaMap = readStoredProviderMetaMap(),
) {
  return normalizeModelRefs(modelRefs).filter((modelRef) =>
    isModelRefAuthorizedForAgent(agentId, modelRef, providerMetaMap),
  );
}

function getNextMonthStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
}

function classifyProviderError(
  message: string,
): Omit<ModelProviderRuntimeStatus, "lastErrorAt" | "lastErrorReason"> | null {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("insufficient") ||
    normalized.includes("quota") ||
    normalized.includes("billing") ||
    /\b402\b/.test(normalized)
  ) {
    return {
      status: "quota_exhausted",
      resetAt: getNextMonthStart(),
    };
  }

  if (
    normalized.includes("rate_limit") ||
    normalized.includes("too many requests") ||
    /\b429\b/.test(normalized)
  ) {
    return {
      status: "rate_limited",
      cooldownUntil: Date.now() + 5 * 60 * 1000,
    };
  }

  if (normalized.includes("service unavailable") || /\b503\b/.test(normalized)) {
    return {
      status: "error",
      cooldownUntil: Date.now() + 10 * 60 * 1000,
    };
  }

  return null;
}

function inferProviderIdsFromError(message: string, providerMetaMap: StoredProviderMetaMap) {
  const providerIds = new Set<string>();
  const normalizedMessage = message.toLowerCase();

  for (const match of message.matchAll(/\b([a-z0-9-]+)\/[a-z0-9._:-]+\b/giu)) {
    const providerId = normalizeProviderId(match[1] ?? "");
    if (providerId) {
      providerIds.add(providerId);
    }
  }

  for (const match of message.matchAll(/\bprovider(?:\s+id)?[:=\s]+([a-z0-9-]+)\b/giu)) {
    const providerId = normalizeProviderId(match[1] ?? "");
    if (providerId) {
      providerIds.add(providerId);
    }
  }

  for (const providerId of Object.keys(providerMetaMap)) {
    if (normalizedMessage.includes(providerId.toLowerCase())) {
      providerIds.add(providerId);
    }
  }

  return [...providerIds];
}

export function trackModelProviderError(
  message: string,
  explicitProviderIds: string[] = [],
  providerMetaMap = readStoredProviderMetaMap(),
) {
  const errorMeta = classifyProviderError(message);
  if (!errorMeta) {
    return [];
  }

  const resolvedProviderIds = [
    ...new Set([
      ...explicitProviderIds.map((providerId) => normalizeProviderId(providerId)),
      ...inferProviderIdsFromError(message, providerMetaMap),
    ]),
  ].filter(Boolean);

  if (resolvedProviderIds.length === 0) {
    return [];
  }

  const nextStatusMap = readModelProviderStatusMap();
  const now = Date.now();

  for (const providerId of resolvedProviderIds) {
    nextStatusMap[providerId] = {
      ...errorMeta,
      lastErrorAt: now,
      lastErrorReason: message.slice(0, 300),
    };
  }

  saveModelProviderStatusMap(nextStatusMap);
  return resolvedProviderIds;
}
