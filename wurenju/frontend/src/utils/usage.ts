export type UsageLike = {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  total?: number
  totalTokens?: number
  inputTokens?: number
  outputTokens?: number
  promptTokens?: number
  completionTokens?: number
  input_tokens?: number
  output_tokens?: number
  prompt_tokens?: number
  completion_tokens?: number
  cache_read?: number
  cache_write?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cached_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: {
    cached_tokens?: number
  }
  cost?: {
    total?: number
  }
}

export type NormalizedUsage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  cost?: {
    total: number
  }
}

function toFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function normalizeUsage(usage?: UsageLike | null): NormalizedUsage | undefined {
  if (!usage || typeof usage !== "object") {
    return undefined
  }

  // 兼容 Gateway/Provider 的多种 token 字段命名，避免上下文用量一直读成 0。
  const rawInput = toFiniteNumber(
    usage.input ??
      usage.inputTokens ??
      usage.input_tokens ??
      usage.promptTokens ??
      usage.prompt_tokens
  )
  const input = rawInput !== undefined && rawInput < 0 ? 0 : rawInput ?? 0
  const output =
    toFiniteNumber(
      usage.output ??
        usage.outputTokens ??
        usage.output_tokens ??
        usage.completionTokens ??
        usage.completion_tokens
    ) ?? 0
  const cacheRead =
    toFiniteNumber(
      usage.cacheRead ??
        usage.cache_read ??
        usage.cache_read_input_tokens ??
        usage.cached_tokens ??
        usage.prompt_tokens_details?.cached_tokens
    ) ?? 0
  const cacheWrite =
    toFiniteNumber(usage.cacheWrite ?? usage.cache_write ?? usage.cache_creation_input_tokens) ?? 0
  const fallbackTotal = toFiniteNumber(usage.total ?? usage.totalTokens)
  const snakeCaseTotal = toFiniteNumber(usage.total_tokens)
  const totalTokens = fallbackTotal ?? snakeCaseTotal ?? input + output + cacheRead + cacheWrite
  const costTotal = toFiniteNumber(usage.cost?.total)

  if (input <= 0 && output <= 0 && cacheRead <= 0 && cacheWrite <= 0 && totalTokens <= 0) {
    return undefined
  }

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens,
    ...(costTotal !== undefined ? { cost: { total: costTotal } } : {}),
  }
}

export function deriveCurrentContextUsed(usage?: Pick<
  NormalizedUsage,
  "input" | "cacheRead" | "cacheWrite" | "totalTokens"
> | null) {
  if (!usage) {
    return undefined
  }

  // 上下文占用优先看本轮实际读入的 prompt 快照；若只有总量也退回使用。
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite
  if (promptTokens > 0) {
    return promptTokens
  }

  if (usage.totalTokens > 0) {
    return usage.totalTokens
  }

  return undefined
}
