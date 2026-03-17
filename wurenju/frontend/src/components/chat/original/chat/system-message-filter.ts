import { extractRawText, extractText } from "./message-extract.ts";

const TOOL_MESSAGE_ROLES = new Set([
  "tool",
  "toolresult",
  "tool_result",
  "tooluse",
  "tool_use",
  "function",
]);
const SYSTEM_MESSAGE_ROLES = new Set(["system"]);

const TOOL_CONTENT_TYPES = new Set([
  "toolcall",
  "tool_call",
  "tooluse",
  "tool_use",
  "toolresult",
  "tool_result",
]);

const TOOL_LABELS = new Set(["tool"]);
const TOOL_READ_MESSAGE_RE = /^\s*(?:\d+\s+tools?\s+read|tool output read)\s*$/i;
const SESSION_BOOTSTRAP_MESSAGE_RE = /^\s*a new session was started via\b/i;
const TOOL_OUTPUT_MESSAGE_RE = /\btool output\b/i;

function toTrimmedLowerString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function matchesToolReadMessage(text: string | null | undefined) {
  return typeof text === "string" && TOOL_READ_MESSAGE_RE.test(text.trim());
}

function matchesSessionBootstrapMessage(text: string | null | undefined) {
  return typeof text === "string" && SESSION_BOOTSTRAP_MESSAGE_RE.test(text.trim());
}

function matchesToolOutputMessage(text: string | null | undefined) {
  return typeof text === "string" && TOOL_OUTPUT_MESSAGE_RE.test(text);
}

function hasToolContent(content: unknown) {
  if (!Array.isArray(content)) {
    return false;
  }

  return content.some((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }

    const entry = item as Record<string, unknown>;
    const type = toTrimmedLowerString(entry.type);
    return type !== null && TOOL_CONTENT_TYPES.has(type);
  });
}

export function shouldHideSystemToolStreamText(text: string | null | undefined) {
  return (
    matchesToolReadMessage(text) ||
    matchesSessionBootstrapMessage(text) ||
    matchesToolOutputMessage(text)
  );
}

export function shouldHideSystemToolMessage(message: unknown) {
  if (!message || typeof message !== "object") {
    return false;
  }

  const entry = message as Record<string, unknown>;
  const role = toTrimmedLowerString(entry.role);
  const type = toTrimmedLowerString(entry.type);

  if (
    (role && (TOOL_MESSAGE_ROLES.has(role) || SYSTEM_MESSAGE_ROLES.has(role))) ||
    (type && (TOOL_MESSAGE_ROLES.has(type) || SYSTEM_MESSAGE_ROLES.has(type)))
  ) {
    return true;
  }

  const senderLabel =
    toTrimmedLowerString(entry.senderLabel) ??
    toTrimmedLowerString(entry.label) ??
    toTrimmedLowerString(entry.sender) ??
    toTrimmedLowerString(entry.source);
  if (senderLabel && TOOL_LABELS.has(senderLabel)) {
    return true;
  }

  if (
    typeof entry.toolCallId === "string" ||
    typeof entry.tool_call_id === "string" ||
    typeof entry.toolName === "string" ||
    typeof entry.tool_name === "string" ||
    hasToolContent(entry.content)
  ) {
    return true;
  }

  const text = extractText(message) ?? extractRawText(message) ?? null;
  return (
    matchesToolReadMessage(text) ||
    matchesSessionBootstrapMessage(text) ||
    matchesToolOutputMessage(text)
  );
}
