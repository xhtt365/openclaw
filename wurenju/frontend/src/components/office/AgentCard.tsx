import { memo } from "react"
import { motion } from "framer-motion"
import type { Agent } from "@/stores/agentStore"
import type {
  OfficeAgentMetrics,
  OfficeAgentMotion,
  OfficeAgentStatus,
  OfficeAnimationKind,
  OfficeZone,
} from "@/stores/officeStore"

type AgentCardProps = {
  agent: Agent
  zone: OfficeZone
  status: OfficeAgentStatus
  motionState?: OfficeAgentMotion
  metrics?: OfficeAgentMetrics
}

const AVATAR_COLORS = [
  "var(--color-avatar-1)",
  "var(--color-avatar-2)",
  "var(--color-avatar-3)",
  "var(--color-avatar-4)",
  "var(--color-avatar-5)",
  "var(--color-avatar-6)",
] as const

function hashText(value: string) {
  return Array.from(value).reduce((total, char) => total + char.charCodeAt(0), 0)
}

function getAvatarColor(agentId: string) {
  return AVATAR_COLORS[hashText(agentId) % AVATAR_COLORS.length]
}

function resolveBorderClass(zone: OfficeZone) {
  if (zone === "chat") {
    return "border-emerald-500"
  }

  if (zone === "work") {
    return "border-amber-500"
  }

  return "border-gray-600"
}

function resolveProgressColor(percent: number) {
  if (percent > 80) {
    return "#ef4444"
  }

  if (percent >= 50) {
    return "#f59e0b"
  }

  return "#10b981"
}

function resolveRole(agent: Agent) {
  return agent.role?.trim() || "Agent"
}

function resolveDisplayText(agent: Agent) {
  return agent.emoji?.trim() || agent.name.charAt(0).toUpperCase() || "A"
}

function resolveMotionTransition(transition: OfficeAnimationKind) {
  if (transition === "summon") {
    return {
      type: "spring" as const,
      stiffness: 400,
      damping: 25,
      mass: 0.8,
      layout: {
        type: "spring" as const,
        stiffness: 300,
        damping: 30,
        mass: 0.9,
      },
    }
  }

  return {
    duration: 0.2,
    layout: {
      type: "spring" as const,
      stiffness: 300,
      damping: 30,
      mass: 0.9,
    },
  }
}

