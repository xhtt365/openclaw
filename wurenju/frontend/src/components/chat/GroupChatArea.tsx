import { memo, type ChangeEvent, useEffect, useMemo, useRef, useState } from "react"
import { Archive, Download, RotateCcw, Send, Zap } from "lucide-react"
import { MessageBubble } from "@/components/chat/MessageBubble"
import { GroupChatHeader } from "@/components/chat/GroupChatHeader"
import { GroupThinkingStatus } from "@/components/chat/GroupThinkingStatus"
import { GroupWelcomeView } from "@/components/chat/GroupWelcomeView"
import { ContextRing } from "@/components/ui/ContextRing"
import { cn } from "@/lib/utils"
import {
  getGroupContextMetrics,
  useGroupStore,
  type Group,
  type GroupChatMessage,
  type ThinkingAgent,
} from "@/stores/groupStore"

const EMPTY_GROUP_MESSAGES: GroupChatMessage[] = []
const EMPTY_THINKING_AGENTS: Map<string, ThinkingAgent> = new Map()

type GroupChatAreaProps = {
  group: Group
}

type ActionFeedback = {
  tone: "success" | "error"
  message: string
}

const compactTokenFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
})

function hashText(value: string) {
  return Array.from(value).reduce((total, char) => total + char.charCodeAt(0), 0)
}

function getAvatarColor(value: string) {
  const colors = [
    "var(--color-avatar-1)",
    "var(--color-avatar-2)",
    "var(--color-avatar-3)",
    "var(--color-avatar-4)",
    "var(--color-avatar-5)",
    "var(--color-avatar-6)",
  ] as const

  return colors[hashText(value) % colors.length]
}

function readStoredAvatar() {
  if (typeof window === "undefined") {
    return null
  }

  const value = window.localStorage.getItem("userAvatar")
  return value && value.trim() ? value : null
}

function resolveAgentName(message: GroupChatMessage, group: Group) {
  if (message.senderName?.trim()) {
    return message.senderName.trim()
  }

  const leader = group.members.find((member) => member.id === group.leaderId)
  return leader?.name ?? group.name
}

function resolveAgentAvatarText(message: GroupChatMessage, group: Group) {
  const senderName = resolveAgentName(message, group)
  return message.senderEmoji?.trim() || senderName.trim().charAt(0).toUpperCase() || "#"
}

function formatTranscript(messages: GroupChatMessage[], group: Group) {
  const lines = [
    `# ${group.name}`,
    "",
    `成员数：${group.members.length}`,
    `导出时间：${new Date().toLocaleString("zh-CN")}`,
    "",
  ]

  messages.forEach((message) => {
    const timestamp =
      typeof message.timestamp === "number"
        ? new Date(message.timestamp).toLocaleString("zh-CN")
        : "未知时间"
    const sender = message.role === "user" ? "你" : resolveAgentName(message, group)
    lines.push(`## ${sender} · ${timestamp}`)
    lines.push("")
    lines.push(message.content)
    lines.push("")
  })

  return lines.join("\n")
}

function formatCompactTokens(value: number) {
  return compactTokenFormatter.format(Math.max(0, Math.floor(value)))
}

function MentionChip({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 items-center rounded-md border border-gray-200/80 bg-white px-2.5 text-[12px] font-medium text-gray-500 transition-all duration-150 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-orange-400/30 dark:hover:bg-orange-500/10 dark:hover:text-orange-200"
    >
      <span>@{label}</span>
    </button>
  )
}

const MemoMentionChip = memo(MentionChip)
MemoMentionChip.displayName = "MentionChip"

