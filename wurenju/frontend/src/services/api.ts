type ApiRequestOptions = RequestInit & {
  timeoutMs?: number;
};

type ApiMutationOptions = {
  keepalive?: boolean;
  timeoutMs?: number;
};

type ApiQueryValue = string | number | boolean | null | undefined;

type ImportMetaEnvWithApi = ImportMeta & {
  env?: {
    VITE_API_BASE_URL?: string;
  };
};

export type BackendEmployee = {
  id: string;
  name: string | null;
  avatar: string | null;
  position: string | null;
  department: string | null;
  description: string | null;
  pinned: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type BackendDepartment = {
  id: string;
  name: string | null;
  icon: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type BackendGroupMember = {
  group_id: string;
  agent_id: string;
  role: string;
  created_at: string;
  updated_at: string;
};

export type BackendGroup = {
  id: string;
  name: string | null;
  icon: string | null;
  description: string | null;
  owner_agent_id: string | null;
  announcement: string | null;
  announcement_version: number;
  require_acknowledgement?: number | null;
  urge_enabled: number;
  urge_paused: number;
  urge_interval: number | null;
  urge_count: number;
  urge_no_response_count: number;
  urge_last_checked_at: string | null;
  last_urge_at: string | null;
  urge_stop_reason: string | null;
  max_rounds: number;
  created_at: string;
  updated_at: string;
  members: BackendGroupMember[];
};

export type BackendArchive = {
  id: string;
  type: "direct" | "group";
  source_id: string;
  source_name: string | null;
  title: string | null;
  messages: unknown[];
  message_count: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type BackendCronTask = {
  id: string;
  agent_id: string | null;
  name: string | null;
  reply_mode: string | null;
  reply_target_id: string | null;
  display_status: string | null;
  created_at: string;
  updated_at: string;
};

export type BackendSetting = {
  key: string;
  value: string | null;
  created_at: string;
  updated_at: string;
};

export type BackendMigratePayload = Record<string, unknown>;

export class ApiError extends Error {
  status: number;
  data?: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

const DEFAULT_API_BASE_URL =
  (import.meta as ImportMetaEnvWithApi).env?.VITE_API_BASE_URL?.trim() ||
  "http://localhost:3001/api";

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/u, "");
}

function buildUrl(baseUrl: string, path: string) {
  if (/^https?:\/\//iu.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizeBaseUrl(baseUrl)}${normalizedPath}`;
}

function buildQueryString(query?: Record<string, ApiQueryValue>) {
  if (!query) {
    return "";
  }

  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    params.set(key, String(value));
  });

  const raw = params.toString();
  return raw ? `?${raw}` : "";
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

function createApiClient(baseUrl = DEFAULT_API_BASE_URL) {
  const resolvedBaseUrl = normalizeBaseUrl(baseUrl);

  async function request<T>(path: string, options: ApiRequestOptions = {}) {
    const { timeoutMs = 10_000, headers, ...init } = options;
    const scheduleTimeout =
      typeof window !== "undefined" && typeof window.setTimeout === "function"
        ? window.setTimeout.bind(window)
        : globalThis.setTimeout.bind(globalThis);
    const clearScheduledTimeout =
      typeof window !== "undefined" && typeof window.clearTimeout === "function"
        ? window.clearTimeout.bind(window)
        : globalThis.clearTimeout.bind(globalThis);
    const controller = new AbortController();
    const timeoutId = scheduleTimeout(() => {
      controller.abort();
    }, timeoutMs);
    const url = buildUrl(resolvedBaseUrl, path);

    try {
      console.log(`[API] ${init.method ?? "GET"} ${url}`);

      const response = await fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        // 大型 JSON（例如 data URL 头像）配合 keepalive 会被浏览器直接拦截，
        // 这里改成仅在调用方显式传入时才启用。
        signal: controller.signal,
      });
      const payload = await parseJsonSafe(response);

      if (!response.ok) {
        const message = resolveErrorMessage(payload, `请求失败：${response.status}`);
        throw new ApiError(message, response.status, payload);
      }

      return payload as T;
    } catch (error) {
      const normalizedError =
        error instanceof DOMException && error.name === "AbortError"
          ? new Error("请求超时，请检查虾班后端是否已启动")
          : error;
      console.error("[API] 请求失败:", {
        url,
        method: init.method ?? "GET",
        error: normalizedError,
      });
      throw normalizedError;
    } finally {
      clearScheduledTimeout(timeoutId);
    }
  }

  return {
    request,
  };
}

const client = createApiClient();

export const apiClient = {
  request: client.request,
  baseUrl: DEFAULT_API_BASE_URL,
};

