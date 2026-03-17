/**
 * 源码确认（只读自 OpenClaw `src/gateway` / `src/agents`）：
 * - `config.patch` / `config.apply` 写盘后都会调度 Gateway restart，不适合前端这条无中断链路。
 * - `config.set` 只写完整配置，运行态会刷新 runtime snapshot；这是当前前端能安全走的无重启路径。
 * - `agents.update` 只改 `agents.list[].model`，不会自动帮前端补 `params.transport`。
 * - `params` 只能写在 `agents.defaults.models[modelRef].params`；`agents.list[].params` 会被 schema 拒绝。
 * - `provider === "openai"` 且 `api === "openai-responses"` 时，OpenClaw 会优先走固定的 OpenAI WS 路径；
 *   如果 baseUrl 是第三方中转站，前端不能继续把它落成 `provider=openai`；
 *   必须改成自定义 provider 名，才能彻底避开固定 OpenAI WS 路径。
 *
 * 所以这里统一走 `config.get -> merge config -> config.set`：
 * - 新增模型时补全 provider/model 必填字段；
 * - 第三方 OpenAI 兼容 `responses` 代理会自动规范成自定义 provider 名；
 * - 切换模型时把 agent 的 model 和运行时 params 一次性写入，避免 502/401。
 */

import { create } from "zustand";
import { gateway, type GatewayAgentIdentity } from "@/services/gateway";
import type {
  Agent,
  AgentFile,
  AgentFilesMap,
  AgentIdentityDetails,
  AgentWorkspaceFileEntry,
} from "@/types/agent";
import type {
  GatewayConfigModelValue,
  GatewayConfigProviderModelCostEntry,
  GatewayConfigProviderModelInput,
  GatewayConfigSnapshot,
} from "@/types/gateway";
import {
  SUPPORTED_MODEL_APIS,
  type ModelApiProtocol,
  type ModelProviderGroup,
} from "@/types/model";
import { parseAgentIdentityContent, pickAgentCreatedAtMs } from "@/utils/agentIdentity";
import { parseJSONWithComments } from "@/utils/json5Parse";

export type { Agent } from "@/types/agent";

type AgentsListIdentity = {
  name?: string;
  emoji?: string;
  avatar?: string;
  avatarUrl?: string;
};

type ParsedModelJSON = {
  provider: string;
  baseUrl: string;
  api?: ModelApiProtocol;
  apiKey: string;
  authHeader?: boolean;
  model: {
    id: string;
    name?: string;
    reasoning?: boolean;
    input?: GatewayConfigProviderModelInput[];
    cost?: GatewayConfigProviderModelCostEntry;
    contextWindow?: number;
    maxTokens?: number;
    api?: ModelApiProtocol;
  };
};

type GatewayConfigRecord = Record<string, unknown>;
type AgentTransportMode = "sse";

const DEFAULT_MODEL_INPUT: GatewayConfigProviderModelInput[] = ["text"];
const REDACTED_CONFIG_SENTINEL = "__OPENCLAW_REDACTED__";
const OPENAI_HEADER_REQUIRED_APIS = new Set<ModelApiProtocol>([
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
]);

function isResolvedAvatarUrl(value: string) {
  return value.startsWith("data:image/") || value.startsWith("http") || value.startsWith("/");
}

function resolveIdentityAvatarValue(identity?: { avatar?: string; avatarUrl?: string }) {
  if (!identity) {
    return "";
  }

  if (typeof identity.avatarUrl === "string" && identity.avatarUrl.trim()) {
    return identity.avatarUrl.trim();
  }

  return typeof identity.avatar === "string" && identity.avatar.trim()
    ? identity.avatar.trim()
    : "";
}

function mergeIdentity(agent: Agent, identity?: GatewayAgentIdentity) {
  if (!identity) {
    return agent;
  }

  const avatarValue = resolveIdentityAvatarValue(identity);
  const emoji =
    typeof identity.emoji === "string" && identity.emoji.trim()
      ? identity.emoji.trim()
      : avatarValue && !isResolvedAvatarUrl(avatarValue)
        ? avatarValue
        : agent.emoji;

  return {
    ...agent,
    emoji,
    avatarUrl: isResolvedAvatarUrl(avatarValue) ? avatarValue : agent.avatarUrl,
  };
}

interface AgentState {
  agents: Agent[];
  currentAgentId: string;
  mainKey: string;
  isLoading: boolean;
  defaultModelLabel: string | null;
  showDetailFor: string | null;
  agentFiles: AgentFilesMap;
  activeFileName: string | null;
  fileContent: string;
  fileDirty: boolean;
  fileSaving: boolean;
  fileLoading: boolean;
  availableModels: ModelProviderGroup[];
  currentAgentModel: string | null;
  modelLoading: boolean;
  modelSaving: boolean;
  configLoading: boolean;
  modelAdding: boolean;
  fetchAgents: () => Promise<void>;
  fetchModels: (force?: boolean) => Promise<void>;
  fetchAgentModel: (agentId: string) => Promise<void>;
  ensureModelRuntimeConfig: (agentId: string, modelRef?: string | null) => Promise<string | null>;
  setAgentModel: (agentId: string, model: string) => Promise<void>;
  addModelFromJSON: (jsonStr: string) => Promise<void>;
  setCurrentAgent: (agentId: string) => void;
  getCurrentSessionKey: () => string;
  openDetail: (agentId: string) => Promise<void>;
  closeDetail: () => void;
  fetchAgentFiles: (agentId: string) => Promise<void>;
  selectFile: (name: string) => Promise<void>;
  updateFileContent: (content: string) => void;
  saveFile: () => Promise<boolean>;
}

function resolveAvatarUrl(identity?: AgentsListIdentity) {
  const avatarValue = resolveIdentityAvatarValue(identity);
  return isResolvedAvatarUrl(avatarValue) ? avatarValue : undefined;
}

function toSafeFileNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

// 文件列表先缓存元信息，正文在选中文件时再单独拉取。
function toAgentFile(file: AgentWorkspaceFileEntry): AgentFile | null {
  if (file.missing) {
    return null;
  }

  return {
    name: file.name,
    size: toSafeFileNumber(file.size),
    updatedAtMs: toSafeFileNumber(file.updatedAtMs),
    content: typeof file.content === "string" ? file.content : "",
  };
}

function withAgentFiles(map: AgentFilesMap, agentId: string, files: AgentFile[]) {
  const next = new Map(map);
  next.set(agentId, files);
  return next;
}

function upsertAgentFile(map: AgentFilesMap, agentId: string, file: AgentFile) {
  const next = new Map(map);
  const current = next.get(agentId) ?? [];
  const exists = current.some((item) => item.name === file.name);
  next.set(
    agentId,
    exists ? current.map((item) => (item.name === file.name ? file : item)) : [...current, file],
  );
  return next;
}

function normalizeAgentIdKey(value: string) {
  return value.trim().toLowerCase();
}

function resolveConfigModelValue(value?: GatewayConfigModelValue) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "object" && typeof value?.primary === "string" && value.primary.trim()) {
    return value.primary.trim();
  }

  return undefined;
}

