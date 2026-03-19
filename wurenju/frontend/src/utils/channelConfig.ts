import { readLocalStorageItem, writeLocalStorageItem } from "@/utils/storage";

export type ChannelType = "dingtalk" | "feishu" | "telegram";

export interface DingtalkChannelConfig {
  appId: string;
  appSecret: string;
  enabled: boolean;
}

export interface FeishuChannelConfig {
  appId: string;
  appSecret: string;
  enabled: boolean;
}

export interface TelegramChannelConfig {
  botToken: string;
  enabled: boolean;
}

export interface ChannelConfig {
  dingtalk?: DingtalkChannelConfig;
  feishu?: FeishuChannelConfig;
  telegram?: TelegramChannelConfig;
}

export interface ChannelConfigDraft {
  dingtalk: DingtalkChannelConfig;
  feishu: FeishuChannelConfig;
  telegram: TelegramChannelConfig;
}

export type ChannelSectionDraft =
  | DingtalkChannelConfig
  | FeishuChannelConfig
  | TelegramChannelConfig;

export const CHANNEL_STORAGE_KEY_PREFIX = "xiaban.channels.";

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEnabled(value: unknown) {
  return value === true;
}

export function createEmptyChannelConfigDraft(): ChannelConfigDraft {
  return {
    dingtalk: {
      appId: "",
      appSecret: "",
      enabled: false,
    },
    feishu: {
      appId: "",
      appSecret: "",
      enabled: false,
    },
    telegram: {
      botToken: "",
      enabled: false,
    },
  };
}

function normalizeDingtalkSection(value: unknown): DingtalkChannelConfig {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    appId: normalizeText(record.appId),
    appSecret: normalizeText(record.appSecret),
    enabled: normalizeEnabled(record.enabled),
  };
}

function normalizeFeishuSection(value: unknown): FeishuChannelConfig {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    appId: normalizeText(record.appId),
    appSecret: normalizeText(record.appSecret),
    enabled: normalizeEnabled(record.enabled),
  };
}

function normalizeTelegramSection(value: unknown): TelegramChannelConfig {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    botToken: normalizeText(record.botToken),
    enabled: normalizeEnabled(record.enabled),
  };
}

export function normalizeChannelConfig(value: unknown): ChannelConfigDraft {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    dingtalk: normalizeDingtalkSection(record.dingtalk),
    feishu: normalizeFeishuSection(record.feishu),
    telegram: normalizeTelegramSection(record.telegram),
  };
}

function hasDingtalkData(value: DingtalkChannelConfig) {
  return Boolean(value.appId || value.appSecret || value.enabled);
}

function hasFeishuData(value: FeishuChannelConfig) {
  return Boolean(value.appId || value.appSecret || value.enabled);
}

function hasTelegramData(value: TelegramChannelConfig) {
  return Boolean(value.botToken || value.enabled);
}

export function compactChannelConfig(value: ChannelConfigDraft): ChannelConfig {
  const normalized = normalizeChannelConfig(value);
  return {
    ...(hasDingtalkData(normalized.dingtalk) ? { dingtalk: normalized.dingtalk } : {}),
    ...(hasFeishuData(normalized.feishu) ? { feishu: normalized.feishu } : {}),
    ...(hasTelegramData(normalized.telegram) ? { telegram: normalized.telegram } : {}),
  };
}

export function getAgentChannelStorageKey(agentId: string) {
  return `${CHANNEL_STORAGE_KEY_PREFIX}${agentId.trim()}`;
}

export function readAgentChannelConfig(agentId: string): ChannelConfigDraft {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    return createEmptyChannelConfigDraft();
  }

  try {
    const raw = readLocalStorageItem(getAgentChannelStorageKey(normalizedAgentId));
    if (!raw) {
      return createEmptyChannelConfigDraft();
    }

    return normalizeChannelConfig(JSON.parse(raw));
  } catch {
    return createEmptyChannelConfigDraft();
  }
}

function emitChannelConfigUpdated(agentId: string, config: ChannelConfigDraft) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("xiaban-agent-channel-updated", {
      detail: {
        agentId,
        config,
      },
    }),
  );
}

export function saveAgentChannelConfig(agentId: string, value: ChannelConfigDraft) {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    throw new Error("员工标识不能为空");
  }

  const normalized = normalizeChannelConfig(value);
  const saved = writeLocalStorageItem(
    getAgentChannelStorageKey(normalizedAgentId),
    JSON.stringify(compactChannelConfig(normalized)),
  );
  if (!saved) {
    throw new Error("当前环境不支持本地保存");
  }
  emitChannelConfigUpdated(normalizedAgentId, normalized);
  return normalized;
}

export function saveAgentChannelSection(
  agentId: string,
  channel: "dingtalk",
  value: DingtalkChannelConfig,
): ChannelConfigDraft;
export function saveAgentChannelSection(
  agentId: string,
  channel: "feishu",
  value: FeishuChannelConfig,
): ChannelConfigDraft;
export function saveAgentChannelSection(
  agentId: string,
  channel: "telegram",
  value: TelegramChannelConfig,
): ChannelConfigDraft;
export function saveAgentChannelSection(
  agentId: string,
  channel: ChannelType,
  value: ChannelSectionDraft,
) {
  const current = readAgentChannelConfig(agentId);

  // 只覆盖当前页签，其他页签维持各自已保存状态。
  switch (channel) {
    case "dingtalk":
      current.dingtalk = normalizeDingtalkSection(value);
      break;
    case "feishu":
      current.feishu = normalizeFeishuSection(value);
      break;
    case "telegram":
      current.telegram = normalizeTelegramSection(value);
      break;
  }

  return saveAgentChannelConfig(agentId, current);
}

export function isChannelSectionComplete(channel: ChannelType, value: ChannelSectionDraft) {
  switch (channel) {
    case "dingtalk": {
      const normalized = normalizeDingtalkSection(value);
      return Boolean(normalized.appId && normalized.appSecret);
    }
    case "feishu": {
      const normalized = normalizeFeishuSection(value);
      return Boolean(normalized.appId && normalized.appSecret);
    }
    case "telegram": {
      const normalized = normalizeTelegramSection(value);
      return Boolean(normalized.botToken);
    }
  }
}

export function serializeChannelConfigDraft(value: ChannelConfigDraft) {
  return JSON.stringify(normalizeChannelConfig(value));
}
