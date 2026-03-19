import { create } from "zustand";
import {
  gateway,
  type GatewayChatEventPayload,
  type GatewayCronEventPayload,
  type GatewayCronJob,
  type GatewayCronRunLogEntry,
  type GatewayCronStatusResponse,
} from "@/services/gateway";
import { useGroupStore } from "@/stores/groupStore";
import {
  buildCronMirrorMessageId,
  buildCronScheduleFromDraft,
  decodeXiabanCronMeta,
  encodeXiabanCronDescription,
  extractAgentIdFromSessionKey,
  extractCronJobIdFromSessionKey,
  type CronScheduleDraft,
  type XiabanCronMeta,
  type XiabanCronReplyMode,
} from "@/utils/cronTask";
import {
  adaptHistoryMessage,
  adaptHistoryMessages,
  type ChatMessage,
} from "@/utils/messageAdapter";

export type CronUpsertInput = {
  name: string;
  agentId: string;
  instruction: string;
  scheduleDraft: CronScheduleDraft;
  replyMode: XiabanCronReplyMode;
  groupId?: string | null;
  enabled?: boolean;
};

type CronFocusRequest = {
  agentId: string;
  token: number;
};

type CronState = {
  initialized: boolean;
  jobs: GatewayCronJob[];
  status: GatewayCronStatusResponse | null;
  runsByJobId: Record<string, GatewayCronRunLogEntry[]>;
  loading: boolean;
  runsLoadingByJobId: Record<string, boolean>;
  mutatingJobIds: string[];
  submitting: boolean;
  focusRequest: CronFocusRequest | null;
  initialize: () => void;
  refreshJobs: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  fetchJobRuns: (jobId: string, limit?: number) => Promise<GatewayCronRunLogEntry[]>;
  createJob: (input: CronUpsertInput) => Promise<GatewayCronJob>;
  updateJob: (jobId: string, input: CronUpsertInput) => Promise<GatewayCronJob>;
  pauseJob: (jobId: string) => Promise<void>;
  resumeJob: (jobId: string) => Promise<void>;
  deleteJob: (jobId: string) => Promise<void>;
  resolveJobById: (jobId: string) => GatewayCronJob | undefined;
  resolveMetaBySessionKey: (sessionKey: string | null | undefined) => XiabanCronMeta | null;
  requestAgentScheduleFocus: (agentId: string) => void;
  clearAgentScheduleFocus: (token: number) => void;
};

let gatewayEventUnsubscribe: (() => void) | null = null;

function isRenderableAssistantMessage(message: ChatMessage | null): message is ChatMessage {
  return Boolean(
    message &&
    message.role === "assistant" &&
    (message.content.trim().length > 0 || message.thinking?.trim().length),
  );
}

function normalizeRuns(entries: GatewayCronRunLogEntry[] | undefined) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return [...entries].toSorted((left, right) => {
    const leftTs = left.ts ?? left.runAtMs ?? 0;
    const rightTs = right.ts ?? right.runAtMs ?? 0;
    return rightTs - leftTs;
  });
}

function normalizeJobs(jobs: GatewayCronJob[] | undefined) {
  if (!Array.isArray(jobs)) {
    return [];
  }

  return [...jobs].toSorted((left, right) => {
    const leftNext = left.state?.nextRunAtMs ?? Number.MAX_SAFE_INTEGER;
    const rightNext = right.state?.nextRunAtMs ?? Number.MAX_SAFE_INTEGER;
    if (leftNext !== rightNext) {
      return leftNext - rightNext;
    }

    return (left.name?.trim() || left.id).localeCompare(right.name?.trim() || right.id, "zh-CN");
  });
}

function addMutatingJobId(jobIds: string[], jobId: string) {
  return jobIds.includes(jobId) ? jobIds : [...jobIds, jobId];
}

function removeMutatingJobId(jobIds: string[], jobId: string) {
  return jobIds.filter((item) => item !== jobId);
}

function buildMeta(input: CronUpsertInput): XiabanCronMeta {
  return {
    version: 1,
    replyMode: input.replyMode,
    groupId: input.replyMode === "group" ? input.groupId?.trim() || undefined : undefined,
  };
}

function assertUpsertInput(input: CronUpsertInput) {
  if (!input.name.trim()) {
    throw new Error("请填写任务名称");
  }

  if (!input.agentId.trim()) {
    throw new Error("请选择执行员工");
  }

  if (!input.instruction.trim()) {
    throw new Error("请填写任务指令");
  }

  if (input.replyMode === "group" && !input.groupId?.trim()) {
    throw new Error("请选择目标群聊");
  }
}

