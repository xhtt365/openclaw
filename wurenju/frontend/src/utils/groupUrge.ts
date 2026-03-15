export const GROUP_URGE_INTERVAL_OPTIONS = [3, 5, 10, 30] as const;

export type GroupUrgeIntervalMinutes = (typeof GROUP_URGE_INTERVAL_OPTIONS)[number];

export type GroupUrgeCandidate = {
  id: string;
  name: string;
};

export function buildUrgeMessage(targetNames: string[]) {
  const normalizedNames = targetNames.map((name) => name.trim()).filter(Boolean);
  if (normalizedNames.length === 0) {
    return "";
  }

  const mentions = normalizedNames.map((name) => `@${name}`).join(" ");
  if (normalizedNames.length === 1) {
    return `${mentions} 请汇报当前进度`;
  }

  return `${mentions} 请分别汇报当前进度`;
}

export function resolveUrgeNextDelayMs(params: {
  intervalMinutes: number;
  lastCheckedAt?: number | null;
  now: number;
}) {
  const intervalMs = Math.max(1, params.intervalMinutes) * 60_000;
  const lastCheckedAt =
    typeof params.lastCheckedAt === "number" && Number.isFinite(params.lastCheckedAt)
      ? params.lastCheckedAt
      : params.now;
  const elapsed = Math.max(0, params.now - lastCheckedAt);
  return Math.max(0, intervalMs - elapsed);
}

export function resolveUrgeTargets(params: {
  members: GroupUrgeCandidate[];
  leaderId: string;
  startedAt?: number | null;
  intervalMinutes: number;
  now: number;
  thinkingAgentIds?: string[];
  lastSpokeAtByAgentId?: Record<string, number | undefined>;
}) {
  const thinkingAgentIds = new Set(
    (params.thinkingAgentIds ?? []).map((agentId) => agentId.trim()).filter(Boolean),
  );
  const fallbackSpokeAt =
    typeof params.startedAt === "number" && Number.isFinite(params.startedAt)
      ? params.startedAt
      : params.now;
  const inactivityMs = Math.max(1, params.intervalMinutes) * 60_000;

  return params.members.filter((member) => {
    if (!member.id.trim() || member.id === params.leaderId) {
      return false;
    }

    if (thinkingAgentIds.has(member.id)) {
      return false;
    }

    const lastSpokeAt = params.lastSpokeAtByAgentId?.[member.id] ?? fallbackSpokeAt;
    return params.now - lastSpokeAt >= inactivityMs;
  });
}
