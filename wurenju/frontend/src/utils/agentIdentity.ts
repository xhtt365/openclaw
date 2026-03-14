import type { AgentFile, AgentIdentityDetails } from "@/types/agent"

const IDENTITY_FIELD_ALIASES: Record<string, keyof AgentIdentityDetails> = {
  name: "name",
  emoji: "emoji",
  avatar: "avatar",
  role: "role",
  title: "role",
  "职位": "role",
  "角色": "role",
  description: "description",
  desc: "description",
  "简介": "description",
}

function cleanMarkdownText(value: string) {
  return value
    .trim()
    .replace(/^[*_`]+|[*_`]+$/g, "")
    .trim()
}

function normalizeIdentityLabel(label: string) {
  return cleanMarkdownText(label).toLowerCase()
}

export function parseAgentIdentityContent(content: string): AgentIdentityDetails {
  const details: AgentIdentityDetails = {}
  const normalized = content.replace(/\r\n/g, "\n")
  const headingMatch = normalized.match(/^#\s+(.+)$/m)
  const headingName = cleanMarkdownText(headingMatch?.[1] ?? "")

  // 兼容旧模板：首个标题通常就是员工名称。
  if (headingName && !headingName.toLowerCase().includes("identity.md")) {
    details.name = headingName
  }

  for (const rawLine of normalized.split("\n")) {
    const cleanedLine = rawLine.trim().replace(/^\s*-\s*/, "")
    const separatorIndex = cleanedLine.indexOf(":")
    if (separatorIndex === -1) {
      continue
    }

    const rawLabel = cleanedLine.slice(0, separatorIndex)
    const rawValue = cleanedLine.slice(separatorIndex + 1)
    const label = normalizeIdentityLabel(rawLabel)
    const value = cleanMarkdownText(rawValue)
    if (!value) {
      continue
    }

    const field = IDENTITY_FIELD_ALIASES[label]
    if (!field) {
      continue
    }

    details[field] = value
  }

  return details
}

export function pickAgentCreatedAtMs(files: AgentFile[]) {
  const timestamps = files
    .map((file) => file.updatedAtMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)

  if (timestamps.length === 0) {
    return undefined
  }

  return Math.min(...timestamps)
}

export function formatAgentCreatedAt(createdAtMs?: number) {
  if (typeof createdAtMs !== "number" || !Number.isFinite(createdAtMs) || createdAtMs <= 0) {
    return "—"
  }

  return new Date(createdAtMs).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}