function resolveConfiguredModelLabel(
  snapshot: GatewayConfigSnapshot | null,
  agentId: string,
  fallbackModelLabel: string | null,
) {
  const entries = Array.isArray(snapshot?.config?.agents?.list)
    ? snapshot?.config?.agents?.list
    : [];
  const matched = entries.find(
    (entry) =>
      typeof entry?.id === "string" &&
      normalizeAgentIdKey(entry.id) === normalizeAgentIdKey(agentId),
  );

  return resolveConfigModelValue(matched?.model) ?? fallbackModelLabel ?? undefined;
}

function patchAgentIdentitySummary(agent: Agent, details?: AgentIdentityDetails) {
  if (!details) {
    return agent;
  }

  return {
    ...agent,
    name: details.name?.trim() || agent.name,
    emoji: details.emoji?.trim() || agent.emoji,
    role: details.role?.trim() || agent.role,
    description: details.description?.trim() || agent.description,
  };
}

function patchAgentById(agents: Agent[], agentId: string, updater: (agent: Agent) => Agent) {
  return agents.map((agent) => (agent.id === agentId ? updater(agent) : agent));
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function countModels(groups: ModelProviderGroup[]) {
  return groups.reduce((total, group) => total + group.models.length, 0);
}

function isSupportedModelApi(value: string): value is ModelApiProtocol {
  return SUPPORTED_MODEL_APIS.includes(value as ModelApiProtocol);
}

function toRequiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toOptionalPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function parseOptionalPositiveInteger(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(`${fieldName} 必须是正整数`);
  }

  return value;
}

function parseOptionalBoolean(value: unknown, fieldName: string) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} 必须是布尔值`);
  }

  return value;
}

function createZeroCost(): GatewayConfigProviderModelCostEntry {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
}

function normalizeCostValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function sanitizeModelCost(value: unknown): GatewayConfigProviderModelCostEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createZeroCost();
  }

  const cost = value as Record<string, unknown>;
  return {
    input: normalizeCostValue(cost.input),
    output: normalizeCostValue(cost.output),
    cacheRead: normalizeCostValue(cost.cacheRead),
    cacheWrite: normalizeCostValue(cost.cacheWrite),
  };
}

function parseOptionalModelCost(value: unknown, fieldName: string) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} 必须是对象`);
  }

  return sanitizeModelCost(value);
}

function sanitizeModelInput(value: unknown): GatewayConfigProviderModelInput[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const seen = new Set<GatewayConfigProviderModelInput>();
  const inputs: GatewayConfigProviderModelInput[] = [];

  for (const item of value) {
    if (item !== "text" && item !== "image") {
      continue;
    }
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    inputs.push(item);
  }

  return inputs.length > 0 ? inputs : undefined;
}

