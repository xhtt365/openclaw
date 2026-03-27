import type { GatewayCronJob, GatewayCronSchedule } from "@/services/gateway";
import type { Group } from "@/stores/groupStore";

const XIABAN_CRON_META_PREFIX = "__XIABAN_CRON_META_V1__:";
const DEFAULT_TIMEZONE =
  typeof Intl !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai"
    : "Asia/Shanghai";

export type XiabanCronReplyMode = "direct" | "group" | "silent";
export type CronFrequencyPreset = "daily" | "weekly" | "intervalHours" | "custom";
export type CronDisplayStatus = "RUNNING" | "STOPPED" | "ERROR";

export type XiabanCronMeta = {
  version: 1;
  replyMode: XiabanCronReplyMode;
  groupId?: string;
};

export type CronScheduleDraft = {
  mode: CronFrequencyPreset;
  time: string;
  weekday: string;
  intervalHours: number;
  expr: string;
  timezone: string;
};

export type CronWeekdayOption = {
  value: string;
  label: string;
};

export const CRON_WEEKDAY_OPTIONS: CronWeekdayOption[] = [
  { value: "1", label: "周一" },
  { value: "2", label: "周二" },
  { value: "3", label: "周三" },
  { value: "4", label: "周四" },
  { value: "5", label: "周五" },
  { value: "6", label: "周六" },
  { value: "0", label: "周日" },
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeJobId(raw: string) {
  const normalized = raw.trim();
  if (!normalized) {
    return null;
  }

  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

function resolveTimeParts(time: string) {
  const match = time.trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error("请选择有效执行时间");
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error("请选择有效执行时间");
  }

  return {
    hour,
    minute,
  };
}

function padTime(value: number) {
  return String(Math.max(0, value)).padStart(2, "0");
}

function formatTimeFromTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "09:00";
  }

  return `${padTime(date.getHours())}:${padTime(date.getMinutes())}`;
}

function buildAnchorMs(time: string) {
  const { hour, minute } = resolveTimeParts(time);
  const anchor = new Date();
  anchor.setHours(hour, minute, 0, 0);
  return anchor.getTime();
}

function formatDateTime(timestamp?: number, fallback = "未计划") {
  if (!isFiniteNumber(timestamp)) {
    return fallback;
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function getDefaultCronTimezone() {
  return DEFAULT_TIMEZONE;
}

export function encodeXiabanCronDescription(meta: XiabanCronMeta) {
  const payload: XiabanCronMeta = {
    version: 1,
    replyMode: meta.replyMode,
    groupId: meta.replyMode === "group" ? meta.groupId?.trim() || undefined : undefined,
  };

  return `${XIABAN_CRON_META_PREFIX}${JSON.stringify(payload)}`;
}

export function decodeXiabanCronMeta(
  description: string | null | undefined,
): XiabanCronMeta | null {
  if (typeof description !== "string") {
    return null;
  }

  const normalized = description.trim();
  if (!normalized.startsWith(XIABAN_CRON_META_PREFIX)) {
    return null;
  }

  const raw = normalized.slice(XIABAN_CRON_META_PREFIX.length).trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<XiabanCronMeta>;
    if (parsed.version !== 1) {
      return null;
    }

    if (
      parsed.replyMode !== "direct" &&
      parsed.replyMode !== "group" &&
      parsed.replyMode !== "silent"
    ) {
      return null;
    }

    return {
      version: 1,
      replyMode: parsed.replyMode,
      groupId: typeof parsed.groupId === "string" ? parsed.groupId.trim() || undefined : undefined,
    };
  } catch {
    return null;
  }
}

export function extractCronJobIdFromSessionKey(sessionKey: string | null | undefined) {
  if (typeof sessionKey !== "string") {
    return null;
  }

  const normalized = sessionKey.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("cron:")) {
    return normalizeJobId(normalized.slice("cron:".length));
  }

  const marker = ":cron:";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  return normalizeJobId(normalized.slice(markerIndex + marker.length));
}

export function extractAgentIdFromSessionKey(sessionKey: string | null | undefined) {
  if (typeof sessionKey !== "string" || !sessionKey.startsWith("agent:")) {
    return null;
  }

  const parts = sessionKey.split(":");
  const agentId = parts[1]?.trim();
  return agentId || null;
}

