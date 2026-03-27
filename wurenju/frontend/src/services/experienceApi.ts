type ApiQueryValue = string | number | boolean | null | undefined;

type ExperienceRequestOptions = RequestInit & {
  timeoutMs?: number;
};

type ImportMetaEnvWithApi = ImportMeta & {
  env?: {
    VITE_API_BASE_URL?: string;
  };
};

export type ExperienceFeedbackType =
  | "negative_explicit"
  | "positive_explicit"
  | "positive_weak"
  | "neutral";

export type ExperienceEventType = "feedback";

export type ExperienceStatus = "pending" | "verified" | "deprecated" | "rejected" | "superseded";

export type ExperienceKind = "lesson" | "anti_pattern";

export type ExperienceRisk = "low" | "medium" | "high";

export type BackendProcessEvent = {
  id: string;
  session_key: string;
  group_id: string;
  target_agent_id: string;
  type: ExperienceEventType;
  feedback_type: ExperienceFeedbackType;
  sender_id: string;
  sender_name: string | null;
  content: string;
  normalized_content: string | null;
  task_type_json: string | null;
  confidence_delta: number;
  created_at: string;
};

export type BackendExperienceItem = {
  id: string;
  status: ExperienceStatus;
  kind: ExperienceKind;
  task_type_json: string | null;
  trigger: string | null;
  rule: string;
  anti_pattern: string | null;
  group_id: string | null;
  session_key: string | null;
  feedback_score: number | null;
  repeated_hits: number;
  confidence: number;
  conflict_with: string | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
  valid_from: string | null;
  expires_at: string | null;
  risk: ExperienceRisk;
};

export type ExperienceInjectPayload = {
  verified: BackendExperienceItem[];
  recent: BackendExperienceItem[];
};

export type CreateProcessEventInput = {
  id?: string;
  sessionKey: string;
  groupId: string;
  targetAgentId: string;
  type?: ExperienceEventType;
  feedbackType: ExperienceFeedbackType;
  senderId: string;
  senderName?: string | null;
  content: string;
  normalizedContent?: string | null;
  taskTypeJson?: unknown[] | string | null;
  confidenceDelta?: number | null;
  createdAt?: string;
};

export type ListProcessEventsParams = {
  groupId?: string;
  targetAgentId?: string;
  sessionKey?: string;
  limit?: number;
};

export type GetLastFeedbackEventParams = {
  groupId: string;
  targetAgentId: string;
  sessionKey?: string;
};

export type UpsertExperienceItemInput = {
  id?: string;
  status?: ExperienceStatus;
  kind?: ExperienceKind;
  taskTypeJson?: unknown[] | string | null;
  trigger?: string | null;
  rule: string;
  antiPattern?: string | null;
  groupId?: string | null;
  sessionKey?: string | null;
  feedbackScore?: number | null;
  repeatedHits?: number;
  confidence?: number;
  conflictWith?: string | null;
  supersededBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  lastSeenAt?: string | null;
  validFrom?: string | null;
  expiresAt?: string | null;
  risk?: ExperienceRisk;
};

export type ListExperienceItemsParams = {
  status?: ExperienceStatus;
  kind?: ExperienceKind;
  limit?: number;
};

export type InjectExperienceParams = {
  groupId: string;
  agentId?: string;
  taskType?: string;
  limit?: number;
};

export const DEFAULT_EXPERIENCE_API_BASE_URL = "http://localhost:3001/api/experience";

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/u, "");
}

