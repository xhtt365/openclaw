export type SessionRuntimeListPayload = {
  defaults?: {
    contextTokens?: number | null;
  };
  sessions?: Array<{
    key?: string | null;
    contextTokens?: number | null;
    totalTokens?: number | null;
    totalTokensFresh?: boolean | null;
  }>;
};

export type SessionRuntimeState = {
  contextWindowSize: number;
  currentContextUsed: number | null;
  currentContextUsedFresh: boolean;
  sessionFound: boolean;
};

function toNonNegativeInteger(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return Math.max(0, Math.floor(value));
}

function toPositiveInteger(value: unknown) {
  const parsed = toNonNegativeInteger(value);
  if (parsed === undefined || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

export function resolveSessionRuntimeState(
  sessionKey: string,
  payload: SessionRuntimeListPayload,
): SessionRuntimeState {
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const sessionEntry =
    sessions.find(
      (session) => typeof session.key === "string" && session.key.trim() === sessionKey,
    ) ?? null;
  const defaultsContextTokens = toPositiveInteger(payload.defaults?.contextTokens);
  const sessionContextTokens = toPositiveInteger(sessionEntry?.contextTokens);
  const currentContextUsed =
    sessionEntry?.totalTokensFresh === false
      ? null
      : (toNonNegativeInteger(sessionEntry?.totalTokens) ?? null);

  return {
    contextWindowSize: sessionContextTokens ?? defaultsContextTokens ?? 0,
    currentContextUsed,
    currentContextUsedFresh: currentContextUsed !== null,
    sessionFound: sessionEntry !== null,
  };
}
