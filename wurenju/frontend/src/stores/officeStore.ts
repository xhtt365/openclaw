import { create } from "zustand"
import {
  gateway,
  type GatewayAgentEventPayload,
  type GatewayChatEventPayload,
  type GatewayCronEventPayload,
  type GatewayCronJob,
} from "@/services/gateway"
import { useAgentStore, type Agent } from "@/stores/agentStore"
import { useChatStore } from "@/stores/chatStore"
import type { ChatMessage } from "@/utils/messageAdapter"
import { deriveCurrentContextUsed, normalizeUsage } from "@/utils/usage"

export type OfficeZone = "chat" | "work" | "lounge"
export type OfficeActivityType = "thinking" | "executing" | "done" | "error" | "system"
export type OfficeAnimationKind = "idle" | "summon" | "transfer" | "return"
export type OfficeTaskStatus = "RUNNING" | "PAUSED" | "STOPPED"

export type OfficeAgentStatus = {
  action: string
  detail: string
  taskId?: string
}

export type OfficeAgentMetrics = {
  modelName: string | null
  contextWindowSize: number | null
  currentContextUsed: number | null
  lastResponseMs: number | null
  turnCount: number
  lastActiveAt: number | null
}

export type OfficeActivityItem = {
  id: string
  time: number
  agentId: string
  agentName: string
  text: string
  type: OfficeActivityType
}

export type OfficeAnimationQueueItem = {
  agentId: string
  targetZone: OfficeZone
  timestamp: number
  transition: Exclude<OfficeAnimationKind, "idle">
}

export type OfficeAgentMotion = {
  transition: OfficeAnimationKind
  revision: number
  pulseKey: number
}

export type OfficeTaskItem = {
  id: string
  name: string
  status: OfficeTaskStatus
  agentId?: string | null
}

type ChatStoreSnapshot = ReturnType<typeof useChatStore.getState>
type ToolPresentation = {
  detail: string
  activityText: string
  activityType: OfficeActivityType
}

interface OfficeState {
  agentZones: Map<string, OfficeZone>
  agentStatus: Map<string, OfficeAgentStatus>
  agentMetrics: Map<string, OfficeAgentMetrics>
  activityLog: OfficeActivityItem[]
  animationQueue: OfficeAnimationQueueItem[]
  agentAnimations: Map<string, OfficeAgentMotion>
  scheduledTasks: OfficeTaskItem[]
  initialized: boolean

  initialize: () => void
  syncAgents: (agents: Agent[]) => void
  queueMove: (agentId: string, targetZone: OfficeZone) => void
  moveAgent: (
    agentId: string,
    targetZone: OfficeZone,
    transition?: Exclude<OfficeAnimationKind, "idle">
  ) => void
  setAgentStatus: (agentId: string, status: OfficeAgentStatus) => void
  pulseAgent: (agentId: string) => void
  addActivity: (
    agentId: string,
    text: string,
    type: OfficeActivityType,
    agentName?: string
  ) => void
  addSystemActivity: (text: string, type?: OfficeActivityType) => void
  refreshScheduledTasks: () => Promise<void>
  processQueue: () => void
}

const QUEUE_STAGGER_MS = 150
const CHAT_STORE_DEBOUNCE_MS = 180
const RUNTIME_REFRESH_DEBOUNCE_MS = 220
const LONG_REPLY_MS = 8_000
const WORK_ZONE_STAY_MS = 6_000
const TASK_POLL_MS = 10_000
const MAX_ACTIVITY_ITEMS = 100
const ACTIVITY_DEDUPE_WINDOW_MS = 1_200

function createStandbyStatus(): OfficeAgentStatus {
  return {
    action: "standby",
    detail: "STANDBY",
  }
}

function createIdleMotion(): OfficeAgentMotion {
  return {
    transition: "idle",
    revision: 0,
    pulseKey: 0,
  }
}

function createDefaultMetrics(agent?: Agent): OfficeAgentMetrics {
  return {
    modelName: agent?.modelName?.trim() || null,
    contextWindowSize: null,
    currentContextUsed: null,
    lastResponseMs: null,
    turnCount: 0,
    lastActiveAt: null,
  }
}

function parseAgentIdFromSessionKey(sessionKey?: string | null) {
  if (typeof sessionKey !== "string" || !sessionKey.startsWith("agent:")) {
    return null
  }

  const parts = sessionKey.split(":")
  const agentId = parts[1]?.trim()
  return agentId || null
}

function buildSessionKey(agentId: string) {
  const mainKey = useAgentStore.getState().mainKey?.trim()
  if (!mainKey) {
    return null
  }

  return `agent:${agentId}:${mainKey}`
}

function shortenTaskLabel(text: string, fallback: string) {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (!normalized) {
    return fallback
  }

  if (normalized.length <= 14) {
    return normalized
  }

  return `${normalized.slice(0, 14)}…`
}

