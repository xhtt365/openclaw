import type {
  GatewayConfigAgentEntry,
  GatewayConfigModelValue,
  GatewayConfigRoot,
} from "@/types/gateway";

export interface AgentModelChain {
  primary: string;
  fallbacks: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeAgentId(value: string) {
  return value.trim().toLowerCase();
}

function normalizeModelRefs(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<string>();
  const refs: string[] = [];

  for (const item of values) {
    if (typeof item !== "string") {
      continue;
    }

    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    refs.push(normalized);
  }

  return refs;
}

export function resolveModelChain(
  value?: GatewayConfigModelValue | null,
  fallbackModelRef?: string | null,
): AgentModelChain {
  if (typeof value === "string" && value.trim()) {
    return {
      primary: value.trim(),
      fallbacks: [],
    };
  }

  if (
    value &&
    typeof value === "object" &&
    typeof value.primary === "string" &&
    value.primary.trim()
  ) {
    return {
      primary: value.primary.trim(),
      fallbacks: normalizeModelRefs(value.fallbacks),
    };
  }

  const fallback = fallbackModelRef?.trim() || "";
  return {
    primary: fallback,
    fallbacks: [],
  };
}

export function readAgentModelChain(
  config: GatewayConfigRoot | null | undefined,
  agentId: string,
  fallbackModelRef?: string | null,
): AgentModelChain {
  const normalizedAgentId = normalizeAgentId(agentId);
  const entries = Array.isArray(config?.agents?.list) ? config.agents?.list : [];
  const entry = entries.find(
    (item) => typeof item?.id === "string" && normalizeAgentId(item.id) === normalizedAgentId,
  );

  return resolveModelChain(entry?.model, fallbackModelRef);
}

function ensureAgentEntry(config: GatewayConfigRoot, agentId: string): GatewayConfigAgentEntry {
  const nextAgents = isRecord(config.agents) ? config.agents : {};
  config.agents = nextAgents;

  const list = Array.isArray(nextAgents.list) ? nextAgents.list : [];
  nextAgents.list = list;

  const normalizedAgentId = normalizeAgentId(agentId);
  const existingEntry = list.find(
    (item) => typeof item?.id === "string" && normalizeAgentId(item.id) === normalizedAgentId,
  );

  if (existingEntry) {
    return existingEntry;
  }

  const nextEntry: GatewayConfigAgentEntry = { id: agentId };
  list.push(nextEntry);
  return nextEntry;
}

export function writeAgentModelChain(
  config: GatewayConfigRoot,
  agentId: string,
  modelRefs: string[],
) {
  const [primary = "", ...fallbacks] = normalizeModelRefs(modelRefs);
  const entry = ensureAgentEntry(config, agentId);

  if (!primary) {
    delete entry.model;
    return config;
  }

  entry.model = {
    primary,
    ...(fallbacks.length > 0 ? { fallbacks } : {}),
  };
  return config;
}