export function isCronSessionKey(sessionKey: string | null | undefined) {
  return extractCronJobIdFromSessionKey(sessionKey) !== null;
}

export function isXiabanManagedCronJob(job: GatewayCronJob) {
  return job.sessionTarget === "isolated" && job.payload?.kind === "agentTurn";
}

export function isEditableXiabanCronJob(job: GatewayCronJob) {
  if (!isXiabanManagedCronJob(job)) {
    return false;
  }

  return job.schedule?.kind === "cron" || job.schedule?.kind === "every";
}

export function resolveCronDisplayStatus(job: GatewayCronJob): CronDisplayStatus {
  if (job.enabled === false) {
    return "STOPPED";
  }

  if (
    job.state?.lastRunStatus === "error" ||
    job.state?.lastStatus === "error" ||
    Boolean(job.state?.lastError?.trim()) ||
    (job.state?.consecutiveErrors ?? 0) > 0
  ) {
    return "ERROR";
  }

  return "RUNNING";
}

export function resolveCronStatusLabel(status: CronDisplayStatus) {
  if (status === "ERROR") {
    return "Error";
  }

  if (status === "STOPPED") {
    return "Stopped";
  }

  return "Running";
}

export function resolveCronNextRunText(job: GatewayCronJob) {
  return formatDateTime(job.state?.nextRunAtMs ?? undefined, "未安排");
}

export function resolveCronLastRunText(job: GatewayCronJob) {
  return formatDateTime(job.state?.lastRunAtMs ?? undefined, "暂无");
}

export function buildCronMirrorMessageId(params: {
  jobId: string;
  timestamp?: number;
  content: string;
  thinking?: string;
}) {
  const base = `${params.jobId}:${params.timestamp ?? 0}:${params.content}:${params.thinking ?? ""}`;
  let hash = 0;
  for (const char of base) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return `cron:${params.jobId}:${params.timestamp ?? 0}:${hash.toString(16)}`;
}

export function resolveCronScheduleSummary(schedule: GatewayCronSchedule | undefined) {
  if (!schedule) {
    return "未配置执行频率";
  }

  if (schedule.kind === "every") {
    const hours = Math.max(1, Math.round(schedule.everyMs / (60 * 60 * 1000)));
    const anchorText = isFiniteNumber(schedule.anchorMs)
      ? `，起始 ${formatTimeFromTimestamp(schedule.anchorMs)}`
      : "";
    return `每隔 ${hours} 小时${anchorText}`;
  }

  if (schedule.kind === "at") {
    return `单次执行 · ${formatDateTime(Date.parse(schedule.at), schedule.at)}`;
  }

  const expr = schedule.expr.trim();
  const dailyMatch = expr.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (dailyMatch) {
    return `每天 ${padTime(Number(dailyMatch[2]))}:${padTime(Number(dailyMatch[1]))}`;
  }

  const weeklyMatch = expr.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([0-6])$/);
  if (weeklyMatch) {
    const weekday = CRON_WEEKDAY_OPTIONS.find((item) => item.value === weeklyMatch[3]);
    return `${weekday?.label ?? "每周"} ${padTime(Number(weeklyMatch[2]))}:${padTime(Number(weeklyMatch[1]))}`;
  }

  return `Cron · ${expr}`;
}

export function resolveCronReplyTargetLabel(meta: XiabanCronMeta | null, groups: Group[] = []) {
  if (!meta || meta.replyMode === "direct") {
    return "发到员工 1v1 聊天";
  }

  if (meta.replyMode === "silent") {
    return "仅执行不发送";
  }

  const groupName =
    groups.find((group) => group.id === meta.groupId)?.name || meta.groupId?.trim() || "指定群聊";
  return `发到群聊 · ${groupName}`;
}

export function filterCronJobsByAgent(jobs: GatewayCronJob[], agentId: string | null | undefined) {
  const normalizedAgentId = agentId?.trim();
  if (!normalizedAgentId) {
    return [];
  }

  return jobs.filter((job) => job.agentId?.trim() === normalizedAgentId);
}

export function filterCronJobsByGroup(
  jobs: GatewayCronJob[],
  groupId: string | null | undefined,
  leaderId?: string | null,
) {
  const normalizedGroupId = groupId?.trim();
  if (!normalizedGroupId) {
    return [];
  }

  return jobs.filter((job) => {
    const meta = decodeXiabanCronMeta(job.description);
    if (meta?.replyMode !== "group" || meta.groupId !== normalizedGroupId) {
      return false;
    }

    if (!leaderId?.trim()) {
      return true;
    }

    return job.agentId?.trim() === leaderId.trim();
  });
}