async function resolveGroupMirrorMessage(
  payload: GatewayChatEventPayload,
  jobId: string,
  sessionKey: string,
) {
  const directMessage = payload.message ? adaptHistoryMessage(payload.message) : null;
  if (isRenderableAssistantMessage(directMessage)) {
    return {
      ...directMessage,
      id: buildCronMirrorMessageId({
        jobId,
        timestamp: directMessage.timestamp,
        content: directMessage.content,
        thinking: directMessage.thinking,
      }),
      isNew: true,
      isHistorical: false,
    } satisfies ChatMessage;
  }

  const history = await gateway.loadHistory(sessionKey, 12);
  const lastAssistantMessage = adaptHistoryMessages(history)
    .toReversed()
    .find((message) => isRenderableAssistantMessage(message));

  if (!lastAssistantMessage) {
    return null;
  }

  return {
    ...lastAssistantMessage,
    id: buildCronMirrorMessageId({
      jobId,
      timestamp: lastAssistantMessage.timestamp,
      content: lastAssistantMessage.content,
      thinking: lastAssistantMessage.thinking,
    }),
    isNew: true,
    isHistorical: false,
  } satisfies ChatMessage;
}

export const useCronStore = create<CronState>((set, get) => {
  async function handleCronChatFinal(payload: GatewayChatEventPayload) {
    const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey.trim() : "";
    const jobId = extractCronJobIdFromSessionKey(sessionKey);
    if (!jobId) {
      return;
    }

    const job = get().resolveJobById(jobId);
    const meta = decodeXiabanCronMeta(job?.description);
    if (meta?.replyMode !== "group" || !meta.groupId) {
      return;
    }

    const agentId = job?.agentId?.trim() || extractAgentIdFromSessionKey(sessionKey);
    if (!agentId) {
      return;
    }

    const message = await resolveGroupMirrorMessage(payload, jobId, sessionKey);
    if (!message) {
      return;
    }

    useGroupStore.getState().mirrorCronReplyToGroup({
      groupId: meta.groupId,
      agentId,
      jobId,
      message,
    });
  }

  async function refreshJobs() {
    set({ loading: true });

    try {
      const payload = await gateway.listCronJobs({ limit: 200 });
      set({
        jobs: normalizeJobs(payload.jobs),
      });
    } finally {
      set({ loading: false });
    }
  }

  async function refreshStatus() {
    const payload = await gateway.getCronStatus();
    set({
      status: payload,
    });
  }

  return {
    initialized: false,
    jobs: [],
    status: null,
    runsByJobId: {},
    loading: false,
    runsLoadingByJobId: {},
    mutatingJobIds: [],
    submitting: false,
    focusRequest: null,

    initialize: () => {
      if (get().initialized) {
        return;
      }

      console.log("[Cron] initialize cron store");
      gateway.connect();
      set({ initialized: true });

      gatewayEventUnsubscribe?.();
      gatewayEventUnsubscribe = gateway.addEventHandler((eventName, payload) => {
        if (eventName === "cron") {
          const cronPayload = payload as GatewayCronEventPayload;
          const jobId = typeof cronPayload.jobId === "string" ? cronPayload.jobId.trim() : "";
          console.log("[Cron] gateway cron event:", cronPayload);

          if (jobId && get().runsByJobId[jobId]) {
            void get().fetchJobRuns(jobId, Math.max(get().runsByJobId[jobId].length, 5));
          }

          void get().refreshJobs();
          if (
            cronPayload.action === "added" ||
            cronPayload.action === "removed" ||
            cronPayload.action === "updated"
          ) {
            void get().refreshStatus();
          }
          return;
        }

        if (eventName === "chat") {
          const chatPayload = payload as GatewayChatEventPayload;
          if (chatPayload.state === "final") {
            void handleCronChatFinal(chatPayload);
          }
        }
      });

      void Promise.allSettled([get().refreshJobs(), get().refreshStatus()]);
    },

    refreshJobs,

    refreshStatus,

    fetchJobRuns: async (jobId, limit = 5) => {
      set((state) => ({
        runsLoadingByJobId: {
          ...state.runsLoadingByJobId,
          [jobId]: true,
        },
      }));

      try {
        const payload = await gateway.listCronRuns({
          jobId,
          limit,
        });
        const entries = normalizeRuns(payload.entries);
        set((state) => ({
          runsByJobId: {
            ...state.runsByJobId,
            [jobId]: entries,
          },
        }));
        return entries;
      } finally {
        set((state) => ({
          runsLoadingByJobId: {
            ...state.runsLoadingByJobId,
            [jobId]: false,
          },
        }));
      }
    },

    createJob: async (input) => {
      assertUpsertInput(input);
      set({ submitting: true });

      try {
        const created = await gateway.createCronJob({
          name: input.name.trim(),
          agentId: input.agentId.trim(),
          description: encodeXiabanCronDescription(buildMeta(input)),
          enabled: input.enabled !== false,
          sessionTarget: "isolated",
          wakeMode: "now",
          schedule: buildCronScheduleFromDraft(input.scheduleDraft),
          payload: {
            kind: "agentTurn",
            message: input.instruction.trim(),
            deliver: false,
          },
          delivery: {
            mode: "none",
          },
          failureAlert: false,
        });

        await Promise.all([get().refreshJobs(), get().refreshStatus()]);
        return created;
      } finally {
        set({ submitting: false });
      }
    },

    updateJob: async (jobId, input) => {
      assertUpsertInput(input);
      set((state) => ({
        submitting: true,
        mutatingJobIds: addMutatingJobId(state.mutatingJobIds, jobId),
      }));

      try {
        const currentJob = get().resolveJobById(jobId);
        const updated = await gateway.updateCronJob(jobId, {
          name: input.name.trim(),
          agentId: input.agentId.trim(),
          description: encodeXiabanCronDescription(buildMeta(input)),
          enabled: input.enabled ?? currentJob?.enabled ?? true,
          sessionTarget: "isolated",
          wakeMode: currentJob?.wakeMode ?? "now",
          schedule: buildCronScheduleFromDraft(input.scheduleDraft),
          payload: {
            kind: "agentTurn",
            message: input.instruction.trim(),
            deliver: false,
          },
          delivery: {
            mode: "none",
          },
          failureAlert: false,
        });

        await Promise.all([get().refreshJobs(), get().refreshStatus()]);
        return updated;
      } finally {
        set((state) => ({
          submitting: false,
          mutatingJobIds: removeMutatingJobId(state.mutatingJobIds, jobId),
        }));
      }
    },

    pauseJob: async (jobId) => {
      set((state) => ({
        mutatingJobIds: addMutatingJobId(state.mutatingJobIds, jobId),
      }));

      try {
        await gateway.pauseCronJob(jobId);
        await get().refreshJobs();
      } finally {
        set((state) => ({
          mutatingJobIds: removeMutatingJobId(state.mutatingJobIds, jobId),
        }));
      }
    },

    resumeJob: async (jobId) => {
      set((state) => ({
        mutatingJobIds: addMutatingJobId(state.mutatingJobIds, jobId),
      }));

      try {
        await gateway.resumeCronJob(jobId);
        await get().refreshJobs();
      } finally {
        set((state) => ({
          mutatingJobIds: removeMutatingJobId(state.mutatingJobIds, jobId),
        }));
      }
    },

    deleteJob: async (jobId) => {
      set((state) => ({
        mutatingJobIds: addMutatingJobId(state.mutatingJobIds, jobId),
      }));

      try {
        await gateway.removeCronJob(jobId);
        await Promise.all([get().refreshJobs(), get().refreshStatus()]);
        set((state) => {
          const nextRuns = { ...state.runsByJobId };
          delete nextRuns[jobId];
          return {
            runsByJobId: nextRuns,
          };
        });
      } finally {
        set((state) => ({
          mutatingJobIds: removeMutatingJobId(state.mutatingJobIds, jobId),
        }));
      }
    },

    resolveJobById: (jobId) => {
      return get().jobs.find((job) => job.id === jobId);
    },

    resolveMetaBySessionKey: (sessionKey) => {
      const jobId = extractCronJobIdFromSessionKey(sessionKey);
      if (!jobId) {
        return null;
      }

      return decodeXiabanCronMeta(get().resolveJobById(jobId)?.description);
    },

    requestAgentScheduleFocus: (agentId) => {
      const normalizedAgentId = agentId.trim();
      if (!normalizedAgentId) {
        return;
      }

      set({
        focusRequest: {
          agentId: normalizedAgentId,
          token: Date.now(),
        },
      });
    },

    clearAgentScheduleFocus: (token) => {
      const focusRequest = get().focusRequest;
      if (!focusRequest || focusRequest.token !== token) {
        return;
      }

      set({ focusRequest: null });
    },
  };
});