function parseOptionalModelInput(value: unknown, fieldName: string) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} 必须是数组`);
  }

  const inputs = sanitizeModelInput(value);
  if (!inputs) {
    throw new Error(`${fieldName} 只支持 "text" 或 "image"`);
  }

  return inputs;
}

function toSupportedModelApi(value: unknown) {
  const apiValue = toRequiredString(value);
  return apiValue && isSupportedModelApi(apiValue) ? apiValue : undefined;
}

function resolveModelApi(value: unknown) {
  const apiValue = toRequiredString(value);
  if (!apiValue) {
    return undefined;
  }
  if (!isSupportedModelApi(apiValue)) {
    throw new Error(`不支持的 API 协议: ${apiValue}`);
  }
  return apiValue;
}

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

function isDirectOpenAIBaseUrl(baseUrl: unknown) {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    return false;
  }

  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return (
      host === "api.openai.com" || host === "chatgpt.com" || host.endsWith(".openai.azure.com")
    );
  } catch {
    const normalized = baseUrl.toLowerCase();
    return (
      normalized.includes("api.openai.com") ||
      normalized.includes("chatgpt.com") ||
      normalized.includes(".openai.azure.com")
    );
  }
}

function shouldForceHttpFallbackForProxyOpenAI(params: {
  provider: string;
  api?: ModelApiProtocol;
  baseUrl?: string;
}) {
  const baseUrl = params.baseUrl?.trim();
  if (!baseUrl) {
    return false;
  }

  return (
    params.provider === "openai" &&
    params.api === "openai-responses" &&
    !isDirectOpenAIBaseUrl(baseUrl)
  );
}

function sanitizeProviderId(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return normalized;
}

function deriveProxyProviderId(baseUrl: string) {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    const firstLabel = sanitizeProviderId(host.split(".")[0] ?? "");
    if (firstLabel && firstLabel !== "openai") {
      return firstLabel;
    }
    const hostnameId = sanitizeProviderId(host.replace(/\./g, "-"));
    if (hostnameId && hostnameId !== "openai") {
      return hostnameId;
    }
  } catch {
    const fallback = sanitizeProviderId(baseUrl);
    if (fallback && fallback !== "openai") {
      return fallback;
    }
  }

  return "openai-proxy";
}

function normalizeProxyProviderConfig(config: ParsedModelJSON) {
  if (
    config.provider !== "openai" ||
    !shouldForceHttpFallbackForProxyOpenAI({
      provider: config.provider,
      api: config.model.api ?? config.api,
      baseUrl: config.baseUrl,
    })
  ) {
    return config;
  }

  const nextProvider = deriveProxyProviderId(config.baseUrl);
  return {
    ...config,
    provider: nextProvider,
  };
}

function hasMeaningfulValue(value: unknown) {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return value !== undefined && value !== null;
}

function normalizeExistingProviderApi(providerConfig: GatewayConfigRecord | null) {
  return toSupportedModelApi(providerConfig?.api);
}

function normalizeProviderApiKey(
  providerConfig: GatewayConfigRecord | null,
  parsedConfig: ParsedModelJSON,
) {
  if (providerConfig && hasMeaningfulValue(providerConfig.apiKey)) {
    return providerConfig.apiKey;
  }

  return parsedConfig.apiKey.trim() ? parsedConfig.apiKey : undefined;
}

function shouldDefaultAuthHeader(api?: ModelApiProtocol) {
  return Boolean(api && OPENAI_HEADER_REQUIRED_APIS.has(api));
}

function buildProviderDefinition(
  providerConfig: GatewayConfigRecord | null,
  parsedConfig: ParsedModelJSON,
) {
  const nextProvider: GatewayConfigRecord = providerConfig ? structuredClone(providerConfig) : {};
  const providerApi = parsedConfig.api ?? normalizeExistingProviderApi(providerConfig);
  const providerBaseUrl = toRequiredString(providerConfig?.baseUrl) || parsedConfig.baseUrl;
  const providerApiKey = normalizeProviderApiKey(providerConfig, parsedConfig);
  const authHeader =
    typeof parsedConfig.authHeader === "boolean"
      ? parsedConfig.authHeader
      : typeof providerConfig?.authHeader === "boolean"
        ? providerConfig.authHeader
        : shouldDefaultAuthHeader(providerApi);

  if (providerBaseUrl) {
    nextProvider.baseUrl = providerBaseUrl;
  }
  if (providerApiKey !== undefined) {
    nextProvider.apiKey = providerApiKey;
  }
  if (providerApi) {
    nextProvider.api = providerApi;
  }
  if (typeof authHeader === "boolean") {
    nextProvider.authHeader = authHeader;
  }

  return nextProvider;
}

function sanitizeConfiguredProviderModel(
  currentModel: unknown,
  providerApi?: ModelApiProtocol,
): GatewayConfigRecord | null {
  if (!currentModel || typeof currentModel !== "object" || Array.isArray(currentModel)) {
    return null;
  }

  const model = currentModel as Record<string, unknown>;
  const modelId = toRequiredString(model.id);
  if (!modelId) {
    return null;
  }

  const api = toSupportedModelApi(model.api) ?? providerApi;
  const contextWindow = toOptionalPositiveInteger(model.contextWindow);
  const maxTokens = toOptionalPositiveInteger(model.maxTokens) ?? 8192;

  return {
    id: modelId,
    name: toRequiredString(model.name) || modelId,
    reasoning: typeof model.reasoning === "boolean" ? model.reasoning : false,
    input: sanitizeModelInput(model.input) ?? DEFAULT_MODEL_INPUT,
    cost: sanitizeModelCost(model.cost),
    ...(contextWindow ? { contextWindow } : {}),
    maxTokens,
    ...(api ? { api } : {}),
  };
}

function buildModelDefinitionFromParsedConfig(
  parsedConfig: ParsedModelJSON,
  providerConfig: GatewayConfigRecord | null,
) {
  const providerApi = parsedConfig.api ?? normalizeExistingProviderApi(providerConfig);
  const modelApi = parsedConfig.model.api ?? providerApi;

  return {
    id: parsedConfig.model.id,
    name: parsedConfig.model.name?.trim() || parsedConfig.model.id,
    reasoning: parsedConfig.model.reasoning ?? false,
    input: parsedConfig.model.input ?? DEFAULT_MODEL_INPUT,
    cost: parsedConfig.model.cost ?? createZeroCost(),
    ...(typeof parsedConfig.model.contextWindow === "number"
      ? { contextWindow: parsedConfig.model.contextWindow }
      : {}),
    maxTokens: parsedConfig.model.maxTokens ?? 8192,
    ...(modelApi ? { api: modelApi } : {}),
  };
}

function normalizeModelJsonConfig(input: unknown): ParsedModelJSON {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("JSON 根节点必须是对象");
  }

  const raw = input as Record<string, unknown>;
  const provider = toRequiredString(raw.provider);
  const baseUrl = toRequiredString(raw.baseUrl);
  const apiKey = toRequiredString(raw.apiKey);
  const authHeader = parseOptionalBoolean(raw.authHeader, "authHeader");
  const rawModel =
    raw.model && typeof raw.model === "object" && !Array.isArray(raw.model)
      ? (raw.model as Record<string, unknown>)
      : {};
  const modelId = toRequiredString(rawModel.id);
  const missingFields = [
    !provider ? "provider" : null,
    !baseUrl ? "baseUrl" : null,
    !apiKey ? "apiKey" : null,
    !modelId ? "model.id" : null,
  ].filter((field): field is string => field !== null);

  if (missingFields.length > 0) {
    throw new Error(`缺少必填字段: ${missingFields.join(", ")}`);
  }

  const api = resolveModelApi(raw.api);
  const modelApi = resolveModelApi(rawModel.api);

  return {
    provider,
    baseUrl,
    api,
    apiKey,
    authHeader,
    model: {
      id: modelId,
      name: toRequiredString(rawModel.name) || undefined,
      reasoning: parseOptionalBoolean(rawModel.reasoning, "model.reasoning"),
      input: parseOptionalModelInput(rawModel.input, "model.input"),
      cost: parseOptionalModelCost(rawModel.cost, "model.cost"),
      contextWindow: parseOptionalPositiveInteger(rawModel.contextWindow, "model.contextWindow"),
      maxTokens: parseOptionalPositiveInteger(rawModel.maxTokens, "model.maxTokens"),
      api: modelApi,
    },
  };
}

function hasModelInCatalog(groups: ModelProviderGroup[], provider: string, modelId: string) {
  return groups.some(
    (group) =>
      group.provider === provider &&
      group.models.some((model) => model.id.trim().toLowerCase() === modelId.trim().toLowerCase()),
  );
}

function hasConfiguredModel(snapshot: GatewayConfigSnapshot, provider: string, modelId: string) {
  const models = snapshot.config?.models?.providers?.[provider]?.models;
  if (!Array.isArray(models)) {
    return false;
  }

  return models.some(
    (model) =>
      typeof model?.id === "string" &&
      model.id.trim().toLowerCase() === modelId.trim().toLowerCase(),
  );
}

function isConfigRecord(value: unknown): value is GatewayConfigRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneConfigRoot(snapshot: GatewayConfigSnapshot) {
  return structuredClone((snapshot.config ?? {}) as GatewayConfigRecord);
}

function ensureConfigRecord(target: GatewayConfigRecord, key: string) {
  const current = target[key];
  if (isConfigRecord(current)) {
    return current;
  }

  const next: GatewayConfigRecord = {};
  target[key] = next;
  return next;
}

function resolveExistingAllowlist(snapshot: GatewayConfigSnapshot) {
  const defaults = snapshot.config?.agents?.defaults as { models?: unknown } | undefined;
  if (!isConfigRecord(defaults?.models)) {
    return null;
  }

  return defaults.models;
}

function shouldExtendAllowlist(snapshot: GatewayConfigSnapshot) {
  const allowlist = resolveExistingAllowlist(snapshot);
  return Boolean(allowlist && Object.keys(allowlist).length > 0);
}

function ensureAllowlistRecord(config: GatewayConfigRecord) {
  const nextAgents = ensureConfigRecord(config, "agents");
  const nextDefaults = ensureConfigRecord(nextAgents, "defaults");
  return ensureConfigRecord(nextDefaults, "models");
}

function ensureAgentEntry(config: GatewayConfigRecord, agentId: string) {
  const nextAgents = ensureConfigRecord(config, "agents");
  const nextList = Array.isArray(nextAgents.list) ? [...nextAgents.list] : [];
  nextAgents.list = nextList;

  const existingEntry = nextList.find(
    (entry) =>
      isConfigRecord(entry) &&
      typeof entry.id === "string" &&
      normalizeAgentIdKey(entry.id) === normalizeAgentIdKey(agentId),
  );
  if (existingEntry && isConfigRecord(existingEntry)) {
    return existingEntry;
  }

  const nextEntry: GatewayConfigRecord = { id: agentId };
  nextList.push(nextEntry);
  return nextEntry;
}

function setTransportOnRecord(target: GatewayConfigRecord, transport?: AgentTransportMode) {
  const nextParams = isConfigRecord(target.params) ? structuredClone(target.params) : {};

  if (transport) {
    nextParams.transport = transport;
    target.params = nextParams;
    return;
  }

  if (Object.prototype.hasOwnProperty.call(nextParams, "transport")) {
    delete nextParams.transport;
  }

  if (Object.keys(nextParams).length === 0) {
    delete target.params;
    return;
  }

  target.params = nextParams;
}

function containsRedactedSentinel(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === REDACTED_CONFIG_SENTINEL) {
    return true;
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => containsRedactedSentinel(item, seen));
  }

  return Object.values(value).some((item) => containsRedactedSentinel(item, seen));
}

function copyMissingProviderFields(target: GatewayConfigRecord, source: GatewayConfigRecord) {
  const fields = ["baseUrl", "api", "apiKey", "authHeader", "headers"] as const;

  for (const field of fields) {
    if (hasMeaningfulValue(target[field])) {
      continue;
    }
    if (!hasMeaningfulValue(source[field])) {
      continue;
    }
    if (containsRedactedSentinel(source[field])) {
      continue;
    }
    target[field] = structuredClone(source[field]);
  }
}

function upsertProviderModelEntry(
  targetProvider: GatewayConfigRecord,
  modelEntry: GatewayConfigRecord,
) {
  const modelId = toRequiredString(modelEntry.id);
  if (!modelId) {
    return;
  }

  const nextProviderModels = Array.isArray(targetProvider.models) ? [...targetProvider.models] : [];
  const modelIndex = nextProviderModels.findIndex(
    (model) =>
      isConfigRecord(model) && toRequiredString(model.id).toLowerCase() === modelId.toLowerCase(),
  );

  if (modelIndex === -1) {
    nextProviderModels.push(modelEntry);
  } else {
    nextProviderModels[modelIndex] = modelEntry;
  }

  targetProvider.models = nextProviderModels;
}

function migrateProxyOpenAIModel(params: {
  snapshot: GatewayConfigSnapshot;
  nextConfig: GatewayConfigRecord;
  sourceProvider: GatewayConfigRecord;
  sourceModel: GatewayConfigRecord;
  providerBaseUrl: string;
  modelName: string;
  modelId: string;
  agentId?: string;
}) {
  const migratedProvider = deriveProxyProviderId(params.providerBaseUrl);
  const migratedModelRef = `${migratedProvider}/${params.modelId}`;
  const nextModels = ensureConfigRecord(params.nextConfig, "models");
  const nextProviders = ensureConfigRecord(nextModels, "providers");
  const targetProvider = isConfigRecord(nextProviders[migratedProvider])
    ? structuredClone(nextProviders[migratedProvider])
    : {};

  copyMissingProviderFields(targetProvider, params.sourceProvider);
  upsertProviderModelEntry(targetProvider, structuredClone(params.sourceModel));
  nextProviders[migratedProvider] = targetProvider;

  if (params.agentId) {
    const agentEntry = ensureAgentEntry(params.nextConfig, params.agentId);
    agentEntry.model = migratedModelRef;
  }

  syncAllowlistModelEntry({
    snapshot: params.snapshot,
    nextConfig: params.nextConfig,
    modelRef: migratedModelRef,
    alias: params.modelName,
  });

  return migratedModelRef;
}

function syncAllowlistModelEntry(params: {
  snapshot: GatewayConfigSnapshot;
  nextConfig: GatewayConfigRecord;
  modelRef: string;
  alias: string;
  transport?: AgentTransportMode;
}) {
  if (!shouldExtendAllowlist(params.snapshot)) {
    return;
  }

  const nextAllowlist = ensureAllowlistRecord(params.nextConfig);
  const currentEntry: GatewayConfigRecord = isConfigRecord(nextAllowlist[params.modelRef])
    ? structuredClone(nextAllowlist[params.modelRef] as GatewayConfigRecord)
    : {};
  currentEntry.alias = params.alias;
  setTransportOnRecord(currentEntry, params.transport);
  nextAllowlist[params.modelRef] = currentEntry;
}

function ensureModelRuntimeConfigInConfig(params: {
  snapshot: GatewayConfigSnapshot;
  nextConfig: GatewayConfigRecord;
  modelRef: string;
  agentId?: string;
  writeAgentModel?: boolean;
}) {
  const { provider, modelId } = splitModelRef(params.modelRef);
  if (!provider || !modelId) {
    return {
      changed: false,
      modelName: params.modelRef,
      transport: undefined,
      effectiveModelRef: params.modelRef,
      migrationSkippedReason: undefined,
    };
  }

  const beforeJson = JSON.stringify(params.nextConfig);
  if (params.agentId) {
    const agentEntry = ensureAgentEntry(params.nextConfig, params.agentId);
    if (params.writeAgentModel) {
      agentEntry.model = params.modelRef;
    }
  }
  const nextModels = ensureConfigRecord(params.nextConfig, "models");
  const nextProviders = ensureConfigRecord(nextModels, "providers");
  const existingProvider = isConfigRecord(nextProviders[provider]) ? nextProviders[provider] : null;
  if (!existingProvider) {
    return {
      changed: beforeJson !== JSON.stringify(params.nextConfig),
      modelName: modelId,
      transport: undefined,
      effectiveModelRef: params.modelRef,
      migrationSkippedReason: undefined,
    };
  }

  const nextProvider = structuredClone(existingProvider);
  const providerApi = normalizeExistingProviderApi(nextProvider);
  const normalizedProvider = buildProviderDefinition(nextProvider, {
    provider,
    baseUrl: toRequiredString(nextProvider.baseUrl),
    api: providerApi,
    apiKey: "",
    authHeader: typeof nextProvider.authHeader === "boolean" ? nextProvider.authHeader : undefined,
    model: {
      id: modelId,
    },
  });
  const nextProviderModels = Array.isArray(normalizedProvider.models)
    ? [...normalizedProvider.models]
    : [];
  const modelIndex = nextProviderModels.findIndex(
    (model) =>
      isConfigRecord(model) && toRequiredString(model.id).toLowerCase() === modelId.toLowerCase(),
  );
  if (modelIndex === -1) {
    return {
      changed: false,
      modelName: modelId,
      transport: undefined,
      effectiveModelRef: params.modelRef,
      migrationSkippedReason: undefined,
    };
  }

  const normalizedModel = sanitizeConfiguredProviderModel(
    nextProviderModels[modelIndex],
    normalizeExistingProviderApi(normalizedProvider),
  );
  if (!normalizedModel) {
    return {
      changed: false,
      modelName: modelId,
      transport: undefined,
      effectiveModelRef: params.modelRef,
      migrationSkippedReason: undefined,
    };
  }

  nextProviderModels[modelIndex] = normalizedModel;
  normalizedProvider.models = nextProviderModels;
  nextProviders[provider] = normalizedProvider;

  const modelName = toRequiredString(normalizedModel.name) || modelId;
  const providerBaseUrl = toRequiredString(normalizedProvider.baseUrl);
  const providerModelApi =
    toSupportedModelApi(normalizedModel.api) ?? normalizeExistingProviderApi(normalizedProvider);
  const transport = shouldForceHttpFallbackForProxyOpenAI({
    provider,
    api: providerModelApi,
    baseUrl: providerBaseUrl,
  })
    ? "sse"
    : undefined;

  if (transport === "sse") {
    const migratedProvider = deriveProxyProviderId(providerBaseUrl);
    const existingMigratedProvider = isConfigRecord(nextProviders[migratedProvider])
      ? nextProviders[migratedProvider]
      : null;
    const canMigrateToCustomProvider =
      existingMigratedProvider !== null ||
      (!containsRedactedSentinel(normalizedProvider.apiKey) &&
        !containsRedactedSentinel(normalizedProvider.headers));

    if (!canMigrateToCustomProvider) {
      syncAllowlistModelEntry({
        snapshot: params.snapshot,
        nextConfig: params.nextConfig,
        modelRef: params.modelRef,
        alias: modelName,
        transport: "sse",
      });

      return {
        changed: beforeJson !== JSON.stringify(params.nextConfig),
        modelName,
        transport: "sse" as const,
        effectiveModelRef: params.modelRef,
        migrationSkippedReason:
          "当前配置里的 API Key 已被 Gateway 脱敏，前端不能安全迁移到新 provider；请重新新增一次该模型以写入真实 key。",
      };
    }

    const effectiveModelRef = migrateProxyOpenAIModel({
      snapshot: params.snapshot,
      nextConfig: params.nextConfig,
      sourceProvider: normalizedProvider,
      sourceModel: normalizedModel,
      providerBaseUrl,
      modelName,
      modelId,
      agentId: params.agentId,
    });

    return {
      changed: beforeJson !== JSON.stringify(params.nextConfig),
      modelName,
      transport: undefined,
      effectiveModelRef,
      migrationSkippedReason: undefined,
    };
  }

  syncAllowlistModelEntry({
    snapshot: params.snapshot,
    nextConfig: params.nextConfig,
    modelRef: params.modelRef,
    alias: modelName,
    transport,
  });

  return {
    changed: beforeJson !== JSON.stringify(params.nextConfig),
    modelName,
    transport,
    effectiveModelRef: params.modelRef,
    migrationSkippedReason: undefined,
  };
}

function buildNextConfig(snapshot: GatewayConfigSnapshot, config: ParsedModelJSON) {
  const provider = config.provider;
  const modelId = config.model.id;
  const nextConfig = cloneConfigRoot(snapshot);
  const nextModels = ensureConfigRecord(nextConfig, "models");
  const nextProviders = ensureConfigRecord(nextModels, "providers");
  const existingProvider = isConfigRecord(nextProviders[provider]) ? nextProviders[provider] : null;
  const nextProvider = buildProviderDefinition(existingProvider, config);
  const nextProviderModels = Array.isArray(nextProvider.models) ? [...nextProvider.models] : [];
  const nextModel = buildModelDefinitionFromParsedConfig(config, existingProvider);

  nextProviderModels.push(nextModel);
  nextProvider.models = nextProviderModels;

  nextProviders[provider] = nextProvider;

  syncAllowlistModelEntry({
    snapshot,
    nextConfig,
    modelRef: `${provider}/${modelId}`,
    alias: toRequiredString(nextModel.name) || modelId,
    transport: shouldForceHttpFallbackForProxyOpenAI({
      provider,
      api: toSupportedModelApi(nextModel.api) ?? config.api,
      baseUrl: toRequiredString(nextProvider.baseUrl),
    })
      ? "sse"
      : undefined,
  });

  return nextConfig;
}

function mergeConfiguredModelsIntoAvailableModels(
  groups: ModelProviderGroup[],
  snapshot: GatewayConfigSnapshot | null,
) {
  if (!snapshot?.config?.models?.providers) {
    return groups;
  }

  let nextGroups = groups;

  for (const [provider, providerConfig] of Object.entries(snapshot.config.models.providers)) {
    if (!providerConfig || typeof providerConfig !== "object") {
      continue;
    }

    const configuredModels = (providerConfig as { models?: unknown }).models;
    if (!Array.isArray(configuredModels)) {
      continue;
    }

    for (const configuredModel of configuredModels) {
      if (!configuredModel || typeof configuredModel !== "object") {
        continue;
      }

      const modelId = toRequiredString((configuredModel as { id?: unknown }).id);
      if (!modelId) {
        continue;
      }

      if (hasModelInCatalog(nextGroups, provider, modelId)) {
        continue;
      }

      nextGroups = mergeModelIntoAvailableModels(nextGroups, {
        provider,
        baseUrl: "",
        api: toSupportedModelApi((providerConfig as { api?: unknown }).api),
        apiKey: "",
        model: {
          id: modelId,
          name: toRequiredString((configuredModel as { name?: unknown }).name) || undefined,
          reasoning:
            typeof (configuredModel as { reasoning?: unknown }).reasoning === "boolean"
              ? ((configuredModel as { reasoning?: boolean }).reasoning ?? false)
              : undefined,
          input: sanitizeModelInput((configuredModel as { input?: unknown }).input),
          cost: sanitizeModelCost((configuredModel as { cost?: unknown }).cost),
          contextWindow:
            typeof (configuredModel as { contextWindow?: unknown }).contextWindow === "number" &&
            Number.isFinite((configuredModel as { contextWindow?: unknown }).contextWindow) &&
            (configuredModel as { contextWindow?: number }).contextWindow! > 0
              ? (configuredModel as { contextWindow?: number }).contextWindow
              : undefined,
          maxTokens:
            typeof (configuredModel as { maxTokens?: unknown }).maxTokens === "number" &&
            Number.isFinite((configuredModel as { maxTokens?: unknown }).maxTokens) &&
            (configuredModel as { maxTokens?: number }).maxTokens! > 0
              ? (configuredModel as { maxTokens?: number }).maxTokens
              : undefined,
          api: toSupportedModelApi((configuredModel as { api?: unknown }).api),
        },
      });
    }
  }

  return nextGroups;
}

function mergeModelIntoAvailableModels(
  groups: ModelProviderGroup[],
  config: ParsedModelJSON,
): ModelProviderGroup[] {
  const provider = config.provider;
  const modelId = config.model.id;
  const modelName = config.model.name?.trim() || modelId;
  const nextGroups = groups.map((group) => ({
    ...group,
    models: [...group.models],
  }));
  const targetGroup = nextGroups.find((group) => group.provider === provider);

  if (!targetGroup) {
    nextGroups.push({
      provider,
      models: [
        {
          id: modelId,
          name: modelName,
          contextWindow: config.model.contextWindow,
          reasoning: config.model.reasoning,
          api: config.model.api ?? config.api,
        },
      ],
    });
  } else {
    const exists = targetGroup.models.some(
      (model) => model.id.trim().toLowerCase() === modelId.trim().toLowerCase(),
    );

    if (!exists) {
      targetGroup.models.push({
        id: modelId,
        name: modelName,
        contextWindow: config.model.contextWindow,
        reasoning: config.model.reasoning,
        api: config.model.api ?? config.api,
      });
    }
  }

  return nextGroups
    .map((group) => ({
      ...group,
      models: [...group.models].toSorted((left, right) => left.name.localeCompare(right.name)),
    }))
    .toSorted((left, right) => left.provider.localeCompare(right.provider));
}

function mergePrimedAgentFiles(currentMap: AgentFilesMap, primedMap: AgentFilesMap) {
  const next = new Map(currentMap);

  primedMap.forEach((files, agentId) => {
    const currentFiles = next.get(agentId) ?? [];
    const currentFileByName = new Map(currentFiles.map((file) => [file.name, file]));

    next.set(
      agentId,
      files.map((file) => {
        const currentFile = currentFileByName.get(file.name);
        if (!currentFile) {
          return file;
        }

        return {
          ...file,
          content: currentFile.content || file.content,
        };
      }),
    );
  });

  return next;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  currentAgentId: "",
  mainKey: "",
  isLoading: false,
  defaultModelLabel: null,
  showDetailFor: null,
  agentFiles: new Map(),
  activeFileName: null,
  fileContent: "",
  fileDirty: false,
  fileSaving: false,
  fileLoading: false,
  availableModels: [],
  currentAgentModel: null,
  modelLoading: false,
  modelSaving: false,
  configLoading: false,
  modelAdding: false,

  fetchAgents: async () => {
    set({ isLoading: true });

    try {
      const [payload, configSnapshot] = await Promise.all([
        gateway.listAgents(),
        gateway.getConfig().catch((error) => {
          console.error("[Store] fetchAgents config snapshot failed:", error);
          return null;
        }),
      ]);
      const rawAgents = Array.isArray(payload.agents) ? payload.agents : [];
      const defaultModelLabel = configSnapshot
        ? (gateway.getDefaultModelLabel(configSnapshot) ?? null)
        : null;

      const baseAgents = rawAgents.reduce<Agent[]>((list, item) => {
        const id = typeof item.id === "string" ? item.id.trim() : "";
        if (!id) {
          return list;
        }

        const name =
          (typeof item.identity?.name === "string" && item.identity.name.trim()) ||
          (typeof item.name === "string" && item.name.trim()) ||
          id;
        const emoji =
          typeof item.identity?.emoji === "string" && item.identity.emoji.trim()
            ? item.identity.emoji.trim()
            : name.charAt(0).toUpperCase();

        list.push({
          id,
          name,
          emoji,
          avatarUrl: resolveAvatarUrl(item.identity),
        });

        return list;
      }, []);

      const identityResults = await Promise.allSettled(
        baseAgents.map(async (agent) => ({
          agentId: agent.id,
          identity: await gateway.getAgentIdentity(agent.id),
        })),
      );

      const identityById = new Map<string, GatewayAgentIdentity>();
      identityResults.forEach((result) => {
        if (result.status === "fulfilled") {
          identityById.set(result.value.agentId, result.value.identity);
          return;
        }

        console.error("[Store] fetchAgents identity failed:", result.reason);
      });

      const fileListResults = await Promise.allSettled(
        baseAgents.map(async (agent) => ({
          agentId: agent.id,
          payload: await gateway.listAgentFiles(agent.id),
        })),
      );

      const primedAgentFiles = new Map<string, AgentFile[]>();
      const createdAtById = new Map<string, number>();
      fileListResults.forEach((result) => {
        if (result.status !== "fulfilled") {
          console.error("[Store] fetchAgents files.list failed:", result.reason);
          return;
        }

        const files = result.value.payload.files
          .map((file) => toAgentFile(file))
          .filter((file): file is AgentFile => file !== null);

        primedAgentFiles.set(result.value.agentId, files);

        const createdAtMs = pickAgentCreatedAtMs(files);
        if (createdAtMs !== undefined) {
          createdAtById.set(result.value.agentId, createdAtMs);
        }
      });

      const identityFileResults = await Promise.allSettled(
        baseAgents
          .filter((agent) =>
            (primedAgentFiles.get(agent.id) ?? []).some((file) => file.name === "IDENTITY.md"),
          )
          .map(async (agent) => ({
            agentId: agent.id,
            content: await gateway.getAgentFile(agent.id, "IDENTITY.md"),
          })),
      );

      const identityDetailsById = new Map<string, AgentIdentityDetails>();
      identityFileResults.forEach((result) => {
        if (result.status !== "fulfilled") {
          console.error("[Store] fetchAgents IDENTITY.md failed:", result.reason);
          return;
        }

        const details = parseAgentIdentityContent(result.value.content);
        identityDetailsById.set(result.value.agentId, details);

        const currentFiles = primedAgentFiles.get(result.value.agentId) ?? [];
        primedAgentFiles.set(
          result.value.agentId,
          currentFiles.map((file) =>
            file.name === "IDENTITY.md" ? { ...file, content: result.value.content } : file,
          ),
        );
      });

      const agents = baseAgents.map((agent) => {
        const merged = mergeIdentity(agent, identityById.get(agent.id));
        const detailed = patchAgentIdentitySummary(merged, identityDetailsById.get(agent.id));

        return {
          ...detailed,
          createdAtMs: createdAtById.get(agent.id),
          modelName: resolveConfiguredModelLabel(configSnapshot, agent.id, defaultModelLabel),
        };
      });

      const defaultId = typeof payload.defaultId === "string" ? payload.defaultId.trim() : "";
      const mainKey = typeof payload.mainKey === "string" ? payload.mainKey.trim() : "";
      const currentAgentId =
        agents.find((agent) => agent.id === get().currentAgentId)?.id ||
        agents.find((agent) => agent.id === defaultId)?.id ||
        agents[0]?.id ||
        "";
      const detailAgentId = get().showDetailFor;
      const currentAgentModel = detailAgentId
        ? (agents.find((agent) => agent.id === detailAgentId)?.modelName ??
          defaultModelLabel ??
          null)
        : get().currentAgentModel;

      set({
        agents,
        currentAgentId,
        mainKey,
        isLoading: false,
        defaultModelLabel,
        currentAgentModel,
        agentFiles: mergePrimedAgentFiles(get().agentFiles, primedAgentFiles),
      });

      console.log(`[Store] fetchAgents: loaded ${agents.length} agents, mainKey=${mainKey}`);
    } catch (error) {
      set({ isLoading: false });
      console.error("[Store] fetchAgents failed:", error);
      throw error;
    }
  },

  fetchModels: async (force = false) => {
    if (!force && get().availableModels.length > 0) {
      console.log("[Store] fetchModels: use cached models");
      return;
    }

    console.log(`[Store] fetchModels${force ? ": force refresh" : ""}`);
    set({ modelLoading: true });

    try {
      const [gatewayModels, configSnapshot] = await Promise.all([
        gateway.listModels(),
        gateway.getConfig().catch((error) => {
          console.error("[Store] fetchModels config snapshot failed:", error);
          return null;
        }),
      ]);
      const availableModels = mergeConfiguredModelsIntoAvailableModels(
        gatewayModels,
        configSnapshot,
      );
      const gatewayCount = countModels(gatewayModels);
      const mergedCount = countModels(availableModels);
      set({
        availableModels,
        modelLoading: false,
      });
      if (mergedCount > gatewayCount) {
        console.log(
          `[Store] fetchModels: gateway 返回 ${gatewayCount} 个模型，按配置补齐 ${mergedCount - gatewayCount} 个`,
        );
      }
      console.log(
        `[Store] fetchModels: loaded ${availableModels.length} providers, ${countModels(availableModels)} models`,
      );
    } catch (error) {
      set({ modelLoading: false });
      console.error("[Store] fetchModels failed:", error);
      throw error;
    }
  },

  fetchAgentModel: async (agentId) => {
    console.log(`[Store] fetchAgentModel: ${agentId}`);
    const cachedModel =
      get().agents.find((agent) => agent.id === agentId)?.modelName ??
      get().defaultModelLabel ??
      null;
    set({ currentAgentModel: cachedModel });

    try {
      const configSnapshot = await gateway.getConfig();
      const defaultModelLabel = gateway.getDefaultModelLabel(configSnapshot) ?? null;
      const modelName =
        resolveConfiguredModelLabel(configSnapshot, agentId, defaultModelLabel) ?? null;

      set((state) => ({
        defaultModelLabel,
        currentAgentModel: state.showDetailFor === agentId ? modelName : state.currentAgentModel,
        agents: patchAgentById(state.agents, agentId, (agent) => ({
          ...agent,
          modelName: modelName ?? undefined,
        })),
      }));

      console.log(`[Store] fetchAgentModel: ${agentId} -> ${modelName ?? "未设置"}`);
    } catch (error) {
      console.error("[Store] fetchAgentModel failed:", error);
      throw error;
    }
  },

  ensureModelRuntimeConfig: async (agentId, modelRef) => {
    const resolvedModelRef =
      modelRef?.trim() ||
      get()
        .agents.find((agent) => agent.id === agentId)
        ?.modelName?.trim() ||
      get().currentAgentModel?.trim() ||
      get().defaultModelLabel?.trim() ||
      "";

    if (!resolvedModelRef) {
      return null;
    }

    console.log(`[Store] ensureModelRuntimeConfig: agent=${agentId}, model=${resolvedModelRef}`);
    const snapshot = await gateway.getConfig();
    const nextConfig = cloneConfigRoot(snapshot);
    const syncResult = ensureModelRuntimeConfigInConfig({
      snapshot,
      nextConfig,
      agentId,
      modelRef: resolvedModelRef,
    });

    if (!syncResult.changed) {
      console.log(`[Store] ensureModelRuntimeConfig: ${resolvedModelRef} 已是正确配置`);
      return resolvedModelRef;
    }

    console.log("[Store] ensureModelRuntimeConfig: config.set 写入运行时参数...");
    await gateway.setConfig(nextConfig, { baseHash: snapshot.hash });
    if (syncResult.migrationSkippedReason) {
      console.log(`[Store] ensureModelRuntimeConfig: ${syncResult.migrationSkippedReason}`);
    }
    if (syncResult.effectiveModelRef !== resolvedModelRef) {
      console.log(
        `[Store] ensureModelRuntimeConfig: 已将 ${resolvedModelRef} 自动迁移到 ${syncResult.effectiveModelRef}，避开第三方 OpenAI Responses 固定 provider 路径`,
      );
      try {
        await get().fetchModels(true);
      } catch (error) {
        console.error("[Store] ensureModelRuntimeConfig: 强制刷新模型列表失败:", error);
      }
      set((state) => ({
        currentAgentModel:
          state.currentAgentModel === resolvedModelRef
            ? syncResult.effectiveModelRef
            : state.currentAgentModel,
        agents: patchAgentById(state.agents, agentId, (agent) => ({
          ...agent,
          modelName:
            agent.modelName === resolvedModelRef ? syncResult.effectiveModelRef : agent.modelName,
        })),
      }));
    }
    console.log(
      `[Store] ensureModelRuntimeConfig: 已修正 ${syncResult.effectiveModelRef}，避免代理型 OpenAI Responses 误走固定 WS`,
    );
    await wait(200);
    return syncResult.effectiveModelRef;
  },

  setAgentModel: async (agentId, model) => {
    console.log(`[Store] setAgentModel: ${agentId} -> ${model}`);
    set({ modelSaving: true });

    try {
      console.log("[Store] setAgentModel: config.get 获取当前配置...");
      const snapshot = await gateway.getConfig();
      const nextConfig = cloneConfigRoot(snapshot);
      const syncResult = ensureModelRuntimeConfigInConfig({
        snapshot,
        nextConfig,
        agentId,
        modelRef: model,
        writeAgentModel: true,
      });

      if (syncResult.changed) {
        if (syncResult.effectiveModelRef !== model) {
          console.log(
            `[Store] setAgentModel: 检测到第三方 OpenAI Responses 中转站，已自动迁移为 ${syncResult.effectiveModelRef}`,
          );
        } else if (syncResult.migrationSkippedReason) {
          console.log(`[Store] setAgentModel: ${syncResult.migrationSkippedReason}`);
        } else if (syncResult.transport === "sse") {
          console.log(
            "[Store] setAgentModel: 代理型 OpenAI Responses 会显式写 transport=sse，避免命中固定 OpenAI WS",
          );
        }
        console.log("[Store] setAgentModel: config.set 写入模型和运行时参数...");
        await gateway.setConfig(nextConfig, { baseHash: snapshot.hash });
        console.log("[Store] setAgentModel: config.set 成功");
        if (syncResult.effectiveModelRef !== model) {
          try {
            await get().fetchModels(true);
          } catch (error) {
            console.error("[Store] setAgentModel: 强制刷新模型列表失败:", error);
          }
        }
      } else {
        console.log("[Store] setAgentModel: 配置无需额外变更");
      }

      const effectiveModelRef = syncResult.effectiveModelRef;

      set((state) => ({
        modelSaving: false,
        currentAgentModel:
          state.showDetailFor === agentId ? effectiveModelRef : state.currentAgentModel,
        agents: patchAgentById(state.agents, agentId, (agent) => ({
          ...agent,
          modelName: effectiveModelRef,
        })),
      }));
      console.log(`[Store] setAgentModel: saved ${agentId} -> ${effectiveModelRef}`);
    } catch (error) {
      set({ modelSaving: false });
      console.error("[Store] setAgentModel failed:", error);
      throw error;
    }
  },

  addModelFromJSON: async (jsonStr) => {
    set({ configLoading: true, modelAdding: true });

    try {
      console.log("[Store] 解析模型配置...");
      const rawParsedConfig = normalizeModelJsonConfig(parseJSONWithComments(jsonStr));
      const parsedConfig = normalizeProxyProviderConfig(rawParsedConfig);
      const provider = parsedConfig.provider;
      const modelId = parsedConfig.model.id;
      const beforeCount = countModels(get().availableModels);

      if (rawParsedConfig.provider !== parsedConfig.provider) {
        console.log(
          `[Store] addModelFromJSON: 检测到第三方 OpenAI Responses 中转站，provider 已从 ${rawParsedConfig.provider}/${modelId} 自动改为 ${provider}/${modelId}`,
        );
      }
      console.log(`[Store] addModelFromJSON: ${provider}/${modelId}`);
      console.log("[Store] config.get 获取当前配置...");
      const snapshot = await gateway.getConfig();
      const baseHash = snapshot.hash;
      if (hasConfiguredModel(snapshot, provider, modelId)) {
        throw new Error(`Provider ${provider} 下已存在模型 ${modelId}`);
      }

      const nextConfig = buildNextConfig(snapshot, parsedConfig);
      console.log("[Store] config.set 发送...");
      await gateway.setConfig(nextConfig, { baseHash });
      console.log("[Store] config.set 成功");

      console.log("[Store] 触发配置热加载...");
      console.log(
        "[Store] 源码确认：config.set 会刷新 Gateway runtime snapshot，watcher 会补齐后续热加载",
      );
      console.log("[Store] 配置热加载完成");

      console.log("[Store] 等待 Gateway 加载配置 (800ms)...");
      await wait(800);

      let refreshedModels: ModelProviderGroup[] | null = null;
      try {
        console.log("[Store] fetchModels 强制刷新...");
        await get().fetchModels(true);
        refreshedModels = get().availableModels;
        console.log("[Store] fetchModels 完成");
      } catch (error) {
        console.error("[Store] fetchModels 强制刷新失败:", error);
      }

      const refreshedCount = countModels(refreshedModels ?? get().availableModels);
      const countDelta = refreshedCount - beforeCount;
      console.log(
        `[Store] 当前模型总数: ${refreshedCount} (${countDelta >= 0 ? "+" : ""}${countDelta})`,
      );

      if (refreshedModels && hasModelInCatalog(refreshedModels, provider, modelId)) {
        console.log(`[Store] addModelFromJSON: catalog refreshed ${provider}/${modelId}`);
        set({ configLoading: false, modelAdding: false });
        return;
      }

      const mergedModels = mergeModelIntoAvailableModels(get().availableModels, parsedConfig);
      set({
        availableModels: mergedModels,
        configLoading: false,
        modelAdding: false,
      });
      console.log(
        `[Store] Gateway 未返回新模型，前端兜底合并 ${provider}/${modelId}，当前共 ${countModels(mergedModels)} 个模型`,
      );
    } catch (error) {
      set({ configLoading: false, modelAdding: false });
      console.error("[Store] addModelFromJSON failed:", error);
      throw error;
    }
  },

  setCurrentAgent: (agentId) => {
    set({ currentAgentId: agentId });
    console.log(`[Store] setCurrentAgent: ${agentId}`);
  },

  openDetail: async (agentId) => {
    console.log(`[Store] openDetail: ${agentId}`);
    const cachedModel =
      get().agents.find((agent) => agent.id === agentId)?.modelName ??
      get().defaultModelLabel ??
      null;
    set({
      showDetailFor: agentId,
      activeFileName: null,
      fileContent: "",
      fileDirty: false,
      fileSaving: false,
      fileLoading: false,
      currentAgentModel: cachedModel,
    });
    await Promise.allSettled([get().fetchAgentFiles(agentId), get().fetchAgentModel(agentId)]);
  },

  closeDetail: () => {
    console.log("[Store] closeDetail");
    set({
      showDetailFor: null,
      activeFileName: null,
      fileContent: "",
      fileDirty: false,
      fileSaving: false,
      fileLoading: false,
      currentAgentModel: null,
    });
  },

  fetchAgentFiles: async (agentId) => {
    console.log(`[Store] fetchAgentFiles: ${agentId}`);

    try {
      const payload = await gateway.listAgentFiles(agentId);
      const files = payload.files
        .map((file) => toAgentFile(file))
        .filter((file): file is AgentFile => file !== null);

      set((state) => ({
        agentFiles: withAgentFiles(state.agentFiles, agentId, files),
        agents: patchAgentById(state.agents, agentId, (agent) => ({
          ...agent,
          createdAtMs: pickAgentCreatedAtMs(files) ?? agent.createdAtMs,
        })),
      }));

      console.log(`[Store] fetchAgentFiles: loaded ${files.length} files for ${agentId}`);
    } catch (error) {
      console.error("[Store] fetchAgentFiles failed:", error);
    }
  },

  selectFile: async (name) => {
    const agentId = get().showDetailFor;
    if (!agentId) {
      console.error("[Store] selectFile failed: detail page is not open");
      return;
    }

    console.log(`[Store] selectFile: ${agentId}/${name}`);
    set({
      activeFileName: name,
      fileContent: "",
      fileDirty: false,
      fileLoading: true,
    });

    try {
      const content = await gateway.getAgentFile(agentId, name);
      const identityDetails =
        name === "IDENTITY.md" ? parseAgentIdentityContent(content) : undefined;

      set((state) => {
        const currentFile = state.agentFiles.get(agentId)?.find((file) => file.name === name);
        return {
          agentFiles: upsertAgentFile(state.agentFiles, agentId, {
            name,
            size: currentFile?.size ?? 0,
            updatedAtMs: currentFile?.updatedAtMs ?? 0,
            content,
          }),
          agents:
            name === "IDENTITY.md"
              ? patchAgentById(state.agents, agentId, (agent) =>
                  patchAgentIdentitySummary(agent, identityDetails),
                )
              : state.agents,
          fileContent: content,
          fileDirty: false,
          fileLoading: false,
        };
      });

      console.log(`[Store] selectFile: loaded ${agentId}/${name}`);
    } catch (error) {
      set({ fileLoading: false });
      console.error("[Store] selectFile failed:", error);
    }
  },

  updateFileContent: (content) => {
    // 编辑器只维护当前激活文件的内容和脏状态。
    set({ fileContent: content, fileDirty: true });
    console.log("[Store] updateFileContent");
  },

  saveFile: async () => {
    const { showDetailFor, activeFileName, fileContent } = get();
    if (!showDetailFor || !activeFileName) {
      console.error("[Store] saveFile failed: no active file selected");
      return false;
    }

    console.log(`[Store] saveFile: ${showDetailFor}/${activeFileName}`);
    set({ fileSaving: true });

    try {
      const ok = await gateway.saveAgentFile(showDetailFor, activeFileName, fileContent);
      const savedSize = new TextEncoder().encode(fileContent).length;
      const savedAtMs = Date.now();
      const identityDetails =
        activeFileName === "IDENTITY.md" ? parseAgentIdentityContent(fileContent) : undefined;
      set((state) => {
        const currentFile = state.agentFiles
          .get(showDetailFor)
          ?.find((file) => file.name === activeFileName);
        return {
          agentFiles: upsertAgentFile(state.agentFiles, showDetailFor, {
            name: activeFileName,
            size: ok ? savedSize : (currentFile?.size ?? savedSize),
            updatedAtMs: ok ? savedAtMs : (currentFile?.updatedAtMs ?? savedAtMs),
            content: fileContent,
          }),
          agents:
            activeFileName === "IDENTITY.md"
              ? patchAgentById(state.agents, showDetailFor, (agent) => ({
                  ...patchAgentIdentitySummary(agent, identityDetails),
                  createdAtMs: agent.createdAtMs ?? savedAtMs,
                }))
              : state.agents,
          fileDirty: ok ? false : state.fileDirty,
          fileSaving: false,
        };
      });

      console.log(
        `[Store] saveFile: ${ok ? "saved" : "skipped"} ${showDetailFor}/${activeFileName}`,
      );
      return ok;
    } catch (error) {
      set({ fileSaving: false });
      console.error("[Store] saveFile failed:", error);
      return false;
    }
  },

  getCurrentSessionKey: () => {
    const { currentAgentId, mainKey } = get();
    if (!currentAgentId || !mainKey) {
      throw new Error("agent session is not ready");
    }

    return `agent:${currentAgentId}:${mainKey}`;
  },
}));
