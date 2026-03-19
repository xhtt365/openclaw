/**
 * Gateway WebSocket 连接服务
 *
 * 源码确认（只读自 OpenClaw `src/gateway` / `src/agents`）：
 * - `config.patch` / `config.apply` 的 handler 都会在写盘后调度 `scheduleGatewaySigusr1Restart(...)`。
 * - `config.set` 只写完整配置，`writeConfigFile(...)` 会刷新 runtime snapshot，更适合新增模型后保持 WS 不断开。
 * - `models.list` 会读取 `loadModelCatalog()` 并受 `agents.defaults.models` allowlist 过滤。
 * - `agents.update` 只会改 `agents.list[].model`；代理型 `openai/openai-responses` 的 transport 需要前端自己补进配置。
 * - `provider=openai` + `api=openai-responses` + 第三方 `baseUrl` 时，默认会命中固定 OpenAI WS 路径；
 *   显式 `transport: "sse"` 才会回落到走代理 baseUrl 的 HTTP 路径。
 *
 * 所以前端新增模型流程选方案 B：`config.get -> merge -> config.set -> models.list`。
 */

import type {
  AgentFileGetResult,
  AgentFilesListResult,
  AgentFileSetResult,
  AgentWorkspaceFileEntry,
} from "@/types/agent";
import type {
  GatewayConfigEditorSnapshot,
  GatewayConfigSnapshot,
  GatewayConfigWriteResult,
} from "@/types/gateway";
import type {
  GatewayModelChoice,
  GatewayModelsListResult,
  ModelProviderGroup,
  ModelApiProtocol,
} from "@/types/model";
import { trackModelProviderError } from "@/utils/modelProviders";
import {
  resolveSessionRuntimeState,
  type SessionRuntimeListPayload,
  type SessionRuntimeState,
} from "@/utils/sessionRuntime";
import { normalizeUsage as normalizeGatewayUsage } from "@/utils/usage";

const GATEWAY_URL =
  (
    import.meta as ImportMeta & {
      env?: {
        VITE_GATEWAY_URL?: string;
      };
    }
  ).env?.VITE_GATEWAY_URL?.trim() || "ws://localhost:18789";
const GATEWAY_TOKEN_STORAGE_KEY = "wurenju.gateway.token";
const GATEWAY_DEVICE_IDENTITY_STORAGE_KEY = "wurenju.gateway.deviceIdentity";
const GATEWAY_OPERATOR_SCOPES = ["operator.read", "operator.write", "operator.admin"] as const;
const GATEWAY_CLIENT_ID = "openclaw-control-ui";
const GATEWAY_CLIENT_MODE = "ui";
const GATEWAY_CLIENT_DISPLAY_NAME = "虾班";
const GATEWAY_CLIENT_CAPABILITIES = ["tool-events"] as const;
const GATEWAY_RESTART_UNSUPPORTED_MESSAGE =
  "当前 Gateway 版本还不支持页面内重启。请先手动重启一次 Gateway，加载最新版本后再试。";

type StoredGatewayDeviceIdentity = {
  version: 1;
  deviceId: string;
  publicKey: string;
  privateKeyPkcs8: string;
  createdAtMs: number;
};

type GatewayDeviceIdentity = {
  deviceId: string;
  publicKey: string;
  privateKey: CryptoKey;
};

export interface GatewayMessageMeta {
  sessionKey?: string;
  runId?: string;
}

type MessageHandler = (messages: GatewayMessage[], meta?: GatewayMessageMeta) => void;
type StatusHandler = (status: "connecting" | "connected" | "disconnected") => void;
type GatewayEventHandler = (eventName: string, payload: Record<string, unknown>) => void;
type GatewayResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string };
};

type GatewayHelloOkPayload = {
  type?: "hello-ok";
  auth?: {
    scopes?: string[];
  };
  snapshot?: {
    stateDir?: string;
  };
};

type GatewayIncomingFrame = {
  type?: string;
  event?: string;
  id?: string;
  ok?: boolean;
  payload?: Record<string, unknown>;
  error?: {
    message?: string;
  };
};

export type GatewayAgentIdentity = {
  agentId: string;
  name?: string;
  avatar?: string;
  avatarUrl?: string;
  emoji?: string;
};

type GatewayAgentListIdentity = {
  name?: string;
  theme?: string;
  emoji?: string;
  avatar?: string;
  avatarUrl?: string;
};

type GatewayAgentListItem = {
  id: string;
  name?: string;
  identity?: GatewayAgentListIdentity;
};

export type GatewayAgentsListResponse = {
  defaultId: string;
  mainKey: string;
  scope: "per-sender" | "global";
  agents: GatewayAgentListItem[];
};

export type GatewayCreateAgentParams = {
  name: string;
  workspace: string;
  emoji?: string;
  avatar?: string;
};

export type GatewayCreateAgentResult = {
  ok: true;
  agentId: string;
  name: string;
  workspace: string;
};

export type GatewayAgentUpdateParams = {
  name?: string;
  workspace?: string;
  model?: string;
  avatar?: string;
};

export type GatewayAgentUpdateResult = {
  ok: true;
  agentId: string;
};

export type GatewayDeleteAgentResult = {
  ok: true;
  agentId: string;
  removedBindings: number;
};

type PendingRequest = {
  method: string;
  waitForChatFinal?: boolean;
  sessionKey?: string;
  agentId?: string;
  requestTag?: string;
  resolve: (data: GatewayResponseFrame) => void;
  reject: (error: Error) => void;
};

export type GatewayObservedRequestKind = "chat.send" | "agent";

export type GatewayObservedRequestStart = {
  kind: GatewayObservedRequestKind;
  requestId: string;
  sessionKey: string;
  agentId?: string | null;
  startedAt: number;
};

export type GatewayObservedRunAccepted = {
  kind: GatewayObservedRequestKind;
  requestId: string;
  runId: string;
  sessionKey: string;
  agentId?: string | null;
  acceptedAt: number;
};

export type GatewayObservedAssistantMessage = {
  kind: GatewayObservedRequestKind;
  runId?: string | null;
  sessionKey: string;
  agentId?: string | null;
  message: GatewayMessage;
  receivedAt: number;
};

export type GatewayObservedRequestError = {
  kind: GatewayObservedRequestKind;
  requestId?: string;
  runId?: string | null;
  sessionKey?: string;
  agentId?: string | null;
  message: string;
  occurredAt: number;
};

export type GatewayLifecycleObserver = {
  onRequestStart?: (event: GatewayObservedRequestStart) => void;
  onRunAccepted?: (event: GatewayObservedRunAccepted) => void;
  onAssistantMessage?: (event: GatewayObservedAssistantMessage) => void;
  onRequestError?: (event: GatewayObservedRequestError) => void;
};

export interface GatewayMessage {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  model?: string;
  provider?: string;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost?: { total: number };
  };
  timestamp: number;
}

export interface GatewayHistoryPayload {
  sessionKey?: string;
  messages?: unknown[];
  sessionId?: string;
  thinkingLevel?: string;
  verboseLevel?: string;
}

export interface GatewayAgentEventPayload {
  runId?: string;
  seq?: number;
  stream?: string;
  ts?: number;
  sessionKey?: string;
  data?: Record<string, unknown>;
}

export interface GatewayChatEventContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
}

export interface GatewayChatEventPayload {
  runId?: string;
  sessionKey?: string;
  seq?: number;
  state?: "delta" | "final" | "error" | "aborted";
  message?: {
    role?: "user" | "assistant";
    content?: GatewayChatEventContentBlock[];
    timestamp?: number;
    usage?: Record<string, unknown>;
  };
  errorMessage?: string;
}

export interface GatewayAgentTurnParams {
  agentId?: string;
  sessionKey: string;
  message: string;
  thinking?: string;
  deliver?: boolean;
  timeout?: number;
  extraSystemPrompt?: string;
}

export interface GatewayChatAttachmentInput {
  dataUrl: string;
  mimeType: string;
}

export interface GatewayAgentTurnAcceptedPayload {
  runId?: string;
  status?: string;
  acceptedAt?: number;
}

export interface GatewayAgentWaitPayload {
  runId?: string;
  status?: string;
  startedAt?: number;
  endedAt?: number;
  error?: string;
}

export type GatewayCronSchedule =
  | {
      kind: "at";
      at: string;
    }
  | {
      kind: "every";
      everyMs: number;
      anchorMs?: number;
    }
  | {
      kind: "cron";
      expr: string;
      tz?: string;
      staggerMs?: number;
    };

export type GatewayCronSessionTarget = "main" | "isolated";
export type GatewayCronWakeMode = "next-heartbeat" | "now";
export type GatewayCronDeliveryMode = "none" | "announce" | "webhook";
export type GatewayCronRunStatus = "ok" | "error" | "skipped";
export type GatewayCronDeliveryStatus = "delivered" | "not-delivered" | "unknown" | "not-requested";

