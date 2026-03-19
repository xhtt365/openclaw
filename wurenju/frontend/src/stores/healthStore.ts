import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { gateway, type GatewayLifecycleObserver, type GatewayMessage } from "@/services/gateway";
import { useAgentStore, type Agent } from "@/stores/agentStore";
import {
  classifyHealthError,
  createEmptyHealthRecord,
  deriveHealthSummary,
  EMPTY_HEALTH_SUMMARY,
  HEALTH_RETENTION_MS,
  trimHealthRecord,
  type AgentHealthRecord,
  type AgentHealthSummary,
  type HealthAlert,
  type HealthAlertSeverity,
  type HealthFallbackEvent,
  type HealthRequestKind,
  type HealthUsageSnapshot,
} from "@/utils/health";
import { resolveSessionRuntimeState, type SessionRuntimeListPayload } from "@/utils/sessionRuntime";

const HEALTH_STORAGE_KEY = "xiaban.health.v1";
const HEALTH_STORAGE_MAX_BYTES = 2 * 1024 * 1024;
const HEALTH_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_OFFICE_PROBE_INTERVAL_MS = 60_000;
const OFFICE_ALERT_REPLAY_MS = 15 * 60 * 1000;

const FALLBACK_STORAGE: Storage = {
  get length() {
    return 0;
  },
  clear() {},
  getItem() {
    return null;
  },
  key() {
    return null;
  },
  removeItem() {},
  setItem() {},
};

type PendingHealthInteraction = {
  kind: HealthRequestKind;
  requestId: string;
  runId?: string | null;
  sessionKey: string;
  agentId: string;
  startedAt: number;
  firstTokenAt?: number | null;
  usedFallback?: boolean;
};

type FallbackPayload = {
  active: boolean;
  selectedModel: string;
  activeModel: string;
  previousModel?: string | null;
  reason?: string | null;
  attempts: string[];
};

type HealthAlertListener = (alert: HealthAlert) => void;

interface HealthState {
  recordsByAgentId: Record<string, AgentHealthRecord>;
  alerts: HealthAlert[];

  initialize: () => void;
  startOfficeProbe: (agents: Agent[], intervalMs?: number) => void;
  stopOfficeProbe: () => void;
  subscribeAlerts: (
    listener: HealthAlertListener,
    options?: { replayRecent?: boolean },
  ) => () => void;
  getSummaryForAgent: (agentId: string) => AgentHealthSummary;
  recordHistorySnapshot: (params: {
    agentId: string;
    sessionKey: string;
    currentContextUsed?: number | null;
    contextWindowSize?: number | null;
    model?: string | null;
    timestamp?: number;
  }) => void;
  recordAssistantMessage: (params: {
    agentId: string;
    sessionKey: string;
    kind: HealthRequestKind;
    message: Pick<GatewayMessage, "model" | "provider" | "usage" | "timestamp">;
    runId?: string | null;
  }) => void;
  recordRequestError: (params: {
    agentId: string;
    sessionKey: string;
    kind: HealthRequestKind;
    message: string;
    runId?: string | null;
  }) => void;
}

type PersistedHealthState = Pick<HealthState, "recordsByAgentId" | "alerts">;

function parseAgentIdFromSessionKey(value: string | null | undefined) {
  if (typeof value !== "string" || !value.startsWith("agent:")) {
    return null;
  }

  const agentId = value.split(":")[1]?.trim();
  return agentId || null;
}

function resolveModelLabel(provider: unknown, model: unknown) {
  const modelValue = typeof model === "string" ? model.trim() : "";
  if (!modelValue) {
    return null;
  }

  const providerValue = typeof provider === "string" ? provider.trim() : "";
  if (!providerValue) {
    return modelValue;
  }

  if (modelValue.toLowerCase().startsWith(`${providerValue.toLowerCase()}/`)) {
    return modelValue;
  }

  return `${providerValue}/${modelValue}`;
}

