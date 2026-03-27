export interface GatewayModelChoice {
  id: string
  name: string
  provider: string
  contextWindow?: number
  reasoning?: boolean
  api?: ModelApiProtocol
}

export interface GatewayModelsListResult {
  models: GatewayModelChoice[]
}

export const SUPPORTED_MODEL_APIS = [
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
  "anthropic-messages",
  "google-generative-ai",
  "github-copilot",
  "bedrock-converse-stream",
  "ollama",
] as const

export type ModelApiProtocol = (typeof SUPPORTED_MODEL_APIS)[number]

export interface ModelGroupItem {
  id: string
  name: string
  contextWindow?: number
  reasoning?: boolean
  api?: ModelApiProtocol
}

export interface ModelProviderGroup {
  provider: string
  models: ModelGroupItem[]
}

export interface NewModelConfig {
  provider: string
  baseUrl: string
  api: ModelApiProtocol
  apiKey: string
  authHeader?: boolean
  modelId: string
  modelName?: string
  contextWindow?: number
}
