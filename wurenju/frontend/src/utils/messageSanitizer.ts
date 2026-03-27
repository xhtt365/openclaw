const INTERNAL_MODEL_TAGS = ["final"] as const;

const INTERNAL_MODEL_TAG_PATTERN = new RegExp(
  String.raw`</?(?:${INTERNAL_MODEL_TAGS.join("|")})\b[^>]*>`,
  "gi",
);

export function sanitizeAssistantText(value: string) {
  if (!value) {
    return value;
  }

  const sanitizedValue = value.replace(INTERNAL_MODEL_TAG_PATTERN, "").replace(/\n{3,}/g, "\n\n");

  if (sanitizedValue !== value) {
    console.log("[Sanitize] 已过滤助手消息中的模型内部标签");
  }

  return sanitizedValue;
}