function toTrimmedString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseFallbackPayload(payload: Record<string, unknown>): FallbackPayload | null {
  const phase =
    toTrimmedString(payload.phase) || (payload.stream === "fallback" ? "fallback" : null);
  if (phase !== "fallback" && phase !== "fallback_cleared") {
    return null;
  }

  const selectedModel =
    resolveModelLabel(payload.selectedProvider, payload.selectedModel) ||
    resolveModelLabel(payload.fromProvider, payload.fromModel);
  const activeModel =
    resolveModelLabel(payload.activeProvider, payload.activeModel) ||
    resolveModelLabel(payload.toProvider, payload.toModel);

  if (!selectedModel || !activeModel) {
    return null;
  }

  const attempts = Array.isArray(payload.attemptSummaries)
    ? payload.attemptSummaries
        .flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []))
        .slice(0, 4)
    : [];

  return {
    active: phase === "fallback",
    selectedModel,
    activeModel: phase === "fallback" ? activeModel : selectedModel,
    previousModel:
      resolveModelLabel(payload.previousActiveProvider, payload.previousActiveModel) || activeModel,
    reason: toTrimmedString(payload.reasonSummary) || toTrimmedString(payload.reason),
    attempts,
  };
}

function createHealthAlert(params: {
  agentId: string;
  severity: HealthAlertSeverity;
  code: HealthAlert["code"];
  message: string;
  detail?: string;
  timestamp: number;
}): HealthAlert {
  return {
    id: crypto.randomUUID(),
    agentId: params.agentId,
    severity: params.severity,
    code: params.code,
    message: params.message,
    detail: params.detail,
    timestamp: params.timestamp,
  };
}

function buildSessionKey(agentId: string, mainKey: string) {
  return `agent:${agentId}:${mainKey}`;
}

function isQuotaExceededError(error: unknown) {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED";
  }

  return (
    !!error &&
    typeof error === "object" &&
    "name" in error &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

function resolveByteSize(value: string) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).length;
  }

  return value.length * 2;
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function trimHealthPayload(payload: { state?: PersistedHealthState; version?: number }) {
  if (!payload.state) {
    return payload;
  }

  const cutoff = Date.now() - HEALTH_RETENTION_MS;
  const nextRecords = Object.fromEntries(
    Object.entries(payload.state.recordsByAgentId ?? {}).map(([agentId, record]) => [
      agentId,
      trimHealthRecord(record, Date.now()),
    ]),
  );
  const nextAlerts = (payload.state.alerts ?? []).filter((alert) => alert.timestamp >= cutoff);

  return {
    ...payload,
    state: {
      recordsByAgentId: nextRecords,
      alerts: nextAlerts,
    },
  };
}

function shrinkHealthPayloadForSize(
  payload: {
    state?: PersistedHealthState;
    version?: number;
  },
  maxBytes: number,
) {
  if (!payload.state) {
    return payload;
  }

  const steps = [
    { interactions: 40, usageSnapshots: 40, fallbackEvents: 15, alerts: 15, globalAlerts: 40 },
    { interactions: 20, usageSnapshots: 20, fallbackEvents: 10, alerts: 10, globalAlerts: 20 },
    { interactions: 10, usageSnapshots: 10, fallbackEvents: 5, alerts: 5, globalAlerts: 10 },
    { interactions: 5, usageSnapshots: 5, fallbackEvents: 3, alerts: 3, globalAlerts: 5 },
    { interactions: 2, usageSnapshots: 2, fallbackEvents: 2, alerts: 2, globalAlerts: 2 },
    { interactions: 0, usageSnapshots: 0, fallbackEvents: 0, alerts: 0, globalAlerts: 0 },
  ];

  for (const step of steps) {
    const nextRecords = Object.fromEntries(
      Object.entries(payload.state.recordsByAgentId ?? {}).map(([agentId, record]) => [
        agentId,
        {
          ...record,
          interactions: record.interactions.slice(-step.interactions),
          usageSnapshots: record.usageSnapshots.slice(-step.usageSnapshots),
          fallbackEvents: record.fallbackEvents.slice(-step.fallbackEvents),
          alerts: record.alerts.slice(-step.alerts),
        },
      ]),
    );

    const nextPayload = {
      ...payload,
      state: {
        recordsByAgentId: nextRecords,
        alerts: (payload.state.alerts ?? []).slice(-step.globalAlerts),
      },
    };

    const raw = JSON.stringify(nextPayload);
    if (resolveByteSize(raw) <= maxBytes) {
      return nextPayload;
    }
  }

  return payload;
}

