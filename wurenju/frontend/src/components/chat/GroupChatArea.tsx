import { memo, type ChangeEvent, useEffect, useMemo, useRef, useState } from "react"
import { Archive, Download, RotateCcw, Send } from "lucide-react"
import { MessageBubble } from "@/components/chat/MessageBubble"
import { GroupChatHeader } from "@/components/chat/GroupChatHeader"
import { GroupWelcomeView } from "@/components/chat/GroupWelcomeView"
import { ContextRing } from "@/components/ui/ContextRing"
import { cn } from "@/lib/utils"
import {
  getGroupContextMetrics,
  useGroupStore,
  type Group,
  type GroupChatMessage,
} from "@/stores/groupStore"

const EMPTY_GROUP_MESSAGES: GroupChatMessage[] = []

type GroupChatAreaProps = {
  group: Group
}

type ActionFeedback = {
  tone: "success" | "error"
  message: string
}

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

function MentionChip({
  label,
  avatarText,
  onClick,
}: {
  label: string
  avatarText: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-3 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-[var(--color-text-primary)] shadow-[0_10px_28px_rgba(0,0,0,0.18)] backdrop-blur-xl transition-all duration-200 hover:border-violet-400/35 hover:bg-violet-500/10 hover:text-white"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(255,255,255,0.08)] text-[12px] font-semibold text-[var(--color-text-primary)]">
        {avatarText}
      </span>
      <span>@{label}</span>
    </button>
  )
}

const MemoMentionChip = memo(MentionChip)
MemoMentionChip.displayName = "MentionChip"

function GroupChatAreaInner({ group }: GroupChatAreaProps) {
  const messages = useGroupStore((state) => state.messagesByGroupId[group.id] ?? EMPTY_GROUP_MESSAGES)
  const isSending = useGroupStore((state) => state.isSendingByGroupId[group.id] === true)
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
  const hasMessages = messages.length > 0

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
  }, [isSending, messages.length])

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg-primary)]">
      <GroupChatHeader group={group} />

      <div className="im-scroll min-h-0 flex-1 overflow-y-auto px-6 py-8">
        {hasMessages ? (
          <div className="mx-auto flex w-full max-w-[860px] flex-col gap-6">
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

            {isSending ? (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-full bg-[var(--color-bg-card)] px-3 py-1.5 text-xs text-violet-300">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
                  群成员思考中...
                </div>
              </div>
            ) : null}

            <div ref={bottomRef} />
          </div>
        ) : (
          <GroupWelcomeView group={group} onMention={insertMention} />
        )}
      </div>

      <div className="shrink-0 border-t border-white/[0.08] bg-[rgba(10,10,10,0.82)] px-6 pb-5 pt-4 backdrop-blur-2xl">
        <div className="mx-auto w-full max-w-[860px]">
          {actionFeedback ? (
            <div className="mb-3 flex justify-end">
              <span
                className={cn(
                  "inline-flex rounded-full border px-3 py-1 text-[11px] font-medium",
                  actionFeedback.tone === "success"
                    ? "border-emerald-400/20 bg-emerald-500/12 text-emerald-200"
                    : "border-rose-400/20 bg-rose-500/12 text-rose-200"
                )}
              >
                {actionFeedback.message}
              </span>
            </div>
          ) : null}

          {hasMessages ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportHistory}
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-4 text-sm text-[var(--color-text-secondary)] transition-all duration-200 hover:border-white/[0.14] hover:bg-white/[0.08] hover:text-white"
                >
                  <Download className="h-4 w-4" />
                  导出
                </button>
                <button
                  type="button"
                  onClick={handleArchiveHistory}
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-4 text-sm text-[var(--color-text-secondary)] transition-all duration-200 hover:border-white/[0.14] hover:bg-white/[0.08] hover:text-white"
                >
                  <Archive className="h-4 w-4" />
                  归档
                </button>
                <button
                  type="button"
                  onClick={handleResetHistory}
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-4 text-sm text-[var(--color-text-secondary)] transition-all duration-200 hover:border-white/[0.14] hover:bg-white/[0.08] hover:text-white"
                >
                  <RotateCcw className="h-4 w-4" />
                  重置
                </button>
              </div>

              <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                <ContextRing
                  currentUsed={metrics.currentUsed}
                  total={metrics.total}
                  inputTokens={metrics.inputTokens}
                  outputTokens={metrics.outputTokens}
                  cacheHitTokens={metrics.cacheHitTokens}
                  totalConsumed={metrics.totalConsumed}
                />
                <span>消耗预计 Tokens: {metrics.totalConsumed}</span>
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

          <div className="rounded-[24px] border border-white/[0.08] bg-white/[0.04] px-4 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.18)]">
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
                className="min-h-8 max-h-32 flex-1 resize-none bg-transparent py-1 text-sm leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]"
              />

              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim() || isSending}
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-all duration-200",
                  input.trim() && !isSending
                    ? "bg-[linear-gradient(135deg,#8b5cf6,#3b82f6)] shadow-[0_10px_32px_rgba(139,92,246,0.32)] hover:scale-105"
                    : "cursor-not-allowed bg-white/[0.1] text-white/60"
                )}
                aria-label="发送群消息"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {group.members.map((member) => (
                <MemoMentionChip
                  key={member.id}
                  label={member.name}
                  avatarText={member.emoji?.trim() || member.name.trim().charAt(0).toUpperCase() || "#"}
                  onClick={() => {
                    insertMention(member.name)
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export const GroupChatArea = memo(GroupChatAreaInner)
GroupChatArea.displayName = "GroupChatArea"
