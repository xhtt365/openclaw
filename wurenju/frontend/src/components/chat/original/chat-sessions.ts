import type { SessionsListResult } from "./types.ts";

export type NamedChatAgent = {
  id: string;
  name?: string | null;
};

type SessionRow = NonNullable<SessionsListResult["sessions"]>[number];

export function parseAgentSessionKey(sessionKey: string | null | undefined) {
  if (typeof sessionKey !== "string" || !sessionKey.startsWith("agent:")) {
    return null;
  }

  const parts = sessionKey.split(":");
  if (parts.length < 3) {
    return null;
  }

  const agentId = parts[1]?.trim() || "";
  const rest = parts.slice(2).join(":").trim();
  if (!agentId || !rest) {
    return null;
  }

  return {
    agentId,
    rest,
  };
}

export function resolveSessionAgentId(sessionKey: string | null | undefined) {
  return parseAgentSessionKey(sessionKey)?.agentId ?? null;
}

export function buildAgentNamesById(agents: readonly NamedChatAgent[]) {
  return Object.fromEntries(
    agents.flatMap((agent) => {
      const agentId = agent.id.trim();
      if (!agentId) {
        return [];
      }

      const agentName = agent.name?.trim() || agentId;
      return [[agentId, agentName]];
    }),
  );
}

function sortSessions(left: SessionRow, right: SessionRow) {
  const leftUpdatedAt =
    typeof left.updatedAt === "number" && Number.isFinite(left.updatedAt) ? left.updatedAt : -1;
  const rightUpdatedAt =
    typeof right.updatedAt === "number" && Number.isFinite(right.updatedAt) ? right.updatedAt : -1;

  return rightUpdatedAt - leftUpdatedAt || left.key.localeCompare(right.key);
}

function createSyntheticMainSession(agent: NamedChatAgent, mainKey: string): SessionRow {
  const agentId = agent.id.trim();
  const displayName = agent.name?.trim() || agentId;

  return {
    key: `agent:${agentId}:${mainKey}`,
    label: mainKey,
    displayName,
    updatedAt: null,
  };
}

export function mergeSessionsWithKnownAgents(
  sessions: SessionsListResult | null | undefined,
  agents: readonly NamedChatAgent[],
  mainKey: string | null | undefined,
): SessionsListResult | null {
  const normalizedMainKey = typeof mainKey === "string" ? mainKey.trim() : "";
  const rows = Array.isArray(sessions?.sessions) ? [...sessions.sessions] : [];
  const rowByKey = new Map(rows.map((row) => [row.key, row] as const));

  if (normalizedMainKey) {
    for (const agent of agents) {
      const agentId = agent.id.trim();
      if (!agentId) {
        continue;
      }

      const syntheticRow = createSyntheticMainSession(agent, normalizedMainKey);
      const existingRow = rowByKey.get(syntheticRow.key);
      if (!existingRow) {
        rows.push(syntheticRow);
        rowByKey.set(syntheticRow.key, syntheticRow);
        continue;
      }

      const existingRowIndex = rows.findIndex((row) => row.key === syntheticRow.key);
      if (existingRowIndex === -1) {
        continue;
      }

      rows[existingRowIndex] = {
        ...existingRow,
        displayName: existingRow.displayName?.trim() || syntheticRow.displayName,
        label: existingRow.label?.trim() || syntheticRow.label,
      };
      rowByKey.set(syntheticRow.key, rows[existingRowIndex]);
    }
  }

  rows.sort(sortSessions);

  if (!sessions && rows.length === 0) {
    return null;
  }

  return {
    defaults: sessions?.defaults,
    sessions: rows,
  };
}