function sanitizeHealthStorageValue(raw: string, aggressive = false) {
  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== "object") {
    return raw;
  }

  const trimmed = trimHealthPayload(parsed as { state?: PersistedHealthState; version?: number });
  let nextRaw = JSON.stringify(trimmed);
  if (resolveByteSize(nextRaw) <= HEALTH_STORAGE_MAX_BYTES) {
    return nextRaw;
  }

  const shrunk = shrinkHealthPayloadForSize(trimmed, HEALTH_STORAGE_MAX_BYTES);
  nextRaw = JSON.stringify(shrunk);
  if (!aggressive || resolveByteSize(nextRaw) <= HEALTH_STORAGE_MAX_BYTES || !shrunk.state) {
    return nextRaw;
  }

  // 激进模式：仍超限则清空最老的健康记录，优先保证写入成功。
  const minimal = {
    ...shrunk,
    state: {
      recordsByAgentId: {},
      alerts: [],
    },
  };
  nextRaw = JSON.stringify(minimal);
  return nextRaw;
}

function resolveHealthStorage() {
  if (typeof window !== "undefined" && window.localStorage) {
    const storage = window.localStorage;
    return {
      getItem: (key: string) => {
        try {
          return storage.getItem(key);
        } catch (error) {
          console.warn(`[Health] 读取本地存储失败: ${key}`, error);
          return null;
        }
      },
      setItem: (key: string, value: string) => {
        const sanitizedValue = sanitizeHealthStorageValue(value);
        try {
          storage.setItem(key, sanitizedValue);
        } catch (error) {
          if (!isQuotaExceededError(error)) {
            console.warn(`[Health] 写入本地存储失败: ${key}`, error);
            return;
          }

          console.warn(`[Health] 存储空间不足，尝试清理后重试: ${key}`);
          const trimmedValue = sanitizeHealthStorageValue(value, true);
          try {
            storage.setItem(key, trimmedValue);
          } catch (retryError) {
            console.warn(`[Health] 清理后仍无法写入本地存储: ${key}`, retryError);
          }
        }
      },
      removeItem: (key: string) => {
        try {
          storage.removeItem(key);
        } catch (error) {
          console.warn(`[Health] 删除本地存储失败: ${key}`, error);
        }
      },
      key: (index: number) => storage.key(index),
      clear: () => {
        try {
          storage.clear();
        } catch (error) {
          console.warn("[Health] 清空本地存储失败:", error);
        }
      },
      get length() {
        return storage.length;
      },
    } satisfies Storage;
  }

  return FALLBACK_STORAGE;
}

