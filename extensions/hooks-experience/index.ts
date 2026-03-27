import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const DEFAULT_ENDPOINT = "http://localhost:3001/api/experience/inject";
const DEFAULT_TIMEOUT_MS = 500;
const DEFAULT_LIMIT = 6;
const MIN_TIMEOUT_MS = 1;
const MAX_TIMEOUT_MS = 10_000;
const MIN_LIMIT = 1;
const MAX_LIMIT = 20;

type ExperienceHookConfig = {
  endpoint: string;
  timeoutMs: number;
  limit: number;
};

type ExperienceItem = {
  kind?: string;
  trigger?: string;
  rule?: string;
  antiPattern?: string;
};

type ExperienceInjectPayload = {
  verified: ExperienceItem[];
  recent: ExperienceItem[];
};

const experienceHookConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    endpoint: {
      type: "string",
      default: DEFAULT_ENDPOINT,
    },
    timeoutMs: {
      type: "number",
      minimum: MIN_TIMEOUT_MS,
      maximum: MAX_TIMEOUT_MS,
      default: DEFAULT_TIMEOUT_MS,
    },
    limit: {
      type: "number",
      minimum: MIN_LIMIT,
      maximum: MAX_LIMIT,
      default: DEFAULT_LIMIT,
    },
  },
} as const;

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readBoundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function resolveExperienceHookConfig(input: unknown): ExperienceHookConfig {
  const config = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    endpoint: readNonEmptyString(config.endpoint) ?? DEFAULT_ENDPOINT,
    timeoutMs: readBoundedInteger(
      config.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    ),
    limit: readBoundedInteger(config.limit, DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT),
  };
}

function parseAgentIdFromSessionKey(sessionKey?: string): string | undefined {
  const raw = readNonEmptyString(sessionKey);
  if (!raw) {
    return undefined;
  }
  const match = raw.match(/^agent:([^:]+):/i);
  return readNonEmptyString(match?.[1]);
}

function parseGroupIdFromSessionKey(sessionKey?: string): string | undefined {
  const raw = readNonEmptyString(sessionKey);
  if (!raw) {
    return undefined;
  }
  const match = raw.match(/:group:([^:]+)(?::|$)/i);
  const encodedGroupId = readNonEmptyString(match?.[1]);
  if (!encodedGroupId) {
    return undefined;
  }
  try {
    return readNonEmptyString(decodeURIComponent(encodedGroupId)) ?? encodedGroupId;
  } catch {
    return encodedGroupId;
  }
}

function normalizeExperienceItems(value: unknown): ExperienceItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: ExperienceItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const row = entry as Record<string, unknown>;
    const item: ExperienceItem = {
      kind: readNonEmptyString(row.kind),
      trigger: readNonEmptyString(row.trigger),
      rule: readNonEmptyString(row.rule),
      antiPattern: readNonEmptyString(row.anti_pattern),
    };
    if (!item.trigger && !item.rule && !item.antiPattern) {
      continue;
    }
    items.push(item);
  }

  return items;
}

function parseExperienceInjectPayload(value: unknown): ExperienceInjectPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    verified: normalizeExperienceItems(record.verified),
    recent: normalizeExperienceItems(record.recent),
  };
}

function formatExperienceItem(item: ExperienceItem, pending: boolean): string | undefined {
  const trigger = item.trigger ? `"${item.trigger}"` : "当前场景";
  const suffix = pending ? "（待验证）" : "";

  if (item.kind === "anti_pattern" || item.antiPattern) {
    const antiPattern = item.antiPattern ?? item.rule;
    if (!antiPattern) {
      return undefined;
    }
    return `- 避免在 ${trigger} 中：${antiPattern}${suffix}`;
  }

  if (!item.rule) {
    return undefined;
  }
  return `- 当 ${trigger} 时，优先：${item.rule}${suffix}`;
}

function formatExperienceSection(
  heading: string,
  items: ExperienceItem[],
  pending: boolean,
): string | undefined {
  const lines = items
    .map((item) => formatExperienceItem(item, pending))
    .filter((line): line is string => Boolean(line));
  if (lines.length === 0) {
    return undefined;
  }
  return `${heading}\n${lines.join("\n")}`;
}

function formatExperiencePayload(payload: ExperienceInjectPayload) {
  const prependSystemContext = formatExperienceSection("【已验证经验】", payload.verified, false);
  const prependContext = formatExperienceSection(
    "【近期候选经验】（待验证，仅供参考）",
    payload.recent,
    true,
  );
  if (!prependSystemContext && !prependContext) {
    return undefined;
  }
  return {
    prependSystemContext,
    prependContext,
  };
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

const plugin = {
  id: "hooks-experience",
  name: "Hooks Experience",
  description: "Inject experience guidance into prompts before agent reasoning.",
  configSchema: experienceHookConfigSchema,
  register(api: OpenClawPluginApi) {
    const config = resolveExperienceHookConfig(api.pluginConfig);

    api.on("before_prompt_build", async (_event, ctx) => {
      const ctxRecord = ctx as Record<string, unknown>;
      const sessionKey = readNonEmptyString(ctx.sessionKey);
      const agentId = readNonEmptyString(ctx.agentId) ?? parseAgentIdFromSessionKey(sessionKey);
      // Group scope is encoded in the Wurenju session key: agent:<agentId>:group:<groupId>.
      const groupId =
        readNonEmptyString(ctxRecord.groupId) ?? parseGroupIdFromSessionKey(sessionKey);
      if (!groupId) {
        return;
      }

      try {
        const url = new URL(config.endpoint);
        url.searchParams.set("groupId", groupId);
        url.searchParams.set("limit", String(config.limit));
        if (agentId) {
          url.searchParams.set("agentId", agentId);
        }

        const response = await fetchWithTimeout(url.toString(), config.timeoutMs);
        if (!response.ok) {
          api.logger.warn(`hooks-experience: inject request failed with status ${response.status}`);
          return;
        }

        const payload = parseExperienceInjectPayload(await response.json());
        if (!payload) {
          api.logger.warn("hooks-experience: inject response payload is invalid");
          return;
        }

        return formatExperiencePayload(payload);
      } catch (error) {
        api.logger.warn(`hooks-experience: inject request failed: ${String(error)}`);
        return;
      }
    });
  },
};

export default plugin;