function formatTokenCount(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`
  }

  return `${value}`
}

function formatTokenUsage(currentContextUsed: number, contextWindowSize: number) {
  return `${formatTokenCount(currentContextUsed)} / ${formatTokenCount(contextWindowSize)}`
}

function formatDuration(ms: number) {
  if (ms < 1_000) {
    return `${Math.max(0.1, ms / 1_000).toFixed(1)}s`
  }

  return `${(ms / 1_000).toFixed(1)}s`
}

function formatRelativeTime(timestamp: number) {
  const diffMs = Math.max(0, Date.now() - timestamp)
  const diffMinutes = Math.floor(diffMs / 60_000)
  if (diffMinutes <= 0) {
    return "刚刚活跃"
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`
  }

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) {
    return `${diffHours} 小时前`
  }

  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays} 天前`
}

function normalizeModelName(modelName?: string | null) {
  const trimmed = modelName?.trim()
  if (!trimmed) {
    return null
  }

  const suffix = trimmed.split("/").pop()?.trim()
  return suffix || trimmed
}

function AgentCardInner({ agent, zone, status, motionState, metrics }: AgentCardProps) {
  const pulseKey = motionState?.pulseKey ?? 0
  const transition = motionState?.transition ?? "idle"
  const modelName = normalizeModelName(metrics?.modelName ?? agent.modelName ?? null)

  if (zone === "lounge") {
    const shouldFadeIn = transition === "return"
    const lastActiveText =
      typeof metrics?.lastActiveAt === "number" ? formatRelativeTime(metrics.lastActiveAt) : null

    return (
      <motion.div
        className="pointer-events-none flex w-full max-w-[132px] flex-col items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-4 text-center opacity-[0.55]"
        initial={shouldFadeIn ? { opacity: 0 } : false}
        animate={{ opacity: 0.55 }}
        exit={{ opacity: 0, transition: { duration: 0.3 } }}
        transition={{ duration: 0.4, delay: shouldFadeIn ? 0.2 : 0 }}
      >
        <div className="relative">
          {agent.avatarUrl ? (
            <img
              alt={agent.name}
              className={`h-12 w-12 rounded-full border-2 ${resolveBorderClass(zone)} object-cover`}
              src={agent.avatarUrl}
            />
          ) : (
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-full border-2 ${resolveBorderClass(zone)} text-sm font-semibold text-white`}
              style={{ backgroundColor: getAvatarColor(agent.id) }}
            >
              {resolveDisplayText(agent)}
            </div>
          )}
        </div>
        <div className="w-full">
          <div className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
            {agent.name}
          </div>
          <div className="mt-1 text-[10px] font-semibold tracking-[0.18em] text-gray-500">
            STANDBY
          </div>
          {lastActiveText ? <div className="mt-1 text-[10px] text-gray-500">{lastActiveText}</div> : null}
        </div>
      </motion.div>
    )
  }

  const hasContextMetrics =
    typeof metrics?.contextWindowSize === "number" &&
    metrics.contextWindowSize > 0 &&
    typeof metrics.currentContextUsed === "number"
  const resolvedContextWindowSize = hasContextMetrics ? metrics.contextWindowSize : null
  const resolvedCurrentContextUsed = hasContextMetrics ? metrics.currentContextUsed : null
  const percent =
    hasContextMetrics && resolvedContextWindowSize && resolvedCurrentContextUsed !== null
      ? Math.max(0, Math.min(100, (resolvedCurrentContextUsed / resolvedContextWindowSize) * 100))
      : 0
  const shouldSummon = transition === "summon"

  return (
    <motion.div
      layout
      layoutId={`agent-card-${agent.id}`}
      className="pointer-events-none h-full rounded-2xl border border-white/10 bg-white/[0.05] shadow-[0_18px_48px_rgba(0,0,0,0.22)]"
      initial={shouldSummon ? { scale: 0.3, opacity: 0, y: 20 } : false}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{
        scale: 0.8,
        opacity: 0,
        transition: { duration: 0.3, ease: "easeIn" },
      }}
      transition={resolveMotionTransition(transition)}
    >
      <motion.div
        key={`${agent.id}:${pulseKey}`}
        animate={pulseKey > 0 ? { scale: [1, 1.02, 1] } : { scale: 1 }}
        transition={{ duration: 0.35 }}
        className="flex h-full flex-col p-5"
      >
        <div className="flex items-start gap-4">
          <div className="relative shrink-0">
            {agent.avatarUrl ? (
              <img
                alt={agent.name}
                className={`h-16 w-16 rounded-full border-2 ${resolveBorderClass(zone)} object-cover`}
                src={agent.avatarUrl}
              />
            ) : (
              <div
                className={`flex h-16 w-16 items-center justify-center rounded-full border-2 ${resolveBorderClass(zone)} text-lg font-semibold text-white`}
                style={{ backgroundColor: getAvatarColor(agent.id) }}
              >
                {resolveDisplayText(agent)}
              </div>
            )}
            <span
              className={[
                "absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-[var(--color-bg-card)]",
                zone === "chat" ? "bg-emerald-500" : "bg-amber-500",
              ].join(" ")}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold text-[var(--color-text-primary)]">
                  {agent.name}
                </div>
                <div className="mt-1 truncate text-xs text-gray-400">{resolveRole(agent)}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {modelName ? (
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-gray-400">
                      {modelName}
                    </span>
                  ) : null}
                  {metrics?.turnCount ? (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-gray-400">
                      第 {metrics.turnCount} 轮
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2">
                {status.taskId ? (
                  <span className="rounded-full bg-amber-500/14 px-2 py-1 text-[10px] font-semibold tracking-[0.12em] text-amber-300">
                    {status.taskId}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-5 flex items-start justify-between gap-3 text-sm text-gray-300">
              <div className="min-w-0 flex-1 text-sm text-gray-300">{status.detail}</div>
              {metrics?.lastResponseMs ? (
                <div className="shrink-0 text-[11px] tabular-nums text-gray-500">
                  {formatDuration(metrics.lastResponseMs)}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {hasContextMetrics ? (
          <div className="mt-6 flex items-center gap-3">
            <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/8">
              <div
                className="h-full rounded-full transition-[width,background-color] duration-[600ms]"
                style={{
                  width: `${percent}%`,
                  backgroundColor: resolveProgressColor(percent),
                }}
              />
            </div>
            <div className="shrink-0 text-[11px] tabular-nums text-gray-400">
              {resolvedCurrentContextUsed !== null && resolvedContextWindowSize
                ? formatTokenUsage(resolvedCurrentContextUsed, resolvedContextWindowSize)
                : null}
            </div>
          </div>
        ) : null}
      </motion.div>
    </motion.div>
  )
}

export const AgentCard = memo(AgentCardInner)
AgentCard.displayName = "AgentCard"