export function findNearestCronNextRunAt(jobs: GatewayCronJob[]) {
  return jobs.reduce<number | null>((nearest, job) => {
    const nextRunAtMs = job.state?.nextRunAtMs;
    if (!isFiniteNumber(nextRunAtMs)) {
      return nearest;
    }

    if (nearest === null || nextRunAtMs < nearest) {
      return nextRunAtMs;
    }

    return nearest;
  }, null);
}

export function createDefaultCronScheduleDraft(): CronScheduleDraft {
  return {
    mode: "daily",
    time: "09:00",
    weekday: "1",
    intervalHours: 24,
    expr: "0 9 * * *",
    timezone: getDefaultCronTimezone(),
  };
}

export function resolveCronScheduleDraft(
  schedule: GatewayCronSchedule | undefined,
): CronScheduleDraft {
  if (!schedule) {
    return createDefaultCronScheduleDraft();
  }

  if (schedule.kind === "every") {
    const intervalHours = Math.max(1, Math.round(schedule.everyMs / (60 * 60 * 1000)));
    return {
      mode: "intervalHours",
      time: formatTimeFromTimestamp(
        isFiniteNumber(schedule.anchorMs) ? schedule.anchorMs : Date.now(),
      ),
      weekday: "1",
      intervalHours,
      expr: "",
      timezone: getDefaultCronTimezone(),
    };
  }

  if (schedule.kind === "cron") {
    const expr = schedule.expr.trim();
    const dailyMatch = expr.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
    if (dailyMatch) {
      return {
        mode: "daily",
        time: `${padTime(Number(dailyMatch[2]))}:${padTime(Number(dailyMatch[1]))}`,
        weekday: "1",
        intervalHours: 24,
        expr,
        timezone: schedule.tz?.trim() || getDefaultCronTimezone(),
      };
    }

    const weeklyMatch = expr.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([0-6])$/);
    if (weeklyMatch) {
      return {
        mode: "weekly",
        time: `${padTime(Number(weeklyMatch[2]))}:${padTime(Number(weeklyMatch[1]))}`,
        weekday: weeklyMatch[3],
        intervalHours: 24,
        expr,
        timezone: schedule.tz?.trim() || getDefaultCronTimezone(),
      };
    }

    return {
      mode: "custom",
      time: "09:00",
      weekday: "1",
      intervalHours: 24,
      expr,
      timezone: schedule.tz?.trim() || getDefaultCronTimezone(),
    };
  }

  return {
    mode: "custom",
    time: formatTimeFromTimestamp(Date.parse(schedule.at)),
    weekday: "1",
    intervalHours: 24,
    expr: "",
    timezone: getDefaultCronTimezone(),
  };
}

export function buildCronScheduleFromDraft(draft: CronScheduleDraft): GatewayCronSchedule {
  if (draft.mode === "custom") {
    const expr = draft.expr.trim();
    if (!expr) {
      throw new Error("请填写 cron 表达式");
    }

    return {
      kind: "cron",
      expr,
      tz: draft.timezone.trim() || getDefaultCronTimezone(),
    };
  }

  if (draft.mode === "intervalHours") {
    const intervalHours = Math.max(1, Math.floor(draft.intervalHours || 1));
    return {
      kind: "every",
      everyMs: intervalHours * 60 * 60 * 1000,
      anchorMs: buildAnchorMs(draft.time),
    };
  }

  const { hour, minute } = resolveTimeParts(draft.time);
  if (draft.mode === "weekly") {
    const weekday = draft.weekday.trim();
    if (!CRON_WEEKDAY_OPTIONS.some((item) => item.value === weekday)) {
      throw new Error("请选择每周执行日");
    }

    return {
      kind: "cron",
      expr: `${minute} ${hour} * * ${weekday}`,
      tz: draft.timezone.trim() || getDefaultCronTimezone(),
    };
  }

  return {
    kind: "cron",
    expr: `${minute} ${hour} * * *`,
    tz: draft.timezone.trim() || getDefaultCronTimezone(),
  };
}