export const employeesApi = {
  list(options?: { timeoutMs?: number }) {
    return client.request<BackendEmployee[]>("/employees", {
      timeoutMs: options?.timeoutMs,
    });
  },
  get(id: string) {
    return client.request<BackendEmployee>(`/employees/${encodeURIComponent(id)}`);
  },
  create(payload: Record<string, unknown>) {
    return client.request<BackendEmployee>("/employees", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  update(id: string, payload: Record<string, unknown>) {
    return client.request<BackendEmployee>(`/employees/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  remove(id: string, options?: ApiMutationOptions) {
    return client.request<{ success: true }>(`/employees/${encodeURIComponent(id)}`, {
      method: "DELETE",
      keepalive: options?.keepalive ?? true,
      timeoutMs: options?.timeoutMs,
    });
  },
};

export const departmentsApi = {
  list() {
    return client.request<BackendDepartment[]>("/departments");
  },
  create(payload: Record<string, unknown>) {
    return client.request<BackendDepartment>("/departments", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  update(id: string, payload: Record<string, unknown>) {
    return client.request<BackendDepartment>(`/departments/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  remove(id: string, options?: ApiMutationOptions) {
    return client.request<{ success: true }>(`/departments/${encodeURIComponent(id)}`, {
      method: "DELETE",
      keepalive: options?.keepalive ?? true,
      timeoutMs: options?.timeoutMs,
    });
  },
};

export const groupsApi = {
  list() {
    return client.request<BackendGroup[]>("/groups");
  },
  get(id: string) {
    return client.request<BackendGroup>(`/groups/${encodeURIComponent(id)}`);
  },
  create(payload: Record<string, unknown>) {
    return client.request<BackendGroup>("/groups", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  update(id: string, payload: Record<string, unknown>, options?: ApiMutationOptions) {
    return client.request<BackendGroup>(`/groups/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
      ...(options?.keepalive === undefined ? {} : { keepalive: options.keepalive }),
      ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
  },
  remove(id: string, options?: ApiMutationOptions) {
    return client.request<{ success: true }>(`/groups/${encodeURIComponent(id)}`, {
      method: "DELETE",
      keepalive: options?.keepalive ?? true,
      timeoutMs: options?.timeoutMs,
    });
  },
  addMember(groupId: string, payload: Record<string, unknown>) {
    return client.request<BackendGroup>(`/groups/${encodeURIComponent(groupId)}/members`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  removeMember(groupId: string, agentId: string) {
    return client.request<BackendGroup>(
      `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(agentId)}`,
      {
        method: "DELETE",
      },
    );
  },
};

export const archivesApi = {
  list(type?: "direct" | "group") {
    const query = type ? `?type=${encodeURIComponent(type)}` : "";
    return client.request<BackendArchive[]>(`/archives${query}`, {
      cache: "no-store",
    } as any);
  },
  get(id: string) {
    return client.request<BackendArchive>(`/archives/${encodeURIComponent(id)}`);
  },
  create(payload: Record<string, unknown>) {
    return client.request<BackendArchive>("/archives", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  update(id: string, payload: Record<string, unknown>) {
    return client.request<BackendArchive>(`/archives/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  remove(id: string, options?: ApiMutationOptions) {
    return client.request<{ success: true }>(`/archives/${encodeURIComponent(id)}`, {
      method: "DELETE",
      keepalive: options?.keepalive ?? true,
      timeoutMs: options?.timeoutMs,
    });
  },
};

export const cronTasksApi = {
  list(agentId?: string) {
    const query = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
    return client.request<BackendCronTask[]>(`/cron-tasks${query}`);
  },
  get(id: string) {
    return client.request<BackendCronTask>(`/cron-tasks/${encodeURIComponent(id)}`);
  },
  create(payload: Record<string, unknown>) {
    return client.request<BackendCronTask>("/cron-tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  update(id: string, payload: Record<string, unknown>) {
    return client.request<BackendCronTask>(`/cron-tasks/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  remove(id: string, options?: ApiMutationOptions) {
    return client.request<{ success: true }>(`/cron-tasks/${encodeURIComponent(id)}`, {
      method: "DELETE",
      keepalive: options?.keepalive ?? true,
      timeoutMs: options?.timeoutMs,
    });
  },
};

export const settingsApi = {
  list(options?: { timeoutMs?: number }) {
    return client.request<BackendSetting[]>("/settings", {
      timeoutMs: options?.timeoutMs,
    });
  },
  get(key: string) {
    return client.request<BackendSetting>(`/settings/${encodeURIComponent(key)}`);
  },
  update(key: string, value: unknown) {
    return client.request<BackendSetting>(`/settings/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    });
  },
};

export const migrateApi = {
  run(payload: BackendMigratePayload) {
    return client.request<{
      success: true;
      imported: {
        employees: number;
        departments: number;
        groups: number;
        group_members: number;
        archives: number;
        cron_tasks: number;
        settings: number;
      };
    }>("/migrate", {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: 20_000,
    });
  },
};

export const storageApi = {
  health(options?: { timeoutMs?: number }) {
    return client.request<{ ok: true; updated_at: string }>("/storage/health", {
      timeoutMs: options?.timeoutMs ?? 1_500,
    });
  },
  get<T>(type: string, query?: Record<string, ApiQueryValue>, options?: { timeoutMs?: number }) {
    return client.request<T>(`/storage/${encodeURIComponent(type)}${buildQueryString(query)}`, {
      timeoutMs: options?.timeoutMs,
    });
  },
  post<T>(type: string, payload: Record<string, unknown>, options?: { timeoutMs?: number }) {
    return client.request<T>(`/storage/${encodeURIComponent(type)}`, {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: options?.timeoutMs,
    });
  },
  put<T>(type: string, payload: Record<string, unknown>, options?: { timeoutMs?: number }) {
    return client.request<T>(`/storage/${encodeURIComponent(type)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
      timeoutMs: options?.timeoutMs,
    });
  },
  delete<T>(type: string, query?: Record<string, ApiQueryValue>, options?: ApiMutationOptions) {
    return client.request<T>(`/storage/${encodeURIComponent(type)}${buildQueryString(query)}`, {
      method: "DELETE",
      keepalive: options?.keepalive ?? true,
      timeoutMs: options?.timeoutMs,
    });
  },
};