function GroupChatAreaInner({ group }: GroupChatAreaProps) {
  const messages = useGroupStore((state) => state.messagesByGroupId[group.id] ?? EMPTY_GROUP_MESSAGES)
  const isSending = useGroupStore((state) =>  state.isSendingByGroupId[group.id])
  const thinkingAgentMap = useGroupStore(
    (state) => state.thinkingAgentsByGroupId.get(group.id) ?? EMPTY_THINKING_AGENTS
  )
  const sendGroupMessage = useGroupStore((state) => state.sendGroupMessage)
  const archiveGroupMessages = useGroupStore((state) => state.archiveGroupMessages)
  const resetGroupMessages = useGroupStore((state) => state.resetGroupMessages)

  const [input, setInput] = useState("")
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null)
  const [userAvatar, setUserAvatar] = useState<string | null>(() => readStoredAvatar())
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const metrics = useMemo(() => getGroupContextMetrics(messages), [messages])
  const thinkingAgents = useMemo(() => Array.from(thinkingAgentMap.values()), [thinkingAgentMap])
  const hasMessages = messages.length > 0
  const contextIndicatorLabel = `${formatCompactTokens(metrics.currentUsed)}/${formatCompactTokens(metrics.total)}`

  function autoResize() {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`
  }

  function insertMention(name: string) {
    const textarea = textareaRef.current
    const mentionText = `@${name} `

    setInput((current) => {
      if (!textarea) {
        return `${current}${mentionText}`
      }

      const selectionStart = textarea.selectionStart ?? current.length
      const selectionEnd = textarea.selectionEnd ?? current.length
      const nextValue =
        current.slice(0, selectionStart) + mentionText + current.slice(selectionEnd)

      window.requestAnimationFrame(() => {
        textarea.focus()
        const caret = selectionStart + mentionText.length
        textarea.setSelectionRange(caret, caret)
        autoResize()
      })

      return nextValue
    })

    console.log(`[Group] 点击成员自动提及: @${name}`)
  }

  function showActionFeedback(tone: ActionFeedback["tone"], message: string) {
    setActionFeedback({ tone, message })
    window.setTimeout(() => {
      setActionFeedback((current) => (current?.message === message ? null : current))
    }, 2400)
  }

  function handleSend() {
    const text = input.trim()
    if (!text || isSending) {
      return
    }

    void sendGroupMessage(group.id, text)
    setInput("")
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
    window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
    })
  }

  async function handleCopyMessage(message: GroupChatMessage) {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopiedMessageId(message.id)
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === message.id ? null : current))
      }, 1000)
    } catch (error) {
      console.error("[Group] 复制群消息失败:", error)
    }
  }

  function handleDownloadMessage(message: GroupChatMessage) {
    const blob = new Blob([message.content], { type: "text/plain;charset=utf-8" })
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${group.name}-${message.id}.txt`
    anchor.click()
    window.URL.revokeObjectURL(url)
    console.log("[Group] 导出单条消息")
  }

  function handleRefreshMessage(message: GroupChatMessage) {
    console.log(`[Group] 刷新消息占位: ${message.id}`)
  }

  function handleAvatarTrigger() {
    avatarInputRef.current?.click()
  }

  function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== "string" || !reader.result.trim()) {
        console.error("[Group] 用户头像读取失败: empty result")
        return
      }

      window.localStorage.setItem("userAvatar", reader.result)
      setUserAvatar(reader.result)
      console.log("[Group] 用户头像已更新")
    }
    reader.onerror = () => {
      console.error("[Group] 用户头像读取失败:", reader.error)
    }
    reader.readAsDataURL(file)
    event.target.value = ""
  }

  function handleExportHistory() {
    if (!hasMessages) {
      return
    }

    const blob = new Blob([formatTranscript(messages, group)], {
      type: "text/markdown;charset=utf-8",
    })
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${group.name}-${new Date().toISOString().slice(0, 10)}.md`
    anchor.click()
    window.URL.revokeObjectURL(url)
    console.log(`[Group] 导出群聊记录: ${group.name}`)
    showActionFeedback("success", "群聊记录已导出")
  }

  function handleArchiveHistory() {
    const archived = archiveGroupMessages(group.id)
    if (!archived) {
      showActionFeedback("error", "当前没有可归档的群聊记录")
      return
    }

    console.log(`[Group] 已归档群聊记录: ${group.name}`)
    showActionFeedback("success", "群聊记录已归档")
  }

  function handleResetHistory() {
    resetGroupMessages(group.id)
    console.log(`[Group] 已重置群聊记录: ${group.name}`)
    showActionFeedback("success", "群聊记录已重置")
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [isSending, messages.length, thinkingAgents.length])

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg-primary)]">
      <GroupChatHeader group={group} />

      <div className="im-scroll min-h-0 flex-1 overflow-y-auto px-6 py-8">
        {hasMessages ? (
          <div className="flex w-full flex-col gap-6">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                agentName={resolveAgentName(message, group)}
                agentAvatarText={resolveAgentAvatarText(message, group)}
                agentAvatarColor={getAvatarColor(message.senderId ?? resolveAgentName(message, group))}
                agentAvatarUrl={message.senderAvatarUrl}
                userAvatar={userAvatar}
                isCopied={copiedMessageId === message.id}
                isTyping={false}
                onTypingComplete={() => {}}
                onUserAvatarClick={handleAvatarTrigger}
                onCopy={handleCopyMessage}
                onDownload={handleDownloadMessage}
                onRefresh={handleRefreshMessage}
              />
            ))}

            <GroupThinkingStatus members={group.members} thinkingAgents={thinkingAgents} />

            <div ref={bottomRef} />
          </div>
        ) : (
          <GroupWelcomeView group={group} onMention={insertMention} />
        )}
      </div>

      <div className="shrink-0 border-t border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        <div className="relative px-4 pb-4 pt-4">
          {actionFeedback ? (
            <div className="pointer-events-none absolute right-4 top-1 z-10">
              <span
                className={cn(
                  "inline-flex rounded-full border px-3 py-1 text-[11px] font-medium shadow-[0_12px_32px_rgba(0,0,0,0.26)] backdrop-blur-sm",
                  actionFeedback.tone === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/15 dark:text-emerald-100"
                    : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/15 dark:text-rose-100"
                )}
              >
                {actionFeedback.message}
              </span>
            </div>
          ) : null}

          {hasMessages ? (
            <div className="flex items-center gap-3 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={handleExportHistory}
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.18)] transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
                  disabled={!hasMessages}
                >
                  <Download className="h-4 w-4 text-white" />
                  导出
                </button>
                <button
                  type="button"
                  onClick={handleArchiveHistory}
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.18)] transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
                  disabled={!hasMessages}
                >
                  <Archive className="h-4 w-4 text-white" />
                  归档
                </button>
                <button
                  type="button"
                  onClick={handleResetHistory}
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.18)] transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
                  disabled={!hasMessages}
                >
                  <RotateCcw className="h-4 w-4 text-white" />
                  重置
                </button>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <ContextRing
                  currentUsed={metrics.currentUsed}
                  total={metrics.total}
                  inputTokens={metrics.inputTokens}
                  outputTokens={metrics.outputTokens}
                  cacheHitTokens={metrics.cacheHitTokens}
                  totalConsumed={metrics.totalConsumed}
                />
                <span className="text-xs font-medium tabular-nums text-gray-600 dark:text-zinc-300">
                  {contextIndicatorLabel}
                </span>
              </div>
            </div>
          ) : null}

          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarChange}
          />

          <div className="rounded-[10px] border border-gray-200 bg-gray-50 px-4 py-2 transition-[border-color,box-shadow] duration-[250ms] focus-within:border-amber-400 focus-within:ring-1 focus-within:ring-amber-300/60 dark:border-zinc-700 dark:bg-zinc-800 dark:focus-within:border-amber-300 dark:focus-within:ring-amber-300/30">
            <div className="flex items-end gap-3">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => {
                  setInput(event.target.value)
                  autoResize()
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    handleSend()
                  }
                }}
                placeholder="输入消息... 使用 @ 提及成员"
                rows={1}
                className="min-h-7 max-h-24 flex-1 resize-none bg-transparent py-1 text-sm leading-6 text-gray-800 outline-none placeholder:text-gray-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />

              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim() || isSending}
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-400 text-white transition-all duration-200 hover:bg-orange-500 dark:bg-orange-500 dark:hover:bg-orange-400",
                  isSending
                    ? "animate-[spin_1s_linear_infinite]"
                    : "hover:scale-110 hover:shadow-[0_0_20px_var(--color-brand-glow)] active:scale-90",
                  input.trim() ? "" : "cursor-not-allowed opacity-50"
                )}
                aria-label="发送群消息"
              >
                {isSending ? <Zap className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-200/80 pt-3 text-[11px] text-gray-400 dark:border-zinc-700 dark:text-zinc-500">
              <span className="font-medium">提及:</span>
              {group.members.map((member) => (
                <MemoMentionChip
                  key={member.id}
                  label={member.name}
                  onClick={() => {
                    insertMention(member.name)
                  }}
                />
              ))}
            </div>
          </div>

          <p className="mt-2 text-center text-[10px] text-gray-500 dark:text-zinc-400">
            按 Enter 发送，Shift + Enter 换行
          </p>
        </div>
      </div>
    </section>
  )
}

export const GroupChatArea = memo(GroupChatAreaInner)
GroupChatArea.displayName = "GroupChatArea"
