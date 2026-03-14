export interface Agent {
  id: string
  name: string
  emoji: string
  avatarUrl?: string
  role?: string
  description?: string
  modelName?: string
  createdAtMs?: number
}

export interface AgentIdentityDetails {
  name?: string
  emoji?: string
  avatar?: string
  role?: string
  description?: string
}

export interface AgentFile {
  name: string
  size: number
  updatedAtMs: number
  content: string
}

export interface AgentWorkspaceFileEntry {
  name: string
  path: string
  missing: boolean
  size?: number
  updatedAtMs?: number
  content?: string
}

export interface AgentFilesListResult {
  agentId: string
  workspace: string
  files: AgentWorkspaceFileEntry[]
}

export interface AgentFileGetResult {
  agentId: string
  workspace: string
  file: AgentWorkspaceFileEntry
}

export interface AgentFileSetResult {
  ok: true
  agentId: string
  workspace: string
  file: AgentWorkspaceFileEntry
}

export type AgentFilesMap = Map<string, AgentFile[]>