export const useHealthStore = create<HealthState>()(
  persist(
    (set, get) => {
      let initialized = false;
      let cleanupTimer: number | null = null;
      let officeProbeTimer: number | null = null;
      let officeProbeAgentIds: string[] = [];
      const alertListeners = new Set<HealthAlertListener>();
      const pendingByRequestId = new Map<string, PendingHealthInteraction>();
      const pendingByRunId = new Map<string, string>();
      const pendingRequestIdsBySessionKey = new Map<string, string[]>();

      function savePending(pending: PendingHealthInteraction) {
        pendingByRequestId.set(pending.requestId, pending);
        const current = pendingRequestIdsBySessionKey.get(pending.sessionKey) ?? [];
        if (!current.includes(pending.requestId)) {
          pendingRequestIdsBySessionKey.set(pending.sessionKey, [...current, pending.requestId]);
        }
      }

      function clearPending(pending?: PendingHealthInteraction | null) {
        if (!pending) {
          return;
        }

        pendingByRequestId.delete(pending.requestId);
        if (pending.runId) {
          pendingByRunId.delete(pending.runId);
        }
        const current = pendingRequestIdsBySessionKey.get(pending.sessionKey) ?? [];
        const next = current.filter((requestId) => requestId !== pending.requestId);
        if (next.length === 0) {
          pendingRequestIdsBySessionKey.delete(pending.sessionKey);
        } else {
          pendingRequestIdsBySessionKey.set(pending.sessionKey, next);
        }
      }

      function findPending(params: {
        requestId?: string;
        runId?: string | null;
        sessionKey?: string;
      }) {
        if (params.requestId) {
          return pendingByRequestId.get(params.requestId) ?? null;
        }

        if (params.runId) {
          const requestId = pendingByRunId.get(params.runId);
          if (requestId) {
            return pendingByRequestId.get(requestId) ?? null;
          }
        }

        if (params.sessionKey) {
          const requestIds = pendingRequestIdsBySessionKey.get(params.sessionKey) ?? [];
          return (
            requestIds
              .map((requestId) => pendingByRequestId.get(requestId) ?? null)
              .find((pending): pending is PendingHealthInteraction => pending !== null) ?? null
          );
        }

        return null;
      }

      function emitAlert(alert: HealthAlert) {
        for (const listener of alertListeners) {
          listener(alert);
        }
      }

      function updateAgentRecord(
        agentId: string,
        updater: (current: AgentHealthRecord) => AgentHealthRecord,
      ) {
        const now = Date.now();
        let generatedAlerts: HealthAlert[] = [];
        set((state) => {
          const current = trimHealthRecord(
            state.recordsByAgentId[agentId] ?? createEmptyHealthRecord(),
            now,
          );
          const previousAlertIds = new Set(current.alerts.map((alert) => alert.id));
          const nextBase = trimHealthRecord(updater(current), now);
          const nextSummary = deriveHealthSummary(nextBase, now);
          const nextAlerts = [...nextBase.alerts];
          const previousFlags = current.alertFlags;
          const nextFlags = {
            fallbackActive: nextSummary.fallbackActive,
            sessionDown: nextSummary.sessionState === "dead",
            tokenPressure: (nextSummary.usageRatio ?? 0) >= 0.85,
            errorStorm: nextSummary.recentErrorCount >= 2,
          };

          if (!previousFlags.fallbackActive && nextFlags.fallbackActive) {
            nextAlerts.push(
              createHealthAlert({
                agentId,
                severity: "warning",
                code: "fallback",
                timestamp: now,
                message: "主模型异常，已切换到备用模型",
                detail: nextSummary.fallbackReason ?? nextSummary.fallbackModel ?? undefined,
              }),
            );
          }
          if (previousFlags.fallbackActive && !nextFlags.fallbackActive) {
            nextAlerts.push(
              createHealthAlert({
                agentId,
                severity: "recovery",
                code: "fallback",
                timestamp: now,
                message: "模型已恢复主链路",
              }),
            );
          }
          if (!previousFlags.sessionDown && nextFlags.sessionDown) {
            nextAlerts.push(
              createHealthAlert({
                agentId,
                severity: "critical",
                code: "session",
                timestamp: now,
                message: "session 探测失败，员工暂时离线",
              }),
            );
          }
          if (previousFlags.sessionDown && !nextFlags.sessionDown) {
            nextAlerts.push(
              createHealthAlert({
                agentId,
                severity: "recovery",
                code: "session",
                timestamp: now,
                message: "session 已恢复在线",
              }),
            );
          }
          if (!previousFlags.tokenPressure && nextFlags.tokenPressure) {
            nextAlerts.push(
              createHealthAlert({
                agentId,
                severity: "warning",
                code: "tokens",
                timestamp: now,
                message: `Token 上下文占用达到 ${(nextSummary.usageRatio ?? 0) * 100}%`,
                detail: "建议尽快压缩上下文，避免后续溢出。",
              }),
            );
          }
          if (previousFlags.tokenPressure && !nextFlags.tokenPressure) {
            nextAlerts.push(
              createHealthAlert({
                agentId,
                severity: "recovery",
                code: "tokens",
                timestamp: now,
                message: "Token 压力已恢复正常",
              }),
            );
          }
          if (!previousFlags.errorStorm && nextFlags.errorStorm) {
            nextAlerts.push(
              createHealthAlert({
                agentId,
                severity: "critical",
                code: "errors",
                timestamp: now,
                message: "最近多次交互失败，请检查模型或上下文",
                detail: nextSummary.lastErrorMessage ?? undefined,
              }),
            );
          }
          if (previousFlags.errorStorm && !nextFlags.errorStorm) {
            nextAlerts.push(
              createHealthAlert({
                agentId,
                severity: "recovery",
                code: "errors",
                timestamp: now,
                message: "错误率已回落到正常范围",
              }),
            );
          }

          const trimmedAlerts = nextAlerts.slice(-20);
          generatedAlerts = trimmedAlerts.filter((alert) => !previousAlertIds.has(alert.id));
          const nextRecord: AgentHealthRecord = {
            ...nextBase,
            alertFlags: nextFlags,
            summary: nextSummary,
            alerts: trimmedAlerts,
          };
          const nextGlobalAlerts = [...state.alerts, ...generatedAlerts].slice(-120);

          return {
            recordsByAgentId: {
              ...state.recordsByAgentId,
              [agentId]: nextRecord,
            },
            alerts: nextGlobalAlerts,
          };
        });

        generatedAlerts.forEach((alert) => emitAlert(alert));
      }

      function appendUsageSnapshot(agentId: string, snapshot: HealthUsageSnapshot) {
        updateAgentRecord(agentId, (current) => {
          const nextSnapshots = [...current.usageSnapshots, snapshot].slice(-60);
          return {
            ...current,
            usageSnapshots: nextSnapshots,
            hasKnownSession:
              current.hasKnownSession ||
              snapshot.sessionAlive === true ||
              current.interactions.length > 0,
            uptimeStartedAt:
              snapshot.sessionAlive === false
                ? null
                : (current.uptimeStartedAt ?? snapshot.capturedAt),
          };
        });
      }

      function completeInteraction(params: {
        pending?: PendingHealthInteraction | null;
        agentId: string;
        sessionKey: string;
        kind: HealthRequestKind;
        completedAt: number;
        success: boolean;
        runId?: string | null;
        model?: string | null;
        provider?: string | null;
        errorMessage?: string;
        currentContextUsed?: number | null;
      }) {
        const pending = params.pending ?? null;
        const messageError = params.errorMessage?.trim() ?? "";
        const classified = messageError ? classifyHealthError(messageError) : null;
        const interactionStartedAt = pending?.startedAt ?? params.completedAt;
        const latencyMs =
          pending?.firstTokenAt && pending.firstTokenAt >= interactionStartedAt
            ? pending.firstTokenAt - interactionStartedAt
            : null;

        updateAgentRecord(params.agentId, (current) => {
          const nextInteractions = [
            ...current.interactions,
            {
              id: crypto.randomUUID(),
              kind: params.kind,
              requestId: pending?.requestId ?? params.runId ?? crypto.randomUUID(),
              runId: params.runId ?? pending?.runId ?? null,
              sessionKey: params.sessionKey,
              startedAt: interactionStartedAt,
              firstTokenAt: pending?.firstTokenAt ?? null,
              completedAt: params.completedAt,
              latencyMs,
              success: params.success,
              model: params.model ?? current.lastKnownModel,
              provider: params.provider ?? undefined,
              usedFallback: pending?.usedFallback === true || current.fallbackActive,
              errorType: classified?.type,
              errorMessage: messageError || undefined,
            },
          ].slice(-60);

          const currentContextUsed =
            typeof params.currentContextUsed === "number"
              ? params.currentContextUsed
              : (current.usageSnapshots.at(-1)?.currentContextUsed ?? null);
          const nextUsageSnapshots =
            params.success && currentContextUsed !== null
              ? [
                  ...current.usageSnapshots,
                  {
                    id: crypto.randomUUID(),
                    sessionKey: params.sessionKey,
                    capturedAt: params.completedAt,
                    source: "history",
                    sessionAlive: true,
                    contextWindowSize: current.usageSnapshots.at(-1)?.contextWindowSize ?? null,
                    currentContextUsed,
                  } satisfies HealthUsageSnapshot,
                ].slice(-60)
              : current.usageSnapshots;

          return {
            ...current,
            interactions: nextInteractions,
            usageSnapshots: nextUsageSnapshots,
            lastKnownModel: params.model ?? current.lastKnownModel,
            hasKnownSession: true,
            uptimeStartedAt:
              params.success && (currentContextUsed !== null || pending?.firstTokenAt)
                ? (current.uptimeStartedAt ?? params.completedAt)
                : null,
          };
        });

        clearPending(pending);
      }

      async function runOfficeProbe(agentIds: string[]) {
        if (agentIds.length === 0) {
          return;
        }

        try {
          console.log(`[Health] 开始办公室探测: agents=${agentIds.length}`);
          const mainKey = useAgentStore.getState().mainKey.trim();
          if (!mainKey) {
            return;
          }

          const payload = await gateway.sendRequest<SessionRuntimeListPayload>("sessions.list", {
            includeGlobal: true,
            includeUnknown: true,
            limit: 300,
          });

          for (const agentId of agentIds) {
            const sessionKey = buildSessionKey(agentId, mainKey);
            const runtime = resolveSessionRuntimeState(sessionKey, payload);
            appendUsageSnapshot(agentId, {
              id: crypto.randomUUID(),
              sessionKey,
              capturedAt: Date.now(),
              source: "probe",
              sessionAlive: runtime.sessionFound,
              contextWindowSize: runtime.contextWindowSize > 0 ? runtime.contextWindowSize : null,
              currentContextUsed: runtime.currentContextUsedFresh
                ? runtime.currentContextUsed
                : null,
            });
          }
        } catch (error) {
          console.error("[Health] 办公室探测失败:", error);
        }
      }

      const lifecycleObserver: GatewayLifecycleObserver = {
        onRequestStart: (event) => {
          if (!event.agentId) {
            return;
          }
          console.log(
            `[Health] 请求开始: kind=${event.kind}, agent=${event.agentId}, session=${event.sessionKey}`,
          );
          savePending({
            kind: event.kind,
            requestId: event.requestId,
            sessionKey: event.sessionKey,
            agentId: event.agentId,
            startedAt: event.startedAt,
          });
        },
        onRunAccepted: (event) => {
          const pending = findPending({ requestId: event.requestId, sessionKey: event.sessionKey });
          if (!pending) {
            return;
          }
          pending.runId = event.runId;
          pendingByRunId.set(event.runId, pending.requestId);
          savePending(pending);
        },
        onAssistantMessage: (event) => {
          if (!event.agentId) {
            return;
          }

          completeInteraction({
            pending: findPending({ runId: event.runId ?? undefined, sessionKey: event.sessionKey }),
            agentId: event.agentId,
            sessionKey: event.sessionKey,
            kind: event.kind,
            completedAt: event.message.timestamp ?? event.receivedAt,
            success: true,
            runId: event.runId,
            model: event.message.model ?? null,
            provider: event.message.provider ?? null,
            currentContextUsed:
              event.message.usage?.input !== undefined ||
              event.message.usage?.cacheRead !== undefined ||
              event.message.usage?.cacheWrite !== undefined
                ? (event.message.usage.input ?? 0) +
                  (event.message.usage.cacheRead ?? 0) +
                  (event.message.usage.cacheWrite ?? 0)
                : null,
          });
        },
        onRequestError: (event) => {
          if (!event.agentId || !event.sessionKey) {
            return;
          }

          completeInteraction({
            pending: findPending({
              requestId: event.requestId,
              runId: event.runId ?? undefined,
              sessionKey: event.sessionKey,
            }),
            agentId: event.agentId,
            sessionKey: event.sessionKey,
            kind: event.kind,
            completedAt: event.occurredAt,
            success: false,
            runId: event.runId,
            errorMessage: event.message,
          });
        },
      };

      function initializeObservers() {
        gateway.addLifecycleObserver(lifecycleObserver);
        gateway.addEventHandler((eventName, payload) => {
          if (eventName === "chat") {
            const sessionKey =
              typeof (payload as { sessionKey?: unknown }).sessionKey === "string"
                ? ((payload as { sessionKey?: string }).sessionKey ?? "")
                : "";
            const runId =
              typeof (payload as { runId?: unknown }).runId === "string"
                ? ((payload as { runId?: string }).runId ?? null)
                : null;
            const timestamp =
              typeof (payload as { message?: { timestamp?: unknown } }).message?.timestamp ===
              "number"
                ? Number((payload as { message?: { timestamp?: number } }).message?.timestamp)
                : Date.now();
            const state =
              typeof (payload as { state?: unknown }).state === "string"
                ? ((payload as { state?: string }).state ?? "")
                : "";
            if (state === "delta" && sessionKey) {
              const pending = findPending({ runId, sessionKey });
              if (pending && !pending.firstTokenAt) {
                pending.firstTokenAt = timestamp;
                savePending(pending);
                console.log(
                  `[Health] 首包到达: agent=${pending.agentId}, latency=${timestamp - pending.startedAt}ms`,
                );
              }
            }
          }

          if (eventName === "agent") {
            const agentPayload = payload as {
              stream?: string;
              runId?: string;
              sessionKey?: string;
              ts?: number;
              data?: Record<string, unknown>;
            };
            const sessionKey = agentPayload.sessionKey ?? "";
            const runId = agentPayload.runId ?? null;
            const timestamp = typeof agentPayload.ts === "number" ? agentPayload.ts : Date.now();
            if (agentPayload.stream === "assistant" && sessionKey) {
              const pending = findPending({ runId, sessionKey });
              if (pending && !pending.firstTokenAt) {
                pending.firstTokenAt = timestamp;
                savePending(pending);
                console.log(
                  `[Health] Agent 首包到达: agent=${pending.agentId}, latency=${timestamp - pending.startedAt}ms`,
                );
              }
            }

            if (
              (agentPayload.stream === "lifecycle" || agentPayload.stream === "fallback") &&
              sessionKey
            ) {
              const agentId = parseAgentIdFromSessionKey(sessionKey);
              const fallback = agentPayload.data
                ? parseFallbackPayload({ ...agentPayload.data, stream: agentPayload.stream })
                : null;
              if (!agentId || !fallback) {
                return;
              }

              const pending = findPending({ runId, sessionKey });
              if (pending && fallback.active) {
                pending.usedFallback = true;
                savePending(pending);
              }

              updateAgentRecord(agentId, (current) => {
                const event: HealthFallbackEvent = {
                  id: crypto.randomUUID(),
                  sessionKey,
                  occurredAt: timestamp,
                  active: fallback.active,
                  selectedModel: fallback.selectedModel,
                  activeModel: fallback.activeModel,
                  previousModel: fallback.previousModel,
                  reason: fallback.reason,
                  attempts: fallback.attempts,
                };
                return {
                  ...current,
                  fallbackEvents: [...current.fallbackEvents, event].slice(-20),
                  fallbackActive: fallback.active,
                  fallbackModel: fallback.active ? fallback.activeModel : null,
                  fallbackReason: fallback.active ? (fallback.reason ?? null) : null,
                  fallbackUpdatedAt: timestamp,
                  lastKnownModel: fallback.active ? fallback.activeModel : current.lastKnownModel,
                };
              });
            }
          }
        });
      }

      return {
        recordsByAgentId: {},
        alerts: [],

        initialize: () => {
          if (initialized) {
            return;
          }

          initialized = true;
          console.log("[Health] initialize");
          initializeObservers();
          set((state) => {
            const nextRecords = Object.fromEntries(
              Object.entries(state.recordsByAgentId).map(([agentId, record]) => {
                const trimmed = trimHealthRecord(record);
                return [agentId, { ...trimmed, summary: deriveHealthSummary(trimmed) }];
              }),
            );
            return {
              recordsByAgentId: nextRecords,
              alerts: state.alerts.filter(
                (alert) => alert.timestamp >= Date.now() - OFFICE_ALERT_REPLAY_MS * 6,
              ),
            };
          });

          if (cleanupTimer !== null) {
            window.clearInterval(cleanupTimer);
          }
          cleanupTimer = window.setInterval(() => {
            set((state) => ({
              recordsByAgentId: Object.fromEntries(
                Object.entries(state.recordsByAgentId).map(([agentId, record]) => {
                  const trimmed = trimHealthRecord(record);
                  return [agentId, { ...trimmed, summary: deriveHealthSummary(trimmed) }];
                }),
              ),
              alerts: state.alerts.filter(
                (alert) => alert.timestamp >= Date.now() - OFFICE_ALERT_REPLAY_MS * 6,
              ),
            }));
          }, HEALTH_CLEANUP_INTERVAL_MS);
        },

        startOfficeProbe: (agents, intervalMs = DEFAULT_OFFICE_PROBE_INTERVAL_MS) => {
          officeProbeAgentIds = agents.map((agent) => agent.id);
          if (officeProbeTimer !== null) {
            window.clearInterval(officeProbeTimer);
            officeProbeTimer = null;
          }

          console.log(`[Health] 启动办公室探测: interval=${intervalMs}ms`);
          void runOfficeProbe(officeProbeAgentIds);
          officeProbeTimer = window.setInterval(() => {
            void runOfficeProbe(officeProbeAgentIds);
          }, intervalMs);
        },

        stopOfficeProbe: () => {
          if (officeProbeTimer !== null) {
            window.clearInterval(officeProbeTimer);
            officeProbeTimer = null;
          }
          officeProbeAgentIds = [];
          console.log("[Health] 停止办公室探测");
        },

        subscribeAlerts: (listener, options) => {
          alertListeners.add(listener);
          if (options?.replayRecent) {
            const cutoff = Date.now() - OFFICE_ALERT_REPLAY_MS;
            get()
              .alerts.filter((alert) => alert.timestamp >= cutoff)
              .forEach((alert) => listener(alert));
          }
          return () => {
            alertListeners.delete(listener);
          };
        },

        getSummaryForAgent: (agentId) => {
          return get().recordsByAgentId[agentId]?.summary ?? EMPTY_HEALTH_SUMMARY;
        },

        recordHistorySnapshot: ({
          agentId,
          sessionKey,
          currentContextUsed,
          contextWindowSize,
          model,
          timestamp,
        }) => {
          appendUsageSnapshot(agentId, {
            id: crypto.randomUUID(),
            sessionKey,
            capturedAt: timestamp ?? Date.now(),
            source: "history",
            sessionAlive: true,
            contextWindowSize:
              typeof contextWindowSize === "number" && contextWindowSize > 0
                ? contextWindowSize
                : null,
            currentContextUsed:
              typeof currentContextUsed === "number" && currentContextUsed >= 0
                ? currentContextUsed
                : null,
          });
          if (model?.trim()) {
            updateAgentRecord(agentId, (current) => ({
              ...current,
              lastKnownModel: model.trim(),
            }));
          }
        },

        recordAssistantMessage: ({ agentId, sessionKey, kind, message, runId }) => {
          completeInteraction({
            pending: findPending({ runId, sessionKey }),
            agentId,
            sessionKey,
            kind,
            completedAt: message.timestamp ?? Date.now(),
            success: true,
            runId,
            model: message.model ?? null,
            provider: message.provider ?? null,
            currentContextUsed:
              message.usage?.input !== undefined ||
              message.usage?.cacheRead !== undefined ||
              message.usage?.cacheWrite !== undefined
                ? (message.usage.input ?? 0) +
                  (message.usage.cacheRead ?? 0) +
                  (message.usage.cacheWrite ?? 0)
                : null,
          });
        },

        recordRequestError: ({ agentId, sessionKey, kind, message, runId }) => {
          completeInteraction({
            pending: findPending({ runId, sessionKey }),
            agentId,
            sessionKey,
            kind,
            completedAt: Date.now(),
            success: false,
            runId,
            errorMessage: message,
          });
        },
      };
    },
    {
      name: HEALTH_STORAGE_KEY,
      storage: createJSONStorage(resolveHealthStorage),
      partialize: (state): PersistedHealthState => ({
        recordsByAgentId: state.recordsByAgentId,
        alerts: state.alerts,
      }),
    },
  ),
);