export interface GatewayCronFailureDestination {
  channel?: string;
  to?: string;
  accountId?: string;
  mode?: "announce" | "webhook";
}

export interface GatewayCronDelivery {
  mode: GatewayCronDeliveryMode;
  channel?: string;
  to?: string;
  accountId?: string;
  bestEffort?: boolean;
  failureDestination?: GatewayCronFailureDestination;
}

export interface GatewayCronFailureAlert {
  after?: number;
  channel?: string;
  to?: string;
  cooldownMs?: number;
  mode?: "announce" | "webhook";
  accountId?: string;
}

export type GatewayCronPayload =
  | {
      kind: "systemEvent";
      text: string;
    }
  | {
      kind: "agentTurn";
      message: string;
      model?: string;
      fallbacks?: string[];
      thinking?: string;
      timeoutSeconds?: number;
      allowUnsafeExternalContent?: boolean;
      lightContext?: boolean;
      deliver?: boolean;
      channel?: string;
      to?: string;
      bestEffortDeliver?: boolean;
    };

export type GatewayCronPayloadPatch =
  | {
      kind: "systemEvent";
      text?: string;
    }
  | {
      kind: "agentTurn";
      message?: string;
      model?: string;
      fallbacks?: string[];
      thinking?: string;
      timeoutSeconds?: number;
      allowUnsafeExternalContent?: boolean;
      lightContext?: boolean;
      deliver?: boolean;
      channel?: string;
      to?: string;
      bestEffortDeliver?: boolean;
    };

export interface GatewayCronJob {
  id: string;
  name: string;
  sessionTarget?: GatewayCronSessionTarget;
  wakeMode?: GatewayCronWakeMode;
  enabled?: boolean;
  agentId?: string | null;
  sessionKey?: string | null;
  description?: string;
  deleteAfterRun?: boolean;
  createdAtMs?: number;
  updatedAtMs?: number;
  schedule?: GatewayCronSchedule;
  payload?: GatewayCronPayload;
  delivery?: GatewayCronDelivery;
  failureAlert?: GatewayCronFailureAlert | false;
  state?: {
    nextRunAtMs?: number;
    runningAtMs?: number;
    lastRunAtMs?: number;
    lastRunStatus?: string;
    lastStatus?: string;
    lastError?: string;
    lastDeliveryStatus?: GatewayCronDeliveryStatus;
    lastDeliveryError?: string;
    lastDurationMs?: number;
    consecutiveErrors?: number;
    lastDelivered?: boolean;
  };
}

export interface GatewayCronListResponse {
  jobs?: GatewayCronJob[];
  total?: number;
  offset?: number;
  limit?: number;
  hasMore?: boolean;
  nextOffset?: number | null;
}

export interface GatewayCronStatusResponse {
  enabled?: boolean;
  storePath?: string;
  jobs?: number;
  nextWakeAtMs?: number | null;
}

export interface GatewayCronCreateParams {
  name: string;
  agentId?: string | null;
  sessionKey?: string | null;
  description?: string;
  enabled?: boolean;
  deleteAfterRun?: boolean;
  schedule: GatewayCronSchedule;
  sessionTarget: GatewayCronSessionTarget;
  wakeMode: GatewayCronWakeMode;
  payload: GatewayCronPayload;
  delivery?: GatewayCronDelivery;
  failureAlert?: GatewayCronFailureAlert | false;
}

export interface GatewayCronJobPatch {
  name?: string;
  agentId?: string | null;
  sessionKey?: string | null;
  description?: string;
  enabled?: boolean;
  deleteAfterRun?: boolean;
  schedule?: GatewayCronSchedule;
  sessionTarget?: GatewayCronSessionTarget;
  wakeMode?: GatewayCronWakeMode;
  payload?: GatewayCronPayloadPatch;
  delivery?: Partial<GatewayCronDelivery>;
  failureAlert?: GatewayCronFailureAlert | false;
  state?: Partial<NonNullable<GatewayCronJob["state"]>>;
}

export interface GatewayCronRemoveResponse {
  ok?: boolean;
  removed?: boolean;
}

export interface GatewayCronRunResponse {
  ok?: boolean;
  ran?: boolean;
  enqueued?: boolean;
  runId?: string;
  reason?: string;
}

export interface GatewayCronRunLogEntry {
  ts: number;
  jobId: string;
  action: "finished";
  status?: GatewayCronRunStatus;
  error?: string;
  summary?: string;
  delivered?: boolean;
  deliveryStatus?: GatewayCronDeliveryStatus;
  deliveryError?: string;
  sessionId?: string;
  sessionKey?: string;
  runAtMs?: number;
  durationMs?: number;
  nextRunAtMs?: number;
  model?: string;
  provider?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
  };
  jobName?: string;
}

export interface GatewayCronRunsResponse {
  entries?: GatewayCronRunLogEntry[];
  total?: number;
  offset?: number;
  limit?: number;
  hasMore?: boolean;
  nextOffset?: number | null;
}

export interface GatewayCronEventPayload {
  jobId?: string;
  action?: "added" | "updated" | "removed" | "started" | "finished";
  runAtMs?: number;
  durationMs?: number;
  status?: "ok" | "error" | "skipped";
  error?: string;
  summary?: string;
  delivered?: boolean;
  deliveryStatus?: string;
  deliveryError?: string;
  sessionId?: string;
  sessionKey?: string;
  nextRunAtMs?: number;
  model?: string;
  provider?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
  };
}

type GatewaySessionMutationResult = Record<string, unknown>;
type GatewayChatAbortResult = {
  ok?: boolean;
  aborted?: boolean;
  runIds?: string[];
};
type GatewaySessionDefaultsPayload = {
  defaults?: {
    contextTokens?: number | null;
  };
  sessions?: Array<{
    contextTokens?: number | null;
  }>;
};

function toFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toPositiveInteger(value: unknown) {
  const parsed = toFiniteNumber(value);
  if (parsed === undefined || parsed <= 0) {
    return undefined;
  }
  return Math.max(1, Math.floor(parsed));
}

function isGroupSessionKey(value: unknown) {
  return typeof value === "string" && value.includes(":group:");
}

function parseAgentIdFromSessionKey(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("agent:")) {
    return null;
  }

  const agentId = value.split(":")[1]?.trim();
  return agentId || null;
}

function summarizeTextFieldForLog(label: string, value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  return `[${label} ${value.length} chars]`;
}

function dataUrlToBase64(dataUrl: string) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    content: match[2],
  };
}

function resolveRequestLogPrefix(method: string, params: Record<string, unknown>) {
  if ((method === "agent" || method === "chat.history") && isGroupSessionKey(params.sessionKey)) {
    return "[Group]";
  }

  return "[GW]";
}

function sanitizeRequestParamsForLog(method: string, params: Record<string, unknown>) {
  if (method === "config.patch" || method === "config.apply" || method === "config.set") {
    const next = { ...params };
    if (typeof next.raw === "string") {
      next.raw = `[json5 ${next.raw.length} chars]`;
    }
    return next;
  }

  if (method === "agent") {
    return {
      ...params,
      message: summarizeTextFieldForLog("message", params.message),
      thinking: summarizeTextFieldForLog("thinking", params.thinking),
      extraSystemPrompt: summarizeTextFieldForLog("system", params.extraSystemPrompt),
    };
  }

  return params;
}

function sanitizeResponsePayloadForLog(
  method: string,
  payload: Record<string, unknown> | undefined,
  params: Record<string, unknown>,
) {
  if (!payload) {
    return payload;
  }

  if (method === "chat.history") {
    return {
      sessionKey: typeof params.sessionKey === "string" ? params.sessionKey : undefined,
      messageCount: Array.isArray(payload.messages) ? payload.messages.length : 0,
    };
  }

  return payload;
}

function summarizeEventPayloadForLog(payload: unknown) {
  if (!isRecord(payload)) {
    return payload;
  }

  return {
    sessionKey: typeof payload.sessionKey === "string" ? payload.sessionKey : undefined,
    runId: typeof payload.runId === "string" ? payload.runId : undefined,
    state: typeof payload.state === "string" ? payload.state : undefined,
    stream: typeof payload.stream === "string" ? payload.stream : undefined,
    messageCount: Array.isArray(payload.messages) ? payload.messages.length : undefined,
    keys: Object.keys(payload),
  };
}