function buildTaskBadge(taskKey: string) {
  const normalized = taskKey.replace(/[^a-z0-9]/gi, "").toUpperCase()
  const tail = normalized.slice(-4) || "0000"
  return `TASK #${tail}`
}

function isGatewayErrorMessage(message: ChatMessage) {
  const content = message.content.trim()
  if (!content) {
    return false
  }

  return (
    content.startsWith("连接错误：") ||
    content.startsWith("当前模型连接失败") ||
    content.startsWith("当前模型配置里仍有被 Gateway 脱敏的占位符")
  )
}

function resolveCronTaskStatus(job: GatewayCronJob): OfficeTaskStatus {
  if (typeof job.state?.runningAtMs === "number" && Number.isFinite(job.state.runningAtMs)) {
    return "RUNNING"
  }

  if (job.enabled === false) {
    return "PAUSED"
  }

  return "STOPPED"
}

function resolveAgentName(agentId: string) {
  return (
    useAgentStore
      .getState()
      .agents.find((agent) => agent.id === agentId)
      ?.name?.trim() || agentId
  )
}

function extractChatMessageTimestamp(payload: GatewayChatEventPayload) {
  const timestamp = payload.message?.timestamp
  return typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : Date.now()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function getStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }

  return ""
}

function basenameFromPath(pathLike: string) {
  const normalized = pathLike.replace(/\\/g, "/").trim()
  if (!normalized) {
    return ""
  }

  const last = normalized.split("/").pop()?.trim()
  return last || normalized
}

function prettifyToolName(toolName: string) {
  return toolName
    .replace(/^functions[./]/i, "")
    .replace(/^tools[./]/i, "")
    .replace(/^agents\./i, "")
    .replace(/[._/:-]+/g, " ")
    .trim()
}

function resolveToolPresentation(toolName: string, args: unknown): ToolPresentation {
  const normalizedName = toolName.trim().toLowerCase()
  const argsRecord = isRecord(args) ? args : {}
  const fileName = basenameFromPath(
    getStringField(argsRecord, ["path", "filePath", "file_path", "name", "filename"])
  )
  const taskName = getStringField(argsRecord, ["taskName", "name", "label", "jobName", "title"])
  const query = getStringField(argsRecord, ["query", "pattern", "search", "keywords"])

  if (
    normalizedName === "read" ||
    normalizedName === "agents.files.get" ||
    normalizedName.endsWith(".read")
  ) {
    return {
      detail: `📂 读取文件: ${fileName || "未命名文件"}…`,
      activityText: `正在读取文件「${fileName || "未命名文件"}」`,
      activityType: "executing",
    }
  }

  if (
    normalizedName === "write" ||
    normalizedName === "edit" ||
    normalizedName === "agents.files.set" ||
    normalizedName.endsWith(".write") ||
    normalizedName.endsWith(".edit")
  ) {
    return {
      detail: `📝 写入文件: ${fileName || "未命名文件"}…`,
      activityText: `正在写入文件「${fileName || "未命名文件"}」`,
      activityType: "executing",
    }
  }

  if (
    normalizedName.includes("search") ||
    normalizedName.includes("grep") ||
    normalizedName.includes("glob") ||
    normalizedName === "list"
  ) {
    const searchTarget = query || fileName || "目标"
    return {
      detail: `🔍 搜索中: ${shortenTaskLabel(searchTarget, "目标")}…`,
      activityText: `正在搜索「${searchTarget}」`,
      activityType: "executing",
    }
  }

  if (normalizedName === "cron") {
    const resolvedTaskName = taskName || "定时任务"
    return {
      detail: `⏰ 执行定时任务: ${shortenTaskLabel(resolvedTaskName, "定时任务")}…`,
      activityText: `执行定时任务「${resolvedTaskName}」`,
      activityType: "executing",
    }
  }

  if (normalizedName === "browser") {
    return {
      detail: "🌐 浏览页面中…",
      activityText: "正在浏览页面",
      activityType: "executing",
    }
  }

  const prettyName = prettifyToolName(toolName) || "工具"
  return {
    detail: `🔧 执行工具: ${prettyName}…`,
    activityText: `正在执行工具「${prettyName}」`,
    activityType: "executing",
  }
}

function sameStatus(left?: OfficeAgentStatus, right?: OfficeAgentStatus) {
  return (
    left?.action === right?.action &&
    left?.detail === right?.detail &&
    left?.taskId === right?.taskId
  )
}

function sameMetrics(left: OfficeAgentMetrics, right: OfficeAgentMetrics) {
  return (
    left.modelName === right.modelName &&
    left.contextWindowSize === right.contextWindowSize &&
    left.currentContextUsed === right.currentContextUsed &&
    left.lastResponseMs === right.lastResponseMs &&
    left.turnCount === right.turnCount &&
    left.lastActiveAt === right.lastActiveAt
  )
}

