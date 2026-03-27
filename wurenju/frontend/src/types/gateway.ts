import type { ModelApiProtocol } from "@/types/model";

export type GatewayConfigModelValue =
  | string
  | {
      primary?: string;
      fallbacks?: string[];
    };

export interface GatewayConfigAgentIdentity {
  name?: string;
  emoji?: string;
  avatar?: string;
  avatarUrl?: string;
}

export interface GatewayConfigAgentEntry {
  id?: string;
  name?: string;
  model?: GatewayConfigModelValue;
  workspace?: string;
  agentDir?: string;
  identity?: GatewayConfigAgentIdentity;
}

export type GatewayConfigProviderModelInput = "text" | "image";

export interface GatewayConfigProviderModelCostEntry {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface GatewayConfigProviderModelEntry {
  id?: string;
  name?: string;
  api?: ModelApiProtocol;
  reasoning?: boolean;
  input?: GatewayConfigProviderModelInput[];
  cost?: GatewayConfigProviderModelCostEntry;
  contextWindow?: number;
  maxTokens?: number;
}

export interface GatewayConfigProviderEntry {
  baseUrl?: string;
  api?: ModelApiProtocol;
  apiKey?: unknown;
  authHeader?: boolean;
  headers?: Record<string, unknown>;
  models?: GatewayConfigProviderModelEntry[];
}

export interface GatewayConfigAgentDefaultModelEntry {
  alias?: string;
  params?: Record<string, unknown>;
}

export interface GatewayConfigRoot {
  agents?: {
    defaults?: {
      model?: GatewayConfigModelValue;
      models?: Record<string, GatewayConfigAgentDefaultModelEntry>;
    };
    list?: GatewayConfigAgentEntry[];
  };
  models?: {
    providers?: Record<string, GatewayConfigProviderEntry>;
  };
}

export interface GatewayConfigIssue {
  path?: string;
  message?: string;
}

export interface GatewayConfigLegacyIssue {
  path?: string;
  message?: string;
}

export interface GatewayConfigSnapshot {
  path?: string;
  exists?: boolean;
  valid?: boolean;
  hash?: string;
  raw?: string | null;
  parsed?: unknown;
  resolved?: GatewayConfigRoot;
  config?: GatewayConfigRoot;
  issues?: GatewayConfigIssue[];
  warnings?: GatewayConfigIssue[];
  legacyIssues?: GatewayConfigLegacyIssue[];
}

export interface GatewayConfigRestartInfo {
  scheduled?: boolean;
  coalesced?: boolean;
  delayMs?: number;
  reason?: string;
}

export interface GatewayConfigWriteResult {
  ok?: boolean;
  path?: string;
  config?: GatewayConfigRoot;
  restart?: GatewayConfigRestartInfo;
}

export interface GatewayConfigEditorSnapshot {
  raw: string;
  hash?: string;
  path?: string;
  valid: boolean;
  config?: GatewayConfigRoot;
}