function resolveExperienceApiBaseUrl(explicitBaseUrl?: string) {
  if (explicitBaseUrl?.trim()) {
    return normalizeBaseUrl(explicitBaseUrl.trim());
  }

  const configuredApiBaseUrl = (import.meta as ImportMetaEnvWithApi).env?.VITE_API_BASE_URL?.trim();
  if (configuredApiBaseUrl) {
    return `${normalizeBaseUrl(configuredApiBaseUrl)}/experience`;
  }

  return DEFAULT_EXPERIENCE_API_BASE_URL;
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, ApiQueryValue>) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${normalizeBaseUrl(baseUrl)}${normalizedPath}`);

  if (query) {
    url.search = buildSearchParams(query).toString();
  }

  return url.toString();
}

function buildSearchParams(query: Record<string, ApiQueryValue>) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    params.set(key, String(value));
  });

  return params;
}

function buildPath(path: string, query?: Record<string, ApiQueryValue>) {
  if (!query) {
    return path;
  }

  const serialized = buildSearchParams(query).toString();
  return serialized ? `${path}?${serialized}` : path;
}

async function parseJsonSafe(response: Response) {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function resolveErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim();
    }

    if (typeof record.error === "string" && record.error.trim()) {
      return record.error.trim();
    }
  }

  return fallback;
}

function serializeJsonField(value: unknown[] | string | null | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function nowTimestampText() {
  return String(Date.now());
}

async function requestExperienceApi<T>(
  baseUrl: string,
  path: string,
  options: ExperienceRequestOptions = {},
) {
  const { timeoutMs = 30_000, headers, ...init } = options;
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const requestHeaders = new Headers({
      "Content-Type": "application/json",
    });
    if (headers) {
      new Headers(headers).forEach((value, key) => {
        requestHeaders.set(key, value);
      });
    }

    const response = await fetch(buildUrl(baseUrl, path), {
      ...init,
      headers: requestHeaders,
      signal: controller.signal,
    });
    const payload = await parseJsonSafe(response);

    if (!response.ok) {
      throw new Error(resolveErrorMessage(payload, `经验系统请求失败：${response.status}`));
    }

    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("经验系统请求超时，请检查后端服务是否已启动", { cause: error });
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("经验系统请求失败", { cause: error });
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export function createExperienceApi(baseUrl?: string) {
  const resolvedBaseUrl = resolveExperienceApiBaseUrl(baseUrl);

  const api = {
    baseUrl: resolvedBaseUrl,
    async writeProcessEvent(input: CreateProcessEventInput) {
      return requestExperienceApi<{ success: true }>(resolvedBaseUrl, "/events", {
        method: "POST",
        body: JSON.stringify({
          id: input.id ?? crypto.randomUUID(),
          sessionKey: input.sessionKey,
          groupId: input.groupId,
          targetAgentId: input.targetAgentId,
          type: input.type ?? "feedback",
          feedbackType: input.feedbackType,
          senderId: input.senderId,
          ...(input.senderName === undefined ? {} : { senderName: input.senderName }),
          content: input.content,
          ...(input.normalizedContent === undefined
            ? {}
            : { normalizedContent: input.normalizedContent }),
          ...(input.taskTypeJson === undefined
            ? {}
            : { taskTypeJson: serializeJsonField(input.taskTypeJson) }),
          ...(input.confidenceDelta === undefined
            ? {}
            : { confidenceDelta: input.confidenceDelta }),
          createdAt: input.createdAt ?? nowTimestampText(),
        }),
      });
    },
    async listProcessEvents(params: ListProcessEventsParams = {}) {
      return requestExperienceApi<BackendProcessEvent[]>(
        resolvedBaseUrl,
        buildPath("/events", {
          groupId: params.groupId,
          targetAgentId: params.targetAgentId,
          sessionKey: params.sessionKey,
          limit: params.limit,
        }),
      );
    },
    async getLastFeedbackEvent(params: GetLastFeedbackEventParams) {
      return requestExperienceApi<BackendProcessEvent | null>(
        resolvedBaseUrl,
        buildPath("/events/last", {
          groupId: params.groupId,
          targetAgentId: params.targetAgentId,
          sessionKey: params.sessionKey,
        }),
      );
    },
    async upsertExperienceItem(input: UpsertExperienceItemInput) {
      const generatedId = input.id ?? crypto.randomUUID();
      const now = nowTimestampText();

      return requestExperienceApi<BackendExperienceItem>(resolvedBaseUrl, "/items", {
        method: "POST",
        body: JSON.stringify({
          id: generatedId,
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.kind === undefined ? {} : { kind: input.kind }),
          ...(input.taskTypeJson === undefined
            ? {}
            : { taskTypeJson: serializeJsonField(input.taskTypeJson) }),
          ...(input.trigger === undefined ? {} : { trigger: input.trigger }),
          rule: input.rule,
          ...(input.antiPattern === undefined ? {} : { antiPattern: input.antiPattern }),
          ...(input.groupId === undefined ? {} : { groupId: input.groupId }),
          ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
          ...(input.feedbackScore === undefined ? {} : { feedbackScore: input.feedbackScore }),
          ...(input.repeatedHits === undefined ? {} : { repeatedHits: input.repeatedHits }),
          ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
          ...(input.conflictWith === undefined ? {} : { conflictWith: input.conflictWith }),
          ...(input.supersededBy === undefined ? {} : { supersededBy: input.supersededBy }),
          ...((input.createdAt ?? (!input.id ? now : undefined)) === undefined
            ? {}
            : { createdAt: input.createdAt ?? now }),
          updatedAt: input.updatedAt ?? now,
          ...(input.lastSeenAt === undefined ? {} : { lastSeenAt: input.lastSeenAt }),
          ...(input.validFrom === undefined ? {} : { validFrom: input.validFrom }),
          ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
          ...(input.risk === undefined ? {} : { risk: input.risk }),
        }),
      });
    },
    async upsertExperienceCandidate(input: UpsertExperienceItemInput) {
      return api.upsertExperienceItem(input);
    },
    async listExperienceItems(params: ListExperienceItemsParams = {}) {
      return requestExperienceApi<BackendExperienceItem[]>(
        resolvedBaseUrl,
        buildPath("/items", {
          status: params.status,
          kind: params.kind,
          limit: params.limit,
        }),
      );
    },
    async updateExperienceStatus(
      id: string,
      status: ExperienceStatus,
      updatedAt = nowTimestampText(),
    ) {
      return requestExperienceApi<BackendExperienceItem>(
        resolvedBaseUrl,
        `/items/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status,
            updatedAt,
          }),
        },
      );
    },
    async promoteExperience(id: string) {
      return requestExperienceApi<BackendExperienceItem>(
        resolvedBaseUrl,
        `/items/${encodeURIComponent(id)}/promote`,
        {
          method: "POST",
        },
      );
    },
    async deprecateExperience(id: string) {
      return requestExperienceApi<BackendExperienceItem>(
        resolvedBaseUrl,
        `/items/${encodeURIComponent(id)}/deprecate`,
        {
          method: "POST",
        },
      );
    },
    async rejectExperience(id: string) {
      return requestExperienceApi<BackendExperienceItem>(
        resolvedBaseUrl,
        `/items/${encodeURIComponent(id)}/reject`,
        {
          method: "POST",
        },
      );
    },
    async getExperiencesForInject(params: InjectExperienceParams) {
      return requestExperienceApi<ExperienceInjectPayload>(
        resolvedBaseUrl,
        buildPath("/inject", {
          groupId: params.groupId,
          agentId: params.agentId,
          taskType: params.taskType,
          limit: params.limit,
        }),
      );
    },
  };

  return api;
}

export const experienceApi = createExperienceApi();