export const useOfficeStore = create<OfficeState>((set, get) => {
  let queueTimer: number | null = null
  let taskPollTimer: number | null = null
  let chatDebounceTimer: number | null = null
  let chatUnsubscribe: (() => void) | null = null
  let agentUnsubscribe: (() => void) | null = null
  let gatewayEventUnsubscribe: (() => void) | null = null

  let pendingChatStoreSnapshot:
    | {
        state: ChatStoreSnapshot
        previousState: ChatStoreSnapshot
      }
    | null = null

  const replyStartedAtByAgentId = new Map<string, number>()
  const lastUserPromptByAgentId = new Map<string, string>()
  const workReturnTimerByAgentId = new Map<string, number>()
  const runtimeRefreshTimerByAgentId = new Map<string, number>()
  const taskAgentIdByJobId = new Map<string, string>()
  const activeConversationAgentIds = new Set<string>()
  const runStartedAtByRunId = new Map<string, number>()
  const replyingRunIds = new Set<string>()
  const toolUsedByRunIds = new Set<string>()

  function clearWorkReturnTimer(agentId: string) {
    const timerId = workReturnTimerByAgentId.get(agentId)
    if (timerId !== undefined) {
      window.clearTimeout(timerId)
      workReturnTimerByAgentId.delete(agentId)
    }
  }

  function withAgentMotion(
    map: Map<string, OfficeAgentMotion>,
    agentId: string,
    updater: (current: OfficeAgentMotion) => OfficeAgentMotion
  ) {
    const next = new Map(map)
    next.set(agentId, updater(next.get(agentId) ?? createIdleMotion()))
    return next
  }

  function withAgentMetrics(
    map: Map<string, OfficeAgentMetrics>,
    agentId: string,
    updater: (current: OfficeAgentMetrics) => OfficeAgentMetrics
  ) {
    const next = new Map(map)
    const currentAgent = useAgentStore.getState().agents.find((agent) => agent.id === agentId)
    next.set(agentId, updater(next.get(agentId) ?? createDefaultMetrics(currentAgent)))
    return next
  }

  function updateAgentMetrics(
    agentId: string,
    updater: (current: OfficeAgentMetrics) => OfficeAgentMetrics
  ) {
    set((state) => {
      const currentAgent = useAgentStore.getState().agents.find((agent) => agent.id === agentId)
      const current = state.agentMetrics.get(agentId) ?? createDefaultMetrics(currentAgent)
      const nextMetrics = updater(current)
      if (sameMetrics(current, nextMetrics)) {
        return state
      }

      return {
        agentMetrics: withAgentMetrics(state.agentMetrics, agentId, () => nextMetrics),
      }
    })
  }

  function setAgentStatusIfChanged(agentId: string, status: OfficeAgentStatus) {
    const current = get().agentStatus.get(agentId)
    if (sameStatus(current, status)) {
      return
    }
    get().setAgentStatus(agentId, status)
  }

  function touchAgent(agentId: string, timestamp: number) {
    updateAgentMetrics(agentId, (current) => ({
      ...current,
      lastActiveAt: timestamp,
    }))
  }

  function scheduleAgentRuntimeRefresh(
    agentId: string,
    sessionKey?: string | null,
    delayMs = RUNTIME_REFRESH_DEBOUNCE_MS
  ) {
    const resolvedSessionKey = sessionKey?.trim() || buildSessionKey(agentId)
    if (!resolvedSessionKey) {
      return
    }

    const previousTimer = runtimeRefreshTimerByAgentId.get(agentId)
    if (previousTimer !== undefined) {
      window.clearTimeout(previousTimer)
    }

    const timerId = window.setTimeout(async () => {
      runtimeRefreshTimerByAgentId.delete(agentId)

      try {
        const runtimeState = await gateway.getSessionRuntimeState(resolvedSessionKey, agentId)
        console.log(
          `[Office] runtime synced: agent=${agentId}, used=${runtimeState.currentContextUsed ?? "unknown"}, window=${runtimeState.contextWindowSize}`
        )
        updateAgentMetrics(agentId, (current) => ({
          ...current,
          contextWindowSize:
            runtimeState.contextWindowSize > 0
              ? runtimeState.contextWindowSize
              : current.contextWindowSize,
          currentContextUsed: runtimeState.currentContextUsedFresh
            ? (runtimeState.currentContextUsed ?? 0)
            : current.currentContextUsed,
        }))
      } catch (error) {
        console.error(`[Office] runtime sync failed: agent=${agentId}`, error)
      }
    }, delayMs)

    runtimeRefreshTimerByAgentId.set(agentId, timerId)
  }

  function applyChatUsageSnapshot(agentId: string, payload: GatewayChatEventPayload) {
    const usage = normalizeUsage((payload.message as { usage?: unknown } | undefined)?.usage as
      | Record<string, unknown>
      | undefined)
    if (!usage) {
      return
    }

    const currentContextUsed = deriveCurrentContextUsed(usage) ?? usage.totalTokens
    updateAgentMetrics(agentId, (current) => ({
      ...current,
      currentContextUsed,
    }))
  }

  function startConversation(params: {
    agentId: string
    runId?: string | null
    sessionKey?: string | null
    timestamp: number
    source: "chat-store" | "chat" | "agent"
    prompt?: string
  }) {
    const currentZone = get().agentZones.get(params.agentId) ?? "lounge"
    const nextPrompt = params.prompt?.trim() ?? ""
    const isNewConversation = !activeConversationAgentIds.has(params.agentId)

    if (params.runId) {
      runStartedAtByRunId.set(params.runId, params.timestamp)
    }

    replyStartedAtByAgentId.set(params.agentId, params.timestamp)
    if (nextPrompt) {
      lastUserPromptByAgentId.set(params.agentId, nextPrompt)
    }
    clearWorkReturnTimer(params.agentId)
    touchAgent(params.agentId, params.timestamp)

    if (isNewConversation) {
      activeConversationAgentIds.add(params.agentId)
      updateAgentMetrics(params.agentId, (current) => ({
        ...current,
        turnCount: current.turnCount + 1,
      }))
    }

    if (!isNewConversation) {
      if (params.source === "chat-store") {
        setAgentStatusIfChanged(params.agentId, {
          action: "thinking",
          detail: "🧠 思考中…",
        })

        if (currentZone === "chat") {
          get().pulseAgent(params.agentId)
          get().addActivity(params.agentId, "收到新指令，继续思考", "thinking")
        }

        if (currentZone === "work") {
          get().addActivity(params.agentId, "收到新指令，返回对话区", "thinking")
          get().queueMove(params.agentId, "chat")
        }
      }

      return
    }

    setAgentStatusIfChanged(params.agentId, {
      action: "thinking",
      detail: "🧠 思考中…",
    })

    if (currentZone === "work") {
      get().addActivity(params.agentId, "收到新指令，返回对话区", "thinking")
      get().queueMove(params.agentId, "chat")
      return
    }

    if (currentZone === "chat") {
      get().pulseAgent(params.agentId)
      get().addActivity(params.agentId, "收到新指令，继续思考", "thinking")
      return
    }

    get().addActivity(
      params.agentId,
      params.source === "chat-store" ? "收到新指令，进入对话区" : "收到对话事件，进入对话区",
      "thinking"
    )
    get().queueMove(params.agentId, "chat")
  }

  function finishConversation(params: {
    agentId: string
    runId?: string | null
    sessionKey?: string | null
    timestamp: number
    isError: boolean
  }) {
    const hasTrackedConversation =
      activeConversationAgentIds.has(params.agentId) ||
      replyStartedAtByAgentId.has(params.agentId) ||
      (params.runId ? runStartedAtByRunId.has(params.runId) : false)

    if (!hasTrackedConversation) {
      console.log(
        `[Office] ignore finish: agent=${params.agentId}, run=${params.runId ?? "none"}, reason=no-active-conversation`
      )
      return
    }

    const startedAt =
      (params.runId ? runStartedAtByRunId.get(params.runId) : undefined) ??
      replyStartedAtByAgentId.get(params.agentId) ??
      params.timestamp
    const elapsedMs = Math.max(0, params.timestamp - startedAt)
    const prompt = lastUserPromptByAgentId.get(params.agentId) ?? ""
    const hadToolFlow = params.runId ? toolUsedByRunIds.has(params.runId) : false

    if (params.runId) {
      runStartedAtByRunId.delete(params.runId)
      replyingRunIds.delete(params.runId)
      toolUsedByRunIds.delete(params.runId)
    }

    activeConversationAgentIds.delete(params.agentId)
    replyStartedAtByAgentId.delete(params.agentId)
    lastUserPromptByAgentId.delete(params.agentId)
    clearWorkReturnTimer(params.agentId)
    touchAgent(params.agentId, params.timestamp)

    if (!params.isError) {
      updateAgentMetrics(params.agentId, (current) => ({
        ...current,
        lastResponseMs: elapsedMs,
      }))
    }

    if (params.isError) {
      setAgentStatusIfChanged(params.agentId, {
        action: "error",
        detail: "⚠️ 处理失败",
      })
      get().addActivity(params.agentId, "回复失败，已退出对话区", "error")
      get().queueMove(params.agentId, "lounge")
      return
    }

    if (hadToolFlow) {
      setAgentStatusIfChanged(params.agentId, {
        action: "done",
        detail: "✅ 已完成",
      })
      get().addActivity(params.agentId, "回复完成，返回休闲区", "done")
      get().queueMove(params.agentId, "lounge")
      return
    }

    if (elapsedMs > LONG_REPLY_MS) {
      const taskLabel = shortenTaskLabel(prompt, "后台任务")
      setAgentStatusIfChanged(params.agentId, {
        action: "working",
        detail: `📄 处理「${taskLabel}」…`,
        taskId: buildTaskBadge(`${params.agentId}-${startedAt}`),
      })
      get().addActivity(params.agentId, "回复完成，转入办公区继续处理", "executing")
      get().queueMove(params.agentId, "work")

      const timerId = window.setTimeout(() => {
        console.log(`[Office] work timer done: agent=${params.agentId}`)
        get().addActivity(params.agentId, "后台任务完成，返回休闲区", "done")
        get().queueMove(params.agentId, "lounge")
        workReturnTimerByAgentId.delete(params.agentId)
      }, WORK_ZONE_STAY_MS)
      workReturnTimerByAgentId.set(params.agentId, timerId)
      return
    }

    get().addActivity(params.agentId, "回复完成，返回休闲区", "done")
    get().queueMove(params.agentId, "lounge")
  }

  function handleAssistantReply(agentId: string, message: ChatMessage) {
    const now = typeof message.timestamp === "number" ? message.timestamp : Date.now()
    const isError = isGatewayErrorMessage(message)

    finishConversation({
      agentId,
      timestamp: now,
      isError,
    })
  }

  function handleUserMessage(agentId: string, message: ChatMessage) {
    const timestamp = typeof message.timestamp === "number" ? message.timestamp : Date.now()
    startConversation({
      agentId,
      runId: `local:${message.id}`,
      timestamp,
      source: "chat-store",
      prompt: message.content,
    })
  }

  function handleChatStoreChange(state: ChatStoreSnapshot, previousState: ChatStoreSnapshot) {
    console.log("[Office] chatStore changed", state)
    const agentIds = new Set<string>([
      ...state.messagesByAgentId.keys(),
      ...previousState.messagesByAgentId.keys(),
    ])

    // 只消费本次新增的消息，避免把历史加载误判成实时事件。
    for (const agentId of agentIds) {
      const nextMessages = state.messagesByAgentId.get(agentId) ?? []
      const previousMessages = previousState.messagesByAgentId.get(agentId) ?? []

      if (nextMessages === previousMessages) {
        continue
      }

      const previousIds = new Set(previousMessages.map((message) => message.id))
      const addedMessages = nextMessages.filter((message) => !previousIds.has(message.id))

      for (const message of addedMessages) {
        if (message.isHistorical || message.isLoading) {
          continue
        }

        if (message.role === "user") {
          handleUserMessage(agentId, message)
          continue
        }

        if (message.role === "assistant") {
          handleAssistantReply(agentId, message)
        }
      }
    }
  }

  function handleGatewayToolEvent(agentId: string, payload: GatewayAgentEventPayload, runId: string) {
    const phase = typeof payload.data?.phase === "string" ? payload.data.phase : ""
    const toolName = typeof payload.data?.name === "string" ? payload.data.name.trim() : ""
    if (!toolName) {
      return
    }

    if (phase !== "update") {
      console.log("[Office] tool event:", payload)
    }

    const currentZone = get().agentZones.get(agentId) ?? "lounge"
    const toolPresentation = resolveToolPresentation(toolName, payload.data?.args)
    const toolCallId =
      typeof payload.data?.toolCallId === "string" && payload.data.toolCallId.trim()
        ? payload.data.toolCallId.trim()
        : `${runId}-${toolName}`
    const timestamp = typeof payload.ts === "number" ? payload.ts : Date.now()

    toolUsedByRunIds.add(runId)
    clearWorkReturnTimer(agentId)
    touchAgent(agentId, timestamp)
    scheduleAgentRuntimeRefresh(agentId, payload.sessionKey, 320)

    if (phase === "start") {
      if (currentZone !== "work") {
        get().queueMove(agentId, "work")
      }

      setAgentStatusIfChanged(agentId, {
        action: "tool",
        detail: toolPresentation.detail,
        taskId: buildTaskBadge(toolCallId),
      })
      get().addActivity(agentId, toolPresentation.activityText, toolPresentation.activityType)
      return
    }

    if (phase === "update") {
      setAgentStatusIfChanged(agentId, {
        action: "tool",
        detail: toolPresentation.detail,
        taskId: buildTaskBadge(toolCallId),
      })
      return
    }

    if (phase === "result") {
      const isError = payload.data?.isError === true
      setAgentStatusIfChanged(agentId, {
        action: isError ? "tool-error" : "tool-done",
        detail: isError ? "⚠️ 工具执行失败" : "✅ 已完成",
        taskId: buildTaskBadge(toolCallId),
      })
      get().addActivity(
        agentId,
        isError ? `${prettifyToolName(toolName) || "工具"} 执行失败` : `${prettifyToolName(toolName) || "工具"} 执行完成`,
        isError ? "error" : "done"
      )
    }
  }

  function handleGatewayChatEvent(payload: GatewayChatEventPayload) {
    const agentId = parseAgentIdFromSessionKey(payload.sessionKey)
    if (!agentId) {
      return
    }

    const timestamp = extractChatMessageTimestamp(payload)
    const runId = payload.runId ?? null
    const currentZone = get().agentZones.get(agentId) ?? "lounge"
    const wasReplying = runId ? replyingRunIds.has(runId) : false

    if (payload.state === "delta") {
      if (!wasReplying) {
        console.log("[Office] chat event:", payload)
      }

      startConversation({
        agentId,
        runId,
        sessionKey: payload.sessionKey ?? null,
        timestamp,
        source: "chat",
      })

      applyChatUsageSnapshot(agentId, payload)
      scheduleAgentRuntimeRefresh(agentId, payload.sessionKey, 260)

      if (currentZone === "work") {
        get().addActivity(agentId, "开始回复用户，返回对话区", "executing")
        get().queueMove(agentId, "chat")
      }

      if (runId && !wasReplying) {
        replyingRunIds.add(runId)
        get().addActivity(agentId, "开始输出回复", "executing")
      }

      setAgentStatusIfChanged(agentId, {
        action: "replying",
        detail: "💬 回复中…",
      })
      return
    }

    console.log("[Office] chat event:", payload)
    applyChatUsageSnapshot(agentId, payload)
    scheduleAgentRuntimeRefresh(agentId, payload.sessionKey, 260)

    if (payload.state === "final") {
      finishConversation({
        agentId,
        runId,
        sessionKey: payload.sessionKey ?? null,
        timestamp,
        isError: false,
      })
      return
    }

    if (payload.state === "error") {
      finishConversation({
        agentId,
        runId,
        sessionKey: payload.sessionKey ?? null,
        timestamp,
        isError: true,
      })
    }
  }

  function handleGatewayAgentEvent(payload: GatewayAgentEventPayload) {
    const agentId = parseAgentIdFromSessionKey(payload.sessionKey)
    const runId = typeof payload.runId === "string" ? payload.runId : null
    if (!agentId || !runId) {
      return
    }

    if (payload.stream === "assistant") {
      const currentZone = get().agentZones.get(agentId) ?? "lounge"
      const wasReplying = replyingRunIds.has(runId)

      if (!wasReplying || currentZone === "work") {
        console.log("[Office] agent event:", payload)
      }

      startConversation({
        agentId,
        runId,
        sessionKey: payload.sessionKey ?? null,
        timestamp: typeof payload.ts === "number" ? payload.ts : Date.now(),
        source: "agent",
      })

      if (currentZone === "work") {
        get().addActivity(agentId, "完成工具执行，返回对话区", "executing")
        get().queueMove(agentId, "chat")
      }

      if (!wasReplying) {
        replyingRunIds.add(runId)
        get().addActivity(agentId, "开始输出回复", "executing")
      }

      setAgentStatusIfChanged(agentId, {
        action: "replying",
        detail: "💬 回复中…",
      })
      scheduleAgentRuntimeRefresh(agentId, payload.sessionKey, 260)
      return
    }

    if (payload.stream === "tool") {
      handleGatewayToolEvent(agentId, payload, runId)
      return
    }

    console.log("[Office] agent event:", payload)

    if (payload.stream !== "lifecycle") {
      return
    }

    const phase = typeof payload.data?.phase === "string" ? payload.data.phase : ""
    const timestamp = typeof payload.ts === "number" ? payload.ts : Date.now()

    if (phase === "start") {
      startConversation({
        agentId,
        runId,
        sessionKey: payload.sessionKey ?? null,
        timestamp,
        source: "agent",
      })
      scheduleAgentRuntimeRefresh(agentId, payload.sessionKey, 260)
      return
    }

    if (phase === "error") {
      finishConversation({
        agentId,
        runId,
        sessionKey: payload.sessionKey ?? null,
        timestamp,
        isError: true,
      })
      return
    }

    if (phase === "end") {
      touchAgent(agentId, timestamp)
    }
  }

  function handleGatewayCronEvent(payload: GatewayCronEventPayload) {
    const jobId = typeof payload.jobId === "string" ? payload.jobId.trim() : ""
    if (!jobId) {
      return
    }

    const task = get().scheduledTasks.find((item) => item.id === jobId)
    const agentId =
      task?.agentId?.trim() ||
      taskAgentIdByJobId.get(jobId) ||
      parseAgentIdFromSessionKey(payload.sessionKey) ||
      ""

    if (payload.action === "started") {
      if (agentId) {
        clearWorkReturnTimer(agentId)
        touchAgent(agentId, Date.now())
        setAgentStatusIfChanged(agentId, {
          action: "working",
          detail: `⏰ 执行定时任务: ${shortenTaskLabel(task?.name ?? jobId, "定时任务")}…`,
          taskId: buildTaskBadge(jobId),
        })
        get().addActivity(agentId, `执行定时任务「${task?.name ?? jobId}」`, "executing")
        get().queueMove(agentId, "work")
      } else {
        get().addSystemActivity(`定时任务「${task?.name ?? jobId}」开始执行`, "system")
      }
    }

    if (payload.action === "finished") {
      if (agentId) {
        clearWorkReturnTimer(agentId)
        touchAgent(agentId, Date.now())
        setAgentStatusIfChanged(agentId, {
          action: payload.status === "error" ? "error" : "done",
          detail: payload.status === "error" ? "⚠️ 定时任务失败" : "✅ 已完成",
          taskId: buildTaskBadge(jobId),
        })
        get().addActivity(
          agentId,
          payload.status === "error" ? "定时任务执行失败" : "定时任务执行完成",
          payload.status === "error" ? "error" : "done"
        )
        get().queueMove(agentId, "lounge")
      } else {
        get().addSystemActivity(
          `定时任务「${task?.name ?? jobId}」${payload.status === "error" ? "执行失败" : "执行完成"}`,
          payload.status === "error" ? "error" : "system"
        )
      }
    }

    if (
      payload.action === "added" ||
      payload.action === "updated" ||
      payload.action === "removed" ||
      payload.action === "started" ||
      payload.action === "finished"
    ) {
      void get().refreshScheduledTasks()
    }
  }

  function hydrateLiveReply() {
    const chatState = useChatStore.getState()
    const activeAgentId = chatState.activeReplyAgentId
    if (!activeAgentId) {
      return
    }

    replyStartedAtByAgentId.set(activeAgentId, Date.now())
    touchAgent(activeAgentId, Date.now())
    set((state) => {
      const nextZones = new Map(state.agentZones)
      nextZones.set(activeAgentId, "chat")
      const nextStatus = new Map(state.agentStatus)
      nextStatus.set(activeAgentId, {
        action: "thinking",
        detail: "🧠 思考中…",
      })
      return {
        agentZones: nextZones,
        agentStatus: nextStatus,
      }
    })
  }

  return {
    agentZones: new Map(),
    agentStatus: new Map(),
    agentMetrics: new Map(),
    activityLog: [],
    animationQueue: [],
    agentAnimations: new Map(),
    scheduledTasks: [],
    initialized: false,

    initialize: () => {
      if (get().initialized) {
        get().syncAgents(useAgentStore.getState().agents)
        return
      }

      console.log("[Office] initialize")
      console.log("[Office] initConnection: ensure gateway connected for this tab")
      gateway.connect()
      set({ initialized: true })
      get().syncAgents(useAgentStore.getState().agents)
      hydrateLiveReply()

      chatUnsubscribe?.()
      chatUnsubscribe = useChatStore.subscribe((state, previousState) => {
        pendingChatStoreSnapshot = { state, previousState }
        if (chatDebounceTimer !== null) {
          window.clearTimeout(chatDebounceTimer)
        }
        chatDebounceTimer = window.setTimeout(() => {
          chatDebounceTimer = null
          if (!pendingChatStoreSnapshot) {
            return
          }
          handleChatStoreChange(
            pendingChatStoreSnapshot.state,
            pendingChatStoreSnapshot.previousState
          )
          pendingChatStoreSnapshot = null
        }, CHAT_STORE_DEBOUNCE_MS)
      })

      agentUnsubscribe?.()
      agentUnsubscribe = useAgentStore.subscribe((state, previousState) => {
        if (state.agents !== previousState.agents) {
          get().syncAgents(state.agents)
        }
      })

      gatewayEventUnsubscribe?.()
      gatewayEventUnsubscribe = gateway.addEventHandler((eventName, payload) => {
        if (eventName === "chat") {
          handleGatewayChatEvent(payload as GatewayChatEventPayload)
          return
        }

        if (eventName === "agent") {
          handleGatewayAgentEvent(payload as GatewayAgentEventPayload)
          return
        }

        if (eventName === "cron") {
          console.log("[Office] cron event:", payload)
          handleGatewayCronEvent(payload as GatewayCronEventPayload)
          return
        }

        if (eventName === "presence") {
          console.log("[Office] presence event:", payload)
        }
      })

      void get().refreshScheduledTasks()
      if (taskPollTimer === null) {
        taskPollTimer = window.setInterval(() => {
          void get().refreshScheduledTasks()
        }, TASK_POLL_MS)
      }

      get().addSystemActivity("监控面板已连接", "system")
    },

    syncAgents: (agents) => {
      set((state) => {
        const validIds = new Set(agents.map((agent) => agent.id))
        const nextZones = new Map(state.agentZones)
        const nextStatus = new Map(state.agentStatus)
        const nextAnimations = new Map(state.agentAnimations)
        const nextMetrics = new Map(state.agentMetrics)

        for (const agent of agents) {
          if (!nextZones.has(agent.id)) {
            nextZones.set(agent.id, "lounge")
          }
          if (!nextStatus.has(agent.id)) {
            nextStatus.set(agent.id, createStandbyStatus())
          }
          if (!nextAnimations.has(agent.id)) {
            nextAnimations.set(agent.id, createIdleMotion())
          }
          const currentMetrics = nextMetrics.get(agent.id) ?? createDefaultMetrics(agent)
          nextMetrics.set(agent.id, {
            ...currentMetrics,
            modelName: agent.modelName?.trim() || currentMetrics.modelName,
          })
        }

        for (const agentId of Array.from(nextZones.keys())) {
          if (!validIds.has(agentId)) {
            nextZones.delete(agentId)
            nextStatus.delete(agentId)
            nextAnimations.delete(agentId)
            nextMetrics.delete(agentId)
          }
        }

        return {
          agentZones: nextZones,
          agentStatus: nextStatus,
          agentAnimations: nextAnimations,
          agentMetrics: nextMetrics,
        }
      })
    },

    queueMove: (agentId, targetZone) => {
      const currentZone = get().agentZones.get(agentId) ?? "lounge"
      if (currentZone === targetZone) {
        return
      }

      const pendingDuplicate = get().animationQueue.some(
        (item) => item.agentId === agentId && item.targetZone === targetZone
      )
      if (pendingDuplicate) {
        return
      }

      const transition: Exclude<OfficeAnimationKind, "idle"> =
        targetZone === "lounge" ? "return" : currentZone === "lounge" ? "summon" : "transfer"

      console.log(
        `[Office] queue move: agent=${agentId}, from=${currentZone}, to=${targetZone}, transition=${transition}`
      )

      set((state) => ({
        animationQueue: [
          ...state.animationQueue,
          {
            agentId,
            targetZone,
            timestamp: Date.now(),
            transition,
          },
        ],
      }))

      get().processQueue()
    },

    moveAgent: (agentId, targetZone, transition = "transfer") => {
      set((state) => {
        const nextZones = new Map(state.agentZones)
        nextZones.set(agentId, targetZone)

        const nextStatus = new Map(state.agentStatus)
        if (targetZone === "lounge") {
          nextStatus.set(agentId, createStandbyStatus())
        }

        return {
          agentZones: nextZones,
          agentStatus: nextStatus,
          agentAnimations: withAgentMotion(state.agentAnimations, agentId, (current) => ({
            ...current,
            transition,
            revision: current.revision + 1,
          })),
        }
      })
    },

    setAgentStatus: (agentId, status) => {
      set((state) => {
        const next = new Map(state.agentStatus)
        next.set(agentId, status)
        return {
          agentStatus: next,
        }
      })
    },

    pulseAgent: (agentId) => {
      set((state) => ({
        agentAnimations: withAgentMotion(state.agentAnimations, agentId, (current) => ({
          ...current,
          pulseKey: current.pulseKey + 1,
        })),
      }))
    },

    addActivity: (agentId, text, type, agentName) => {
      const resolvedName = agentName?.trim() || resolveAgentName(agentId)
      set((state) => {
        const latest = state.activityLog[0]
        const now = Date.now()
        if (
          latest &&
          latest.agentId === agentId &&
          latest.text === text &&
          latest.type === type &&
          now - latest.time < ACTIVITY_DEDUPE_WINDOW_MS
        ) {
          return state
        }

        return {
          activityLog: [
            {
              id: crypto.randomUUID(),
              time: now,
              agentId,
              agentName: resolvedName,
              text,
              type,
            },
            ...state.activityLog,
          ].slice(0, MAX_ACTIVITY_ITEMS),
        }
      })
    },

    addSystemActivity: (text, type = "system") => {
      set((state) => ({
        activityLog: [
          {
            id: crypto.randomUUID(),
            time: Date.now(),
            agentId: "system",
            agentName: "System",
            text,
            type,
          },
          ...state.activityLog,
        ].slice(0, MAX_ACTIVITY_ITEMS),
      }))
    },

    refreshScheduledTasks: async () => {
      try {
        const payload = await gateway.listCronJobs()
        const jobs = Array.isArray(payload.jobs) ? payload.jobs : []
        const nextTasks = jobs
          .map<OfficeTaskItem>((job) => ({
            id: job.id,
            name: job.name?.trim() || job.id,
            status: resolveCronTaskStatus(job),
            agentId: typeof job.agentId === "string" ? job.agentId.trim() || null : null,
          }))
          .toSorted((left: OfficeTaskItem, right: OfficeTaskItem) =>
            left.name.localeCompare(right.name, "zh-CN")
          )

        taskAgentIdByJobId.clear()
        for (const task of nextTasks) {
          if (task.agentId) {
            taskAgentIdByJobId.set(task.id, task.agentId)
          }
        }

        set({
          scheduledTasks: nextTasks,
        })
      } catch (error) {
        console.error("[Office] refreshScheduledTasks failed:", error)
      }
    },

    processQueue: () => {
      if (queueTimer !== null) {
        return
      }

      const consume = () => {
        const currentQueue = get().animationQueue
        if (currentQueue.length === 0) {
          queueTimer = null
          return
        }

        const [next, ...rest] = currentQueue
        set({ animationQueue: rest })

        // 队列只负责节奏，真正的区域切换交给 moveAgent 触发 React 重渲染。
        get().moveAgent(next.agentId, next.targetZone, next.transition)
        queueTimer = window.setTimeout(consume, QUEUE_STAGGER_MS)
      }

      queueTimer = window.setTimeout(consume, 0)
    },
  }
})