export function normalizeRestartGatewayError(error: unknown) {
  if (error instanceof Error && /unknown method:\s*gateway\.restart/i.test(error.message)) {
    return new Error(GATEWAY_RESTART_UNSUPPORTED_MESSAGE);
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("网关重启失败，请稍后重试");
}

function isPresentAgentWorkspaceFile(file: AgentWorkspaceFileEntry) {
  return !file.missing;
}

function groupModelsByProvider(models: GatewayModelChoice[]): ModelProviderGroup[] {
  const grouped = new Map<string, ModelProviderGroup["models"]>();

  for (const model of models) {
    const provider = typeof model.provider === "string" ? model.provider.trim() : "";
    const id = typeof model.id === "string" ? model.id.trim() : "";
    const name = typeof model.name === "string" && model.name.trim() ? model.name.trim() : id;
    if (!provider || !id) {
      continue;
    }

    const items = grouped.get(provider) ?? [];
    items.push({
      id,
      name,
      contextWindow: toFiniteNumber(model.contextWindow),
      reasoning: typeof model.reasoning === "boolean" ? model.reasoning : undefined,
      api:
        typeof model.api === "string" && model.api.trim()
          ? (model.api.trim() as ModelApiProtocol)
          : undefined,
    });
    grouped.set(provider, items);
  }

  return Array.from(grouped.entries())
    .toSorted(([leftProvider], [rightProvider]) => leftProvider.localeCompare(rightProvider))
    .map(([provider, models]) => ({
      provider,
      models: [...models].toSorted((left, right) => left.name.localeCompare(right.name)),
    }));
}

function toUint8Array(input: ArrayBuffer | Uint8Array) {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function bytesToBase64Url(input: ArrayBuffer | Uint8Array) {
  const bytes = toUint8Array(input);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).split("+").join("-").split("/").join("_").replace(/=+$/g, "");
}

function base64UrlToBytes(input: string) {
  const normalized = input.split("-").join("+").split("_").join("/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function sha256Hex(input: ArrayBuffer | Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", toUint8Array(input) as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function buildDeviceAuthPayloadV3(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string | null;
  nonce: string;
  platform?: string | null;
  deviceFamily?: string | null;
}) {
  const scopes = params.scopes.join(",");
  const token = params.token ?? "";
  const platform = params.platform?.trim() || "";
  const deviceFamily = params.deviceFamily?.trim() || "";
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
    params.nonce,
    platform,
    deviceFamily,
  ].join("|");
}

class GatewayService {
  private ws: WebSocket | null = null;
  private onMessage: MessageHandler | null = null;
  private onStatus: StatusHandler | null = null;
  private eventHandlers = new Set<GatewayEventHandler>();
  private lifecycleObservers = new Set<GatewayLifecycleObserver>();
  private pendingRequests = new Map<string, PendingRequest>();
  private pendingChatRuns = new Map<string, string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectRequestId: string | null = null;
  private connectNonce: string | null = null;
  private isHandshakeComplete = false;
  private connectPromise: Promise<void> | null = null;
  private resolveConnectPromise: (() => void) | null = null;
  private rejectConnectPromise: ((error: Error) => void) | null = null;
  private deviceIdentityPromise: Promise<GatewayDeviceIdentity> | null = null;
  private grantedScopes: string[] = [];
  private gatewayStateDir: string | null = null;

  // 注册回调
  setHandlers(onMessage: MessageHandler, onStatus: StatusHandler) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
  }

  addEventHandler(handler: GatewayEventHandler) {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  addLifecycleObserver(observer: GatewayLifecycleObserver) {
    this.lifecycleObservers.add(observer);
    return () => {
      this.lifecycleObservers.delete(observer);
    };
  }

  private notifyRequestStart(event: GatewayObservedRequestStart) {
    for (const observer of this.lifecycleObservers) {
      observer.onRequestStart?.(event);
    }
  }

  private notifyRunAccepted(event: GatewayObservedRunAccepted) {
    for (const observer of this.lifecycleObservers) {
      observer.onRunAccepted?.(event);
    }
  }

  private notifyAssistantMessage(event: GatewayObservedAssistantMessage) {
    for (const observer of this.lifecycleObservers) {
      observer.onAssistantMessage?.(event);
    }
  }

  private notifyRequestError(event: GatewayObservedRequestError) {
    for (const observer of this.lifecycleObservers) {
      observer.onRequestError?.(event);
    }
  }

  // 连接 Gateway
  connect() {
    if (this.ws?.readyState === WebSocket.OPEN && this.isHandshakeComplete) {
      return;
    }
    if (this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }
    if (this.ws?.readyState === WebSocket.OPEN && !this.isHandshakeComplete) {
      return;
    }
    this.onStatus?.("connecting");
    this.createConnectPromise();

    const ws = new WebSocket(GATEWAY_URL);
    this.ws = ws;
    this.isHandshakeComplete = false;

    ws.addEventListener("open", () => {
      if (this.ws !== ws) {
        return;
      }
      console.log("[GW] connected");
    });

    ws.addEventListener("message", (event) => {
      if (this.ws !== ws) {
        return;
      }
      try {
        const data = JSON.parse(event.data);
        console.log("[GW] recv:", data.type, data.event || data.method || "");
        this.handleMessage(data);
      } catch (e) {
        console.error("[GW] error:", e);
      }
    });

    ws.addEventListener("close", () => {
      if (this.ws !== ws) {
        return;
      }
      this.ws = null;
      this.isHandshakeComplete = false;
      this.connectRequestId = null;
      this.connectNonce = null;
      this.rejectActiveConnect(new Error("gateway connection closed"));
      this.failPendingRequests(new Error("gateway connection closed"));
      this.onStatus?.("disconnected");
      this.scheduleReconnect();
    });

    ws.addEventListener("error", (err) => {
      if (this.ws !== ws) {
        return;
      }
      console.error("[GW] error:", err);
    });
  }

  // 处理收到的消息
  private handleMessage(data: GatewayIncomingFrame) {
    // 握手 challenge
    if (data.type === "event" && data.event === "connect.challenge") {
      this.connectNonce =
        typeof data.payload?.nonce === "string" ? data.payload.nonce.trim() || null : null;
      void this.sendConnect().catch((error) => {
        this.connectRequestId = null;
        this.rejectActiveConnect(error instanceof Error ? error : new Error(String(error)));
        console.error("[GW] error:", error);
      });
      return;
    }

    // 心跳 & 健康检查 — 静默处理
    if (data.type === "event" && (data.event === "tick" || data.event === "health")) {
      this.dispatchEvent(data.event, data.payload);
      return;
    }

    if (data.type === "event") {
      console.log(
        "[GW] event payload:",
        data.event || "unknown",
        summarizeEventPayloadForLog(data.payload),
      );
      this.dispatchEvent(data.event, data.payload);
    }

    // chat.send 的最终态通过 chat 事件下发
    if (data.type === "event" && data.event === "chat") {
      const runId = typeof data.payload?.runId === "string" ? data.payload.runId : null;
      const state = typeof data.payload?.state === "string" ? data.payload.state : null;
      const sessionKey =
        typeof data.payload?.sessionKey === "string" ? data.payload.sessionKey : "agent:main:main";
      const agentId = parseAgentIdFromSessionKey(sessionKey);

      console.log(
        "[GW] chat event:",
        state || "unknown",
        "run:",
        runId || "none",
        "hasMessage:",
        Boolean(data.payload?.message),
      );

      if (state === "final") {
        void this.handleFinalChatEvent({
          runId,
          sessionKey,
          payload: data.payload,
        });
        return;
      }

      if (state === "error" || state === "aborted") {
        const errorMessage =
          typeof data.payload?.errorMessage === "string" && data.payload.errorMessage.trim()
            ? data.payload.errorMessage
            : `chat ${state}`;
        const error = new Error(errorMessage);
        console.error("[GW] error:", error);
        this.notifyRequestError({
          kind: "chat.send",
          runId,
          sessionKey,
          agentId,
          message: error.message,
          occurredAt: Date.now(),
        });
        if (runId) {
          this.finishChatRun(runId, {
            type: "res",
            id: runId,
            ok: false,
            error: { message: error.message },
            payload: data.payload,
          });
        }
        return;
      }

      return;
    }

    // 响应（包括 hello-ok 和 chat.send 回复）
    if (data.type === "res") {
      const responseId = typeof data.id === "string" ? data.id : "";
      if (!responseId) {
        return;
      }

      const resolver = this.pendingRequests.get(responseId);
      console.log(
        `[GW] received res: id=${responseId}, method=${resolver?.method || "unknown"}, ok=${Boolean(data.ok)}`,
      );

      // hello-ok 握手完成
      if (responseId === this.connectRequestId && data.ok && data.payload?.type === "hello-ok") {
        const helloPayload = data.payload as GatewayHelloOkPayload;
        const grantedScopes = Array.isArray(helloPayload.auth?.scopes)
          ? helloPayload.auth.scopes.filter(
              (scope): scope is string => typeof scope === "string" && scope.trim().length > 0,
            )
          : [];
        const stateDir =
          typeof helloPayload.snapshot?.stateDir === "string" &&
          helloPayload.snapshot.stateDir.trim().length > 0
            ? helloPayload.snapshot.stateDir.trim()
            : null;

        this.isHandshakeComplete = true;
        this.connectRequestId = null;
        this.connectNonce = null;
        this.grantedScopes = grantedScopes;
        this.gatewayStateDir = stateDir;
        this.resolveActiveConnect();
        console.log(
          `[GW] handshake ok: requestedScopes=${GATEWAY_OPERATOR_SCOPES.join(",")} grantedScopes=${grantedScopes.join(",") || "none"} stateDir=${stateDir || "unknown"}`,
        );
        if (!grantedScopes.includes("operator.admin")) {
          console.error(
            `[GW] handshake missing admin scope: requested=${GATEWAY_OPERATOR_SCOPES.join(",")} granted=${grantedScopes.join(",") || "none"}`,
          );
        }
        this.onStatus?.("connected");
        return;
      }

      if (responseId === this.connectRequestId && !data.ok) {
        const error = new Error(data.error?.message || "gateway connect failed");
        this.connectRequestId = null;
        this.connectNonce = null;
        this.rejectActiveConnect(error);
        console.error("[GW] error:", error);
        return;
      }

      // 兼容旧协议：只有 chat.send 直接把最终消息放在 res.payload.messages 时才直写到 UI。
      if (Array.isArray(data.payload?.messages) && resolver?.method === "chat.send") {
        console.log("[GW] chat reply:", data.payload.messages.length, "msgs");
        const msgs: GatewayMessage[] = data.payload.messages
          .map((message: unknown) => this.toGatewayMessage(message))
          .filter((message: GatewayMessage | null): message is GatewayMessage => message !== null);
        this.onMessage?.(msgs, {
          sessionKey:
            typeof data.payload?.sessionKey === "string" ? data.payload.sessionKey : undefined,
          runId: typeof data.payload?.runId === "string" ? data.payload.runId : undefined,
        });
      }

      // 通用 pending request 回调
      if (resolver) {
        const payloadStatus = data.payload?.status;
        const runId = typeof data.payload?.runId === "string" ? data.payload.runId : null;
        const kind =
          resolver.method === "chat.send" || resolver.method === "agent" ? resolver.method : null;
        const accepted =
          runId &&
          !Array.isArray(data.payload?.messages) &&
          (payloadStatus === "accepted" ||
            payloadStatus === "started" ||
            payloadStatus === "in_flight" ||
            payloadStatus === undefined);
        if (kind && accepted) {
          this.notifyRunAccepted({
            kind,
            requestId: resolver.requestTag ?? responseId,
            runId,
            sessionKey:
              resolver.sessionKey ??
              (typeof data.payload?.sessionKey === "string"
                ? data.payload.sessionKey
                : "agent:main:main"),
            agentId: resolver.agentId ?? parseAgentIdFromSessionKey(data.payload?.sessionKey),
            acceptedAt: Date.now(),
          });
        }
        if (kind && !data.ok) {
          this.notifyRequestError({
            kind,
            requestId: resolver.requestTag ?? responseId,
            sessionKey:
              resolver.sessionKey ??
              (typeof data.payload?.sessionKey === "string" ? data.payload.sessionKey : undefined),
            agentId: resolver.agentId ?? parseAgentIdFromSessionKey(data.payload?.sessionKey),
            message: data.error?.message || `${resolver.method} failed`,
            occurredAt: Date.now(),
          });
        }
        if (
          resolver.method === "chat.send" &&
          resolver.waitForChatFinal === true &&
          runId &&
          !Array.isArray(data.payload?.messages) &&
          (payloadStatus === "accepted" ||
            payloadStatus === "started" ||
            payloadStatus === "in_flight")
        ) {
          this.pendingChatRuns.set(runId, responseId);
          return;
        }
        resolver.resolve(data as GatewayResponseFrame);
        this.pendingRequests.delete(responseId);
      }
      return;
    }
  }

  // 发送连接请求
  private async sendConnect() {
    if (!this.connectNonce) {
      throw new Error("gateway connect challenge missing nonce");
    }

    const id = crypto.randomUUID();
    this.connectRequestId = id;
    const token = this.resolveGatewayToken();
    const device = await this.resolveDeviceIdentity({
      clientId: GATEWAY_CLIENT_ID,
      clientMode: GATEWAY_CLIENT_MODE,
      role: "operator",
      scopes: [...GATEWAY_OPERATOR_SCOPES],
      token,
    });
    console.log(
      `[GW] connect: clientId=${GATEWAY_CLIENT_ID}, clientMode=${GATEWAY_CLIENT_MODE}, requestingScopes=${GATEWAY_OPERATOR_SCOPES.join(",")}`,
    );
    const sent = this.send({
      type: "req",
      id,
      method: "connect",
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: GATEWAY_CLIENT_ID,
          displayName: GATEWAY_CLIENT_DISPLAY_NAME,
          version: "0.1.0",
          platform: "web",
          mode: GATEWAY_CLIENT_MODE,
        },
        caps: [...GATEWAY_CLIENT_CAPABILITIES],
        role: "operator",
        scopes: [...GATEWAY_OPERATOR_SCOPES],
        auth: token ? { token } : undefined,
        device,
      },
    });
    if (!sent) {
      const error = new Error("gateway connect send failed");
      this.connectRequestId = null;
      this.rejectActiveConnect(error);
      console.error("[GW] error:", error);
    }
  }

  // 发送聊天消息
  async sendChat(
    text: string,
    sessionKey = "agent:main:main",
    attachments: GatewayChatAttachmentInput[] = [],
  ): Promise<GatewayResponseFrame> {
    await this.ensureConnected();

    const id = crypto.randomUUID();
    const apiAttachments = attachments
      .map((attachment) => {
        const parsed = dataUrlToBase64(attachment.dataUrl);
        if (!parsed) {
          return null;
        }

        return {
          type: "image",
          mimeType: attachment.mimeType || parsed.mimeType,
          content: parsed.content,
        };
      })
      .filter((attachment): attachment is NonNullable<typeof attachment> => attachment !== null);
    return new Promise((resolve) => {
      const agentId = parseAgentIdFromSessionKey(sessionKey);
      this.pendingRequests.set(id, {
        method: "chat.send",
        // Fix: 问题11 - 仅 sendChat 辅助方法等待最终 chat 事件，通用 sendRequest("chat.send") 仍按原版只等 accepted 回执。
        waitForChatFinal: true,
        sessionKey,
        agentId: agentId ?? undefined,
        requestTag: id,
        resolve,
        reject: (error) =>
          resolve({
            type: "res",
            id,
            ok: false,
            error: { message: error.message },
          }),
      });

      this.notifyRequestStart({
        kind: "chat.send",
        requestId: id,
        sessionKey,
        agentId,
        startedAt: Date.now(),
      });

      console.log(`[GW] chat.send: sessionKey=${sessionKey}, id=${id}`);
      const sent = this.send({
        type: "req",
        id,
        method: "chat.send",
        params: {
          sessionKey,
          message: text,
          idempotencyKey: id,
          deliver: false,
          ...(apiAttachments.length > 0 ? { attachments: apiAttachments } : {}),
        },
      });
      if (!sent) {
        this.pendingRequests.delete(id);
        const error = new Error("gateway chat.send send failed");
        console.error("[GW] error:", error);
        this.notifyRequestError({
          kind: "chat.send",
          requestId: id,
          sessionKey,
          agentId,
          message: error.message,
          occurredAt: Date.now(),
        });
        resolve({
          type: "res",
          id,
          ok: false,
          error: { message: error.message },
        });
        return;
      }

      // AI 推理可能较久，超时放宽到 120 秒，避免正常回复被过早判失败。
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          this.dropPendingChatRunByRequestId(id);
          this.notifyRequestError({
            kind: "chat.send",
            requestId: id,
            sessionKey,
            agentId,
            message: "timeout",
            occurredAt: Date.now(),
          });
          resolve({
            type: "res",
            id,
            ok: false,
            error: { message: "timeout" },
          });
        }
      }, 120000);
    });
  }

  async sendCompactCommand(sessionKey: string): Promise<GatewayResponseFrame> {
    console.log(`[GW] sendCompactCommand: key=${sessionKey}`);
    return this.sendChat("/compact", sessionKey);
  }

  // 通用请求入口，复用现有 req/res 匹配机制。
  async sendRequest<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 10000,
  ): Promise<T> {
    const logPrefix = resolveRequestLogPrefix(method, params);
    console.log(`${logPrefix} sendRequest ${method}:`, sanitizeRequestParamsForLog(method, params));

    const frame = await this.requestFrame(method, params, timeoutMs);
    if (!frame.ok) {
      const error = new Error(frame.error?.message || `${method} failed`);
      if (error.message.includes("missing scope:")) {
        console.error(
          `[GW] scope error: method=${method} requested=${GATEWAY_OPERATOR_SCOPES.join(",")} granted=${this.grantedScopes.join(",") || "none"} message=${error.message}`,
        );
      }
      if (logPrefix === "[Group]") {
        console.error(`[Group] Gateway 请求失败: method=${method}`, error);
      } else {
        console.error("[GW] error:", error);
      }
      throw error;
    }

    console.log(
      `${logPrefix} sendRequest ${method} -> response`,
      sanitizeResponsePayloadForLog(method, frame.payload, params),
    );
    return (frame.payload ?? {}) as T;
  }

  async sendAgentTurn(params: GatewayAgentTurnParams): Promise<GatewayAgentTurnAcceptedPayload> {
    const idempotencyKey = crypto.randomUUID();
    const payload = {
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      message: params.message,
      thinking: params.thinking,
      deliver: params.deliver,
      timeout: params.timeout,
      extraSystemPrompt: params.extraSystemPrompt,
      idempotencyKey,
    } satisfies Record<string, unknown>;
    console.log(
      `[Group] 发送 Agent 请求: sessionKey=${params.sessionKey}, agentId=${params.agentId ?? "auto"}, id=${idempotencyKey}, hasExtraSystemPrompt=${Boolean(params.extraSystemPrompt?.trim())}, messageLength=${params.message.length}`,
    );
    try {
      return await this.sendRequest<GatewayAgentTurnAcceptedPayload>("agent", payload);
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim() ? error.message : "agent request failed";
      const affectedProviders = trackModelProviderError(message);
      if (affectedProviders.length > 0) {
        console.log(
          `[Model] 记录供应商状态: providers=${affectedProviders.join(", ")}, reason=${message}`,
        );
      }
      throw error;
    }
  }

  async waitForAgentRun(runId: string, timeoutMs = 120000): Promise<GatewayAgentWaitPayload> {
    console.log(`[GW] agent.wait: runId=${runId}, timeoutMs=${timeoutMs}`);
    return this.sendRequest<GatewayAgentWaitPayload>(
      "agent.wait",
      {
        runId,
        timeoutMs,
      },
      timeoutMs + 5000,
    );
  }

  async abortSession(sessionKey: string, runId?: string): Promise<GatewayChatAbortResult> {
    console.log(
      `[GW] abortSession: key=${sessionKey}${runId?.trim() ? `, runId=${runId.trim()}` : ""}`,
    );
    return this.sendRequest<GatewayChatAbortResult>(
      "chat.abort",
      runId?.trim() ? { sessionKey, runId: runId.trim() } : { sessionKey },
    );
  }

  async compactSession(
    sessionKey: string,
    maxLines?: number,
  ): Promise<GatewaySessionMutationResult> {
    const params: Record<string, unknown> = { key: sessionKey };
    if (typeof maxLines === "number") {
      params.maxLines = maxLines;
    }

    console.log(
      `[GW] compactSession: key=${sessionKey}${typeof maxLines === "number" ? `, maxLines=${maxLines}` : ""}`,
    );
    return this.sendRequest("sessions.compact", params);
  }

  async resetSession(sessionKey: string): Promise<GatewaySessionMutationResult> {
    console.log(`[GW] resetSession: key=${sessionKey}`);
    return this.sendRequest("sessions.reset", {
      key: sessionKey,
      reason: "reset",
    });
  }

  async deleteSession(sessionKey: string): Promise<GatewaySessionMutationResult> {
    console.log(`[GW] deleteSession: key=${sessionKey}`);
    return this.sendRequest("sessions.delete", {
      key: sessionKey,
    });
  }

  async getSessionDefaults(agentId: string): Promise<number> {
    console.log(`[GW] getSessionDefaults: agent=${agentId}`);
    const payload = await this.sendRequest<GatewaySessionDefaultsPayload>("sessions.list", {
      agentId,
      limit: 1,
    });
    const defaultsContextTokens = toPositiveInteger(payload.defaults?.contextTokens);
    const sessionContextTokens = Array.isArray(payload.sessions)
      ? payload.sessions
          .map((session) => toPositiveInteger(session.contextTokens))
          .find((value): value is number => value !== undefined)
      : undefined;
    const contextTokens = defaultsContextTokens ?? sessionContextTokens ?? 0;
    const source =
      defaultsContextTokens !== undefined
        ? "defaults"
        : sessionContextTokens !== undefined
          ? "session"
          : "missing";
    console.log(
      `[GW] getSessionDefaults: agent=${agentId}, source=${source}, contextTokens=${contextTokens}`,
    );
    return contextTokens;
  }

  async getSessionRuntimeState(sessionKey: string, agentId?: string): Promise<SessionRuntimeState> {
    const resolvedAgentId =
      agentId?.trim() ||
      (sessionKey.startsWith("agent:") ? sessionKey.split(":")[1]?.trim() || "" : "");

    console.log(
      `[GW] getSessionRuntimeState: key=${sessionKey}, agent=${resolvedAgentId || "unknown"}`,
    );
    const payload = await this.sendRequest<SessionRuntimeListPayload>("sessions.list", {
      ...(resolvedAgentId ? { agentId: resolvedAgentId } : {}),
      limit: 200,
    });
    const runtimeState = resolveSessionRuntimeState(sessionKey, payload);

    console.log(
      `[GW] getSessionRuntimeState: key=${sessionKey}, found=${runtimeState.sessionFound}, fresh=${runtimeState.currentContextUsedFresh}, contextWindowSize=${runtimeState.contextWindowSize}, currentContextUsed=${runtimeState.currentContextUsed ?? 0}`,
    );
    return runtimeState;
  }

  async getSessionCurrentContextUsed(sessionKey: string, agentId?: string): Promise<number | null> {
    const runtimeState = await this.getSessionRuntimeState(sessionKey, agentId);
    return runtimeState.currentContextUsed;
  }

  getGrantedScopes() {
    return [...this.grantedScopes];
  }

  getStateDir() {
    return this.gatewayStateDir;
  }

  getDefaultModelLabel(snapshot: GatewayConfigSnapshot) {
    const model = snapshot.config?.agents?.defaults?.model;
    if (typeof model === "string" && model.trim()) {
      return model.trim();
    }
    if (typeof model === "object" && typeof model?.primary === "string" && model.primary.trim()) {
      return model.primary.trim();
    }
    return undefined;
  }

  // 源码确认：
  // - schema: src/gateway/protocol/schema/config.ts
  // - handler: src/gateway/server-methods/config.ts
  // req: {}
  // res: ConfigFileSnapshot（含 config/hash/path/exists/valid）
  async getConfig() {
    console.log("[GW] config.get");
    return await this.sendRequest<GatewayConfigSnapshot>("config.get", {});
  }

  async getConfigEditorSnapshot(): Promise<GatewayConfigEditorSnapshot> {
    // 源码确认：
    // - method 注册：src/gateway/server-methods-list.ts
    // - handler：src/gateway/server-methods/config.ts 的 "config.get"
    // - 返回值来自 readConfigFileSnapshot()，包含脱敏后的 raw/hash/path/valid
    // 所以核心配置编辑器读取完整配置时，直接走 config.get，不需要伪造空 patch。
    console.log("[Config] getConfigEditorSnapshot");
    const snapshot = await this.getConfig();

    if (snapshot.valid === false) {
      throw new Error("当前 openclaw.json 无法安全读取原文，请先修复配置文件错误");
    }

    return {
      raw:
        typeof snapshot.raw === "string"
          ? snapshot.raw
          : JSON.stringify(snapshot.parsed ?? {}, null, 2),
      hash: snapshot.hash,
      path: snapshot.path,
      valid: snapshot.valid ?? true,
      config: snapshot.config,
    };
  }

  async getConfigSnapshot() {
    return await this.getConfig();
  }

  async restartGateway(options: { note?: string; restartDelayMs?: number } = {}) {
    // 源码确认：
    // - 新增 `gateway.restart` 控制面 RPC
    // - 有 SIGUSR1 listener 时走进程内重启
    // - 没有 listener 时回退到 supervisor/launchctl/systemd 重启
    // 相关源码：
    // - src/gateway/server-methods/update.ts
    // - src/infra/restart.ts
    console.log("[GW] restartGateway");
    try {
      return await this.sendRequest("gateway.restart", {
        note: options.note ?? "从龙虾办公室手动重启网关",
        restartDelayMs: typeof options.restartDelayMs === "number" ? options.restartDelayMs : 0,
      });
    } catch (error) {
      const normalizedError = normalizeRestartGatewayError(error);
      console.error("[GW] restartGateway failed:", normalizedError);
      throw normalizedError;
    }
  }

  async patchConfig(
    patch: string,
    options: {
      baseHash?: string;
      sessionKey?: string;
      note?: string;
      restartDelayMs?: number;
    } = {},
  ) {
    const snapshot = options.baseHash ? null : await this.getConfig();
    const baseHash = options.baseHash ?? snapshot?.hash;

    // 源码确认：
    // - schema: src/gateway/protocol/schema/config.ts
    // - handler: src/gateway/server-methods/config.ts
    // req: { raw: string, baseHash?: string, sessionKey?: string, note?: string, restartDelayMs?: number }
    // 说明：raw 必须是 JSON5 字符串，且根节点必须是对象；
    // handler 会写盘后 scheduleGatewaySigusr1Restart，不适合“新增模型后不断开 WS”的流程。
    console.log("[GW] config.patch");
    return await this.sendRequest<GatewayConfigWriteResult>("config.patch", {
      raw: patch,
      ...(baseHash ? { baseHash } : {}),
      ...(options.sessionKey ? { sessionKey: options.sessionKey } : {}),
      ...(options.note ? { note: options.note } : {}),
      ...(typeof options.restartDelayMs === "number"
        ? { restartDelayMs: options.restartDelayMs }
        : {}),
    });
  }

  async applyConfig(
    rawConfig: string,
    options: {
      baseHash?: string;
      sessionKey?: string;
      note?: string;
      restartDelayMs?: number;
    } = {},
  ) {
    const snapshot = options.baseHash ? null : await this.getConfig();
    const baseHash = options.baseHash ?? snapshot?.hash;

    // 源码确认：
    // - schema: src/gateway/protocol/schema/config.ts
    // - handler: src/gateway/server-methods/config.ts
    // req: { raw: string, baseHash?: string, sessionKey?: string, note?: string, restartDelayMs?: number }
    // 说明：config.apply 会用完整配置替换现有文件，但同样会 scheduleGatewaySigusr1Restart；
    // 新增模型流程应优先走不会主动重启的 config.set。
    console.log("[GW] config.apply");
    return await this.sendRequest<GatewayConfigWriteResult>("config.apply", {
      raw: rawConfig,
      ...(baseHash ? { baseHash } : {}),
      ...(options.sessionKey ? { sessionKey: options.sessionKey } : {}),
      ...(options.note ? { note: options.note } : {}),
      ...(typeof options.restartDelayMs === "number"
        ? { restartDelayMs: options.restartDelayMs }
        : {}),
    });
  }

  async setConfig(
    config: Record<string, unknown>,
    options: {
      baseHash?: string;
    } = {},
  ) {
    const snapshot = options.baseHash ? null : await this.getConfig();
    const baseHash = options.baseHash ?? snapshot?.hash;

    // 源码确认：
    // - schema: src/gateway/protocol/schema/config.ts
    // - handler: src/gateway/server-methods/config.ts
    // req: { raw: string, baseHash?: string }
    // 说明：config.set 只写完整配置，不主动调度 restart；新增模型流程用它避免 WS 断开。
    console.log("[GW] config.set");
    return await this.sendRequest<GatewayConfigWriteResult>("config.set", {
      raw: JSON.stringify(config, null, 2),
      ...(baseHash ? { baseHash } : {}),
    });
  }

  async listModels() {
    console.log("[GW] listModels");
    const payload = await this.sendRequest<GatewayModelsListResult>("models.list", {});
    return groupModelsByProvider(Array.isArray(payload.models) ? payload.models : []);
  }

  async listCronJobs(
    params: {
      includeDisabled?: boolean;
      limit?: number;
      offset?: number;
      query?: string;
      enabled?: "all" | "enabled" | "disabled";
      sortBy?: "nextRunAtMs" | "updatedAtMs" | "name";
      sortDir?: "asc" | "desc";
    } = {},
  ) {
    console.log("[Cron] gateway cron.list");
    return await this.sendRequest<GatewayCronListResponse>("cron.list", {
      includeDisabled: true,
      limit: 200,
      offset: 0,
      ...params,
    });
  }

  async getCronStatus() {
    console.log("[Cron] gateway cron.status");
    return await this.sendRequest<GatewayCronStatusResponse>("cron.status", {});
  }

  async createCronJob(params: GatewayCronCreateParams) {
    console.log(`[Cron] gateway cron.add: ${params.name}`);
    return await this.sendRequest<GatewayCronJob>(
      "cron.add",
      params as unknown as Record<string, unknown>,
    );
  }

  async updateCronJob(jobId: string, patch: GatewayCronJobPatch) {
    console.log(`[Cron] gateway cron.update: ${jobId}`);
    return await this.sendRequest<GatewayCronJob>("cron.update", {
      id: jobId,
      patch,
    });
  }

  async removeCronJob(jobId: string) {
    console.log(`[Cron] gateway cron.remove: ${jobId}`);
    return await this.sendRequest<GatewayCronRemoveResponse>("cron.remove", {
      id: jobId,
    });
  }

  async pauseCronJob(jobId: string) {
    console.log(`[Cron] gateway cron.pause: ${jobId}`);
    return await this.updateCronJob(jobId, { enabled: false });
  }

  async resumeCronJob(jobId: string) {
    console.log(`[Cron] gateway cron.resume: ${jobId}`);
    return await this.updateCronJob(jobId, { enabled: true });
  }

  async runCronJob(jobId: string, mode: "due" | "force" = "force") {
    console.log(`[Cron] gateway cron.run: ${jobId}`);
    return await this.sendRequest<GatewayCronRunResponse>("cron.run", {
      id: jobId,
      mode,
    });
  }

  async listCronRuns(
    params: {
      jobId?: string;
      scope?: "job" | "all";
      limit?: number;
      offset?: number;
      status?: "all" | "ok" | "error" | "skipped";
      statuses?: GatewayCronRunStatus[];
      deliveryStatus?: GatewayCronDeliveryStatus;
      deliveryStatuses?: GatewayCronDeliveryStatus[];
      query?: string;
      sortDir?: "asc" | "desc";
    } = {},
  ) {
    console.log(`[Cron] gateway cron.runs: ${params.jobId?.trim() || params.scope || "all"}`);
    return await this.sendRequest<GatewayCronRunsResponse>("cron.runs", {
      limit: 20,
      sortDir: "desc",
      ...(params.jobId ? { id: params.jobId } : {}),
      ...params,
    });
  }

  async getAgentIdentity(agentId: string) {
    console.log(`[GW] getAgentIdentity: ${agentId}`);
    return await this.sendRequest<GatewayAgentIdentity>("agent.identity.get", { agentId });
  }

  // 源码确认：
  // - schema: src/gateway/protocol/schema/agents-models-skills.ts
  // - handler: src/gateway/server-methods/agents.ts
  // req: { "name": string, "workspace": string, "emoji"?: string, "avatar"?: string }
  // res: { "ok": true, "agentId": string, "name": string, "workspace": string }
  async createAgent(params: GatewayCreateAgentParams) {
    console.log(`[GW] createAgent: ${params.name}`);
    return await this.sendRequest<GatewayCreateAgentResult>("agents.create", params);
  }

  // 源码确认：
  // - schema: src/gateway/protocol/schema/agents-models-skills.ts
  // - handler: src/gateway/server-methods/agents.ts
  // req: { "agentId": string, "model"?: string, "name"?: string, "workspace"?: string, "avatar"?: string }
  // res: { "ok": true, "agentId": string }
  async updateAgent(agentId: string, params: GatewayAgentUpdateParams) {
    console.log(`[GW] updateAgent: ${agentId}`);
    return await this.sendRequest<GatewayAgentUpdateResult>("agents.update", {
      agentId,
      ...params,
    });
  }

  // 源码确认：
  // - schema: src/gateway/protocol/schema/agents-models-skills.ts
  // - handler: src/gateway/server-methods/agents.ts
  // req: { "agentId": string, "deleteFiles"?: boolean }
  // res: { "ok": true, "agentId": string, "removedBindings": number }
  async deleteAgent(agentId: string, deleteFiles = true) {
    console.log(`[GW] deleteAgent: ${agentId}, deleteFiles=${deleteFiles}`);
    return await this.sendRequest<GatewayDeleteAgentResult>("agents.delete", {
      agentId,
      deleteFiles,
    });
  }

  // 源码确认：
  // - schema: src/gateway/protocol/schema/agents-models-skills.ts
  // - handler: src/gateway/server-methods/agents.ts
  // req: {}
  // res: { "defaultId": string, "mainKey": string, "scope": "per-sender" | "global", "agents": [{ "id": string, "name"?: string, "identity"?: { "name"?: string, "emoji"?: string, "avatar"?: string, "avatarUrl"?: string, "theme"?: string } }] }
  async listAgents() {
    console.log("[GW] listAgents");
    return await this.sendRequest<GatewayAgentsListResponse>("agents.list", {});
  }

  // 源码确认：
  // - schema: src/gateway/protocol/schema/agents-models-skills.ts
  // - handler: src/gateway/server-methods/agents.ts
  // req: { "agentId": string }
  // res: { "agentId": string, "workspace": string, "files": [{ "name": string, "path": string, "missing": boolean, "size"?: number, "updatedAtMs"?: number, "content"?: string }] }
  async listAgentFiles(agentId: string) {
    console.log(`[GW] listAgentFiles: ${agentId}`);
    const payload = await this.sendRequest<AgentFilesListResult>("agents.files.list", { agentId });
    return {
      ...payload,
      files: Array.isArray(payload.files) ? payload.files.filter(isPresentAgentWorkspaceFile) : [],
    };
  }

  // 源码确认：
  // - schema: src/gateway/protocol/schema/agents-models-skills.ts
  // - handler: src/gateway/server-methods/agents.ts
  // req: { "agentId": string, "name": string }
  // res: { "agentId": string, "workspace": string, "file": { "name": string, "path": string, "missing": boolean, "size"?: number, "updatedAtMs"?: number, "content"?: string } }
  async getAgentFile(agentId: string, name: string) {
    console.log(`[GW] getAgentFile: ${agentId}/${name}`);
    const payload = await this.sendRequest<AgentFileGetResult>("agents.files.get", {
      agentId,
      name,
    });
    return typeof payload.file.content === "string" ? payload.file.content : "";
  }

  // 源码确认：
  // - schema: src/gateway/protocol/schema/agents-models-skills.ts
  // - handler: src/gateway/server-methods/agents.ts
  // req: { "agentId": string, "name": string, "content": string }
  // res: { "ok": true, "agentId": string, "workspace": string, "file": { "name": string, "path": string, "missing": false, "size"?: number, "updatedAtMs"?: number, "content"?: string } }
  async saveAgentFile(agentId: string, name: string, content: string) {
    console.log(`[GW] saveAgentFile: ${agentId}/${name}`);
    const payload = await this.sendRequest<AgentFileSetResult>("agents.files.set", {
      agentId,
      name,
      content,
    });
    return payload.ok;
  }

  // 源码确认：
  // - schema: src/gateway/protocol/schema/agents-models-skills.ts
  // - handler: src/gateway/server-methods/agents.ts
  // req: { "agentId": string, "name": string, "content": string }
  // res: { "ok": true, "agentId": string, "workspace": string, "file": { "name": string, "path": string, "missing": false, "size"?: number, "updatedAtMs"?: number, "content"?: string } }
  async setAgentFile(agentId: string, filename: string, content: string) {
    console.log(`[GW] setAgentFile: ${agentId}/${filename}`);
    return await this.sendRequest<AgentFileSetResult>("agents.files.set", {
      agentId,
      name: filename,
      content,
    });
  }

  // 实测 2026-03-13 本地 Gateway 的历史接口是 chat.history，不是 session.history。
  // 返回结构示例：
  // {
  //   "sessionKey": "agent:xiaomei:main",
  //   "sessionId": "68a2d245-5d8c-446d-8f76-b8aadd9ff6b6",
  //   "messages": [
  //     {
  //       "role": "assistant",
  //       "content": [
  //         { "type": "thinking", "thinking": "..." },
  //         { "type": "text", "text": "..." }
  //       ],
  //       "provider": "minimax",
  //       "model": "MiniMax-M2.5",
  //       "usage": {
  //         "input": 36,
  //         "output": 42,
  //         "totalTokens": 15042,
  //         "cacheRead": 0,
  //         "cacheWrite": 14964,
  //         "cost": { "total": 0.0018568799999999998 }
  //       },
  //       "timestamp": 1773400398878,
  //       "senderLabel": "cli",
  //       "stopReason": "stop"
  //     }
  //   ],
  //   "thinkingLevel": "low"
  // }
  // 前端适配时主要读取 role / content / usage / timestamp，其它字段按需保留。
  async loadHistory(sessionKey: string, limit = 200): Promise<GatewayHistoryPayload | null> {
    const logPrefix = isGroupSessionKey(sessionKey) ? "[Group]" : "[GW]";
    console.log(`${logPrefix} 读取会话历史: key=${sessionKey}, limit=${limit}`);

    try {
      return await this.sendRequest<GatewayHistoryPayload>("chat.history", {
        sessionKey,
        limit,
      });
    } catch (error) {
      if (logPrefix === "[Group]") {
        console.error("[Group] 读取会话历史失败:", error);
      } else {
        console.error("[GW] error:", error);
      }
      return null;
    }
  }

  // 底层发送
  private send(data: Record<string, unknown>) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.ws.send(JSON.stringify(data));
    return true;
  }

  // 断线重连
  private scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log("[GW] reconnecting");
      this.connect();
    }, 3000);
  }

  // 断开
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.rejectActiveConnect(new Error("gateway disconnected"));
    this.failPendingRequests(new Error("gateway disconnected"));
    this.isHandshakeComplete = false;
    this.connectRequestId = null;
    this.connectNonce = null;
    this.grantedScopes = [];
    this.gatewayStateDir = null;
    this.ws?.close();
    this.ws = null;
  }

  private createConnectPromise() {
    if (this.connectPromise) {
      return;
    }
    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.resolveConnectPromise = resolve;
      this.rejectConnectPromise = reject;
    });
  }

  private resolveActiveConnect() {
    this.resolveConnectPromise?.();
    this.connectPromise = Promise.resolve();
    this.resolveConnectPromise = null;
    this.rejectConnectPromise = null;
  }

  private rejectActiveConnect(error: Error) {
    this.rejectConnectPromise?.(error);
    this.connectPromise = null;
    this.resolveConnectPromise = null;
    this.rejectConnectPromise = null;
  }

  private failPendingRequests(error: Error) {
    for (const [, pending] of this.pendingRequests) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
    this.pendingChatRuns.clear();
  }

  private async ensureConnected() {
    if (this.ws?.readyState === WebSocket.OPEN && this.isHandshakeComplete) {
      return;
    }
    this.connect();
    if (!this.connectPromise) {
      throw new Error("gateway connect not initialized");
    }
    await this.connectPromise;
  }

  private resolveGatewayToken() {
    const envToken = import.meta.env.VITE_GATEWAY_TOKEN?.trim();
    if (envToken) {
      return envToken;
    }
    if (typeof window === "undefined") {
      return undefined;
    }

    try {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const queryParams = new URLSearchParams(window.location.search);
      const runtimeToken = hashParams.get("token")?.trim() || queryParams.get("token")?.trim();
      if (runtimeToken) {
        window.localStorage.setItem(GATEWAY_TOKEN_STORAGE_KEY, runtimeToken);
        return runtimeToken;
      }
      return window.localStorage.getItem(GATEWAY_TOKEN_STORAGE_KEY)?.trim() || undefined;
    } catch (error) {
      console.error("[GW] error:", error);
      return undefined;
    }
  }

  // 浏览器本地保存设备身份，避免每次刷新都触发新的配对记录。
  private async getStoredDeviceIdentity() {
    if (typeof window === "undefined") {
      return null;
    }
    const raw = window.localStorage.getItem(GATEWAY_DEVICE_IDENTITY_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as StoredGatewayDeviceIdentity;
      if (
        parsed?.version !== 1 ||
        typeof parsed.deviceId !== "string" ||
        typeof parsed.publicKey !== "string" ||
        typeof parsed.privateKeyPkcs8 !== "string"
      ) {
        return null;
      }

      const publicKeyBytes = base64UrlToBytes(parsed.publicKey);
      const deviceId = await sha256Hex(publicKeyBytes);
      if (deviceId !== parsed.deviceId) {
        return null;
      }

      const privateKey = await crypto.subtle.importKey(
        "pkcs8",
        base64UrlToBytes(parsed.privateKeyPkcs8),
        "Ed25519",
        false,
        ["sign"],
      );

      return {
        deviceId,
        publicKey: bytesToBase64Url(publicKeyBytes),
        privateKey,
      } satisfies GatewayDeviceIdentity;
    } catch (error) {
      console.error("[GW] error:", error);
      return null;
    }
  }

  private async createDeviceIdentity() {
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const publicKeyBytes = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const privateKeyPkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const deviceId = await sha256Hex(publicKeyBytes);
    const storedIdentity: StoredGatewayDeviceIdentity = {
      version: 1,
      deviceId,
      publicKey: bytesToBase64Url(publicKeyBytes),
      privateKeyPkcs8: bytesToBase64Url(privateKeyPkcs8),
      createdAtMs: Date.now(),
    };

    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(
          GATEWAY_DEVICE_IDENTITY_STORAGE_KEY,
          JSON.stringify(storedIdentity),
        );
      } catch (error) {
        console.error("[GW] 保存设备身份失败:", error);
      }
    }

    return {
      deviceId,
      publicKey: storedIdentity.publicKey,
      privateKey: keyPair.privateKey,
    } satisfies GatewayDeviceIdentity;
  }

  private async loadOrCreateDeviceIdentity() {
    if (typeof window === "undefined" || !window.isSecureContext || !crypto?.subtle) {
      throw new Error("browser device identity unavailable in current context");
    }

    const stored = await this.getStoredDeviceIdentity();
    if (stored) {
      return stored;
    }
    return await this.createDeviceIdentity();
  }

  private async resolveDeviceIdentity(params: {
    clientId: string;
    clientMode: string;
    role: string;
    scopes: string[];
    token?: string;
  }) {
    if (!this.deviceIdentityPromise) {
      this.deviceIdentityPromise = this.loadOrCreateDeviceIdentity().catch((error) => {
        this.deviceIdentityPromise = null;
        throw error;
      });
    }

    const identity = await this.deviceIdentityPromise;
    const signedAt = Date.now();
    const nonce = this.connectNonce;
    if (!nonce) {
      throw new Error("gateway connect challenge missing nonce");
    }
    const payload = buildDeviceAuthPayloadV3({
      deviceId: identity.deviceId,
      clientId: params.clientId,
      clientMode: params.clientMode,
      role: params.role,
      scopes: params.scopes,
      signedAtMs: signedAt,
      token: params.token ?? null,
      nonce,
      platform: "web",
      deviceFamily: null,
    });
    const signature = await crypto.subtle.sign(
      "Ed25519",
      identity.privateKey,
      new TextEncoder().encode(payload),
    );

    return {
      id: identity.deviceId,
      publicKey: identity.publicKey,
      signature: bytesToBase64Url(signature),
      signedAt,
      nonce,
    };
  }

  // chat final 里如果没有可直接展示的消息，就回拉一次历史，避免 UI 永远卡在思考中。
  private async handleFinalChatEvent(params: {
    runId: string | null;
    sessionKey: string;
    payload?: Record<string, unknown>;
  }) {
    try {
      let message = this.toGatewayMessage(params.payload?.message);
      if (!this.hasRenderableMessage(message)) {
        console.log("[GW] chat final fallback: history");
        message = await this.fetchLatestAssistantMessage(params.sessionKey);
      }

      if (this.hasRenderableMessage(message)) {
        console.log("[GW] chat reply:", 1, "msgs");
        this.notifyAssistantMessage({
          kind: "chat.send",
          runId: params.runId,
          sessionKey: params.sessionKey,
          agentId: parseAgentIdFromSessionKey(params.sessionKey),
          message,
          receivedAt: Date.now(),
        });
        this.onMessage?.([message], {
          sessionKey: params.sessionKey,
          runId: params.runId ?? undefined,
        });
      } else {
        const error = new Error("chat final missing assistant message");
        console.error("[GW] error:", error);
        if (params.runId) {
          this.finishChatRun(params.runId, {
            type: "res",
            id: params.runId,
            ok: false,
            error: { message: error.message },
            payload: params.payload,
          });
        }
        return;
      }

      if (params.runId) {
        this.finishChatRun(params.runId, {
          type: "res",
          id: params.runId,
          ok: true,
          payload: params.payload,
        });
      }
    } catch (error) {
      console.error("[GW] error:", error);
      if (params.runId) {
        this.finishChatRun(params.runId, {
          type: "res",
          id: params.runId,
          ok: false,
          error: { message: error instanceof Error ? error.message : String(error) },
          payload: params.payload,
        });
      }
    }
  }

  private hasRenderableMessage(message: GatewayMessage | null): message is GatewayMessage {
    if (!message) {
      return false;
    }

    return Boolean(message.content.trim() || message.thinking?.trim());
  }

  private async requestFrame(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<GatewayResponseFrame> {
    await this.ensureConnected();

    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey : undefined;
      const agentId =
        (typeof params.agentId === "string" && params.agentId.trim()) ||
        parseAgentIdFromSessionKey(sessionKey) ||
        undefined;
      const requestTag =
        typeof params.idempotencyKey === "string" && params.idempotencyKey.trim()
          ? params.idempotencyKey.trim()
          : id;
      this.pendingRequests.set(id, {
        method,
        sessionKey,
        agentId,
        requestTag,
        resolve,
        reject,
      });

      if ((method === "chat.send" || method === "agent") && sessionKey) {
        this.notifyRequestStart({
          kind: method,
          requestId: requestTag,
          sessionKey,
          agentId,
          startedAt: Date.now(),
        });
      }

      const sent = this.send({
        type: "req",
        id,
        method,
        params,
      });

      if (!sent) {
        this.pendingRequests.delete(id);
        const error = new Error(`gateway ${method} send failed`);
        console.error("[GW] error:", error);
        if ((method === "chat.send" || method === "agent") && sessionKey) {
          this.notifyRequestError({
            kind: method,
            requestId: requestTag,
            sessionKey,
            agentId,
            message: error.message,
            occurredAt: Date.now(),
          });
        }
        reject(error);
        return;
      }

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          if ((method === "chat.send" || method === "agent") && sessionKey) {
            this.notifyRequestError({
              kind: method,
              requestId: requestTag,
              sessionKey,
              agentId,
              message: `${method} timeout`,
              occurredAt: Date.now(),
            });
          }
          reject(new Error(`${method} timeout`));
        }
      }, timeoutMs);
    });
  }

  private async fetchLatestAssistantMessage(sessionKey: string) {
    try {
      const payload = await this.loadHistory(sessionKey, 20);
      const historyMessages = Array.isArray(payload?.messages) ? payload.messages : [];

      console.log("[GW] chat history fallback:", historyMessages.length, "msgs");

      if (historyMessages.length === 0) {
        return null;
      }

      const assistantMessage = historyMessages
        .map((message: unknown) => this.toGatewayMessage(message))
        .filter((message: GatewayMessage | null): message is GatewayMessage =>
          this.hasRenderableMessage(message),
        )
        .toReversed()
        .find((message) => message.role === "assistant");

      return assistantMessage ?? null;
    } catch (error) {
      console.error("[GW] error:", error);
      return null;
    }
  }

  private toGatewayMessage(message: unknown): GatewayMessage | null {
    if (!isRecord(message)) {
      return null;
    }

    const role = message.role === "user" || message.role === "assistant" ? message.role : null;
    if (!role) {
      return null;
    }

    const contentBlocks = Array.isArray(message.content) ? message.content : [];
    const text = contentBlocks
      .filter((block) => isRecord(block) && block.type === "text" && typeof block.text === "string")
      .map((block) => String((block as Record<string, unknown>).text))
      .join("\n");
    const thinking = contentBlocks
      .filter(
        (block) =>
          isRecord(block) && block.type === "thinking" && typeof block.thinking === "string",
      )
      .map((block) => String((block as Record<string, unknown>).thinking))
      .join("\n");

    return {
      role,
      content: text,
      thinking,
      model: typeof message.model === "string" ? message.model : undefined,
      provider: typeof message.provider === "string" ? message.provider : undefined,
      usage: normalizeGatewayUsage(isRecord(message.usage) ? message.usage : undefined),
      timestamp: typeof message.timestamp === "number" ? message.timestamp : Date.now(),
    };
  }

  private finishChatRun(runId: string, frame: GatewayResponseFrame) {
    const requestId = this.pendingChatRuns.get(runId);
    if (!requestId) {
      return;
    }

    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      this.pendingChatRuns.delete(runId);
      return;
    }

    pending.resolve(frame);
    this.pendingRequests.delete(requestId);
    this.pendingChatRuns.delete(runId);
  }

  private dropPendingChatRunByRequestId(requestId: string) {
    for (const [runId, pendingRequestId] of this.pendingChatRuns.entries()) {
      if (pendingRequestId === requestId) {
        this.pendingChatRuns.delete(runId);
      }
    }
  }

  private dispatchEvent(eventName: unknown, payload: unknown) {
    const resolvedEventName = typeof eventName === "string" ? eventName : "";
    if (!resolvedEventName) {
      return;
    }

    const resolvedPayload =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};

    for (const handler of this.eventHandlers) {
      try {
        handler(resolvedEventName, resolvedPayload);
      } catch (error) {
        console.error("[GW] error:", error);
      }
    }
  }
}

// 单例
export const gateway = new GatewayService();
