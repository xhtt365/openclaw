import type { ConfigVersion } from "@/types/config";

export const CONFIG_HISTORY_STORAGE_KEY = "lobster-config-history";
const MAX_CONFIG_HISTORY = 20;
const PREVIEW_LIMIT = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isConfigVersion(value: unknown): value is ConfigVersion {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.timestamp === "number" &&
    Number.isFinite(value.timestamp) &&
    typeof value.content === "string" &&
    (value.label === undefined || typeof value.label === "string")
  );
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((value, index) => deepEqual(value, right[index]));
  }

  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);

    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every((key) => deepEqual(left[key], right[key]));
  }

  return false;
}

export function isConfigObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

export function buildJsonMergePatch(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  if (deepEqual(current, next)) {
    return {};
  }

  const patch: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(current), ...Object.keys(next)]);

  for (const key of keys) {
    if (!(key in next)) {
      patch[key] = null;
      continue;
    }

    if (!(key in current)) {
      patch[key] = next[key];
      continue;
    }

    const currentValue = current[key];
    const nextValue = next[key];

    if (deepEqual(currentValue, nextValue)) {
      continue;
    }

    if (isRecord(currentValue) && isRecord(nextValue)) {
      patch[key] = buildJsonMergePatch(currentValue, nextValue);
      continue;
    }

    patch[key] = nextValue;
  }

  return patch;
}

export function readConfigHistory(): ConfigVersion[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(CONFIG_HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(isConfigVersion)
      .toSorted((left: ConfigVersion, right: ConfigVersion) => right.timestamp - left.timestamp);
  } catch (error) {
    console.error("[Config] 读取配置历史失败:", error);
    return [];
  }
}

export function pushConfigHistoryVersion(params: {
  content: string;
  label?: string;
  timestamp?: number;
}): ConfigVersion[] {
  if (typeof window === "undefined") {
    return [];
  }

  const nextHistory = [
    {
      id: crypto.randomUUID(),
      timestamp: params.timestamp ?? Date.now(),
      content: params.content,
      ...(params.label ? { label: params.label } : {}),
    },
    ...readConfigHistory(),
  ].slice(0, MAX_CONFIG_HISTORY);

  try {
    window.localStorage.setItem(CONFIG_HISTORY_STORAGE_KEY, JSON.stringify(nextHistory));
  } catch (error) {
    console.error("[Config] 写入配置历史失败:", error);
  }

  return nextHistory;
}

function padNumber(value: number) {
  return String(value).padStart(2, "0");
}

export function formatConfigTimestamp(timestamp: number) {
  const date = new Date(timestamp);

  if (!Number.isFinite(date.getTime())) {
    return "--";
  }

  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())} ${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
}

export function buildConfigPreview(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= PREVIEW_LIMIT) {
    return normalized;
  }

  return `${normalized.slice(0, PREVIEW_LIMIT)}...`;
}
