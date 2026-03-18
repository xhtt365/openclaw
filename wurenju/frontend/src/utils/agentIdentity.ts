import type { AgentFile, AgentIdentityDetails } from "@/types/agent";

const IDENTITY_FIELD_ALIASES: Record<string, keyof AgentIdentityDetails> = {
  name: "name",
  emoji: "emoji",
  avatar: "avatar",
  role: "role",
  title: "role",
  职位: "role",
  角色: "role",
  description: "description",
  desc: "description",
  简介: "description",
};

const IDENTITY_FIELD_LABELS: Record<Exclude<keyof AgentIdentityDetails, "avatar">, string> = {
  name: "Name",
  emoji: "Emoji",
  role: "Role",
  description: "Description",
};

function cleanMarkdownText(value: string) {
  return value
    .trim()
    .replace(/^[*_`]+|[*_`]+$/g, "")
    .trim();
}

function normalizeIdentityLabel(label: string) {
  return cleanMarkdownText(label).toLowerCase();
}

export function parseAgentIdentityContent(content: string): AgentIdentityDetails {
  const details: AgentIdentityDetails = {};
  const normalized = content.replace(/\r\n/g, "\n");
  const headingMatch = normalized.match(/^#\s+(.+)$/m);
  const headingName = cleanMarkdownText(headingMatch?.[1] ?? "");

  // 兼容旧模板：首个标题通常就是员工名称。
  if (headingName && !headingName.toLowerCase().includes("identity.md")) {
    details.name = headingName;
  }

  for (const rawLine of normalized.split("\n")) {
    const cleanedLine = rawLine.trim().replace(/^\s*-\s*/, "");
    const separatorIndex = cleanedLine.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const rawLabel = cleanedLine.slice(0, separatorIndex);
    const rawValue = cleanedLine.slice(separatorIndex + 1);
    const label = normalizeIdentityLabel(rawLabel);
    const value = cleanMarkdownText(rawValue);
    if (!value) {
      continue;
    }

    const field = IDENTITY_FIELD_ALIASES[label];
    if (!field) {
      continue;
    }

    details[field] = value;
  }

  return details;
}

function matchesIdentityField(line: string, field: keyof AgentIdentityDetails) {
  const cleanedLine = line.trim().replace(/^\s*-\s*/, "");
  const separatorIndex = cleanedLine.indexOf(":");
  if (separatorIndex === -1) {
    return false;
  }

  const rawLabel = cleanedLine.slice(0, separatorIndex);
  const label = normalizeIdentityLabel(rawLabel);
  return IDENTITY_FIELD_ALIASES[label] === field;
}

function upsertIdentityField(
  lines: string[],
  field: Exclude<keyof AgentIdentityDetails, "avatar">,
  value: string,
) {
  const nextLine = `- ${IDENTITY_FIELD_LABELS[field]}: ${value}`;
  const index = lines.findIndex((line) => matchesIdentityField(line, field));
  if (index >= 0) {
    lines[index] = nextLine;
    return lines;
  }

  const insertionIndex = Math.min(lines.length, 1 + Object.keys(IDENTITY_FIELD_LABELS).length);
  lines.splice(insertionIndex, 0, nextLine);
  return lines;
}

export function buildAgentIdentityContent(params: {
  previousContent?: string;
  name: string;
  emoji: string;
  role: string;
  description: string;
}) {
  const name = cleanMarkdownText(params.name) || "未命名员工";
  const emoji = cleanMarkdownText(params.emoji) || "🤖";
  const role = cleanMarkdownText(params.role) || "AI 员工";
  const description = cleanMarkdownText(params.description) || "协助用户完成相关工作";
  const base = params.previousContent?.replace(/\r\n/g, "\n").trimEnd() || "";
  const lines = base ? base.split("\n") : [];

  if (lines.length === 0) {
    lines.push(`# ${name}`, "");
  } else if (/^#\s+/u.test(lines[0])) {
    lines[0] = `# ${name}`;
  } else {
    lines.unshift(`# ${name}`, "");
  }

  upsertIdentityField(lines, "name", name);
  upsertIdentityField(lines, "emoji", emoji);
  upsertIdentityField(lines, "role", role);
  upsertIdentityField(lines, "description", description);

  const normalized = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return `${normalized}\n`;
}

export function pickAgentCreatedAtMs(files: AgentFile[]) {
  const timestamps = files
    .map((file) => file.updatedAtMs)
    .filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0,
    );

  if (timestamps.length === 0) {
    return undefined;
  }

  return Math.min(...timestamps);
}

export function formatAgentCreatedAt(createdAtMs?: number) {
  if (typeof createdAtMs !== "number" || !Number.isFinite(createdAtMs) || createdAtMs <= 0) {
    return "—";
  }

  return new Date(createdAtMs).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
