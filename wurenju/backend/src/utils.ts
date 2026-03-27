import { ApiError } from "./errors";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function requireRecord(value: unknown, message = "请求体必须是 JSON 对象") {
  if (!isRecord(value)) {
    throw new ApiError(400, message);
  }

  return value;
}

export function readRouteParam(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, `${label}不能为空`);
  }

  return value.trim();
}

export function asRequiredText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, `${label}不能为空`);
  }

  return value.trim();
}

export function asOptionalText(value: unknown, label: string) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new ApiError(400, `${label}必须是字符串`);
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function asOptionalInteger(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  throw new ApiError(400, `${label}必须是数字`);
}

export function asBooleanInteger(value: unknown, label: string, fallback = 0) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value === 0 ? 0 : 1;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true") {
      return 1;
    }

    if (normalized === "0" || normalized === "false") {
      return 0;
    }
  }

  throw new ApiError(400, `${label}必须是布尔值`);
}

export function asJsonText(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

export function parseStoredJson(value: string | null, fallback: unknown = []) {
  if (!value || !value.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}
