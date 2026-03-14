import { memo } from "react"
import { ClipboardList, MoreVertical, Sparkles } from "lucide-react"
import type { Group } from "@/stores/groupStore"
import { cn } from "@/lib/utils"

type GroupChatHeaderProps = {
  group: Group
}

function resolveAvatarText(name: string, emoji?: string) {
  return emoji?.trim() || name.trim().charAt(0).toUpperCase() || "#"
}

function GroupChatHeaderInner({ group }: GroupChatHeaderProps) {
  const visibleMembers = group.members.slice(0, 4)
  const hiddenCount = Math.max(0, group.members.length - visibleMembers.length)

  return (
    <header className="flex h-[76px] items-center justify-between border-b border-white/[0.08] bg-[rgba(10,10,10,0.78)] px-6 backdrop-blur-2xl">
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#8b5cf6,#3b82f6)] text-[24px] font-semibold text-white shadow-[0_14px_40px_rgba(139,92,246,0.28)]">
          #
        </div>

        <div className="min-w-0">
          <div className="truncate text-[16px] font-semibold text-[var(--color-text-primary)]">
            {group.name}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-3 text-xs text-[var(--color-text-secondary)]">
            <div className="flex items-center -space-x-2">
              {visibleMembers.map((member) => (
                <span
                  key={member.id}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-[rgba(10,10,10,0.9)] bg-[rgba(255,255,255,0.08)] text-[11px] font-semibold text-[var(--color-text-primary)] shadow-[0_8px_24px_rgba(0,0,0,0.22)]"
                  title={member.name}
                >
                  {resolveAvatarText(member.name, member.emoji)}
                </span>
              ))}
              {hiddenCount > 0 ? (
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[rgba(10,10,10,0.9)] bg-[rgba(255,255,255,0.08)] text-[10px] font-semibold text-[var(--color-text-primary)] shadow-[0_8px_24px_rgba(0,0,0,0.22)]">
                  +{hiddenCount}
                </span>
              ) : null}
            </div>
            <span className="truncate">{group.members.length} 位成员</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            console.log("[Group] 点击群公告按钮")
          }}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.05] px-4 text-sm font-medium text-[var(--color-text-primary)] transition-all duration-200 hover:border-violet-400/35 hover:bg-violet-500/10 hover:text-white"
        >
          <ClipboardList className="h-4 w-4 text-amber-300" />
          群公告
        </button>
        <button
          type="button"
          onClick={() => {
            console.log("[Group] 点击督促模式按钮")
          }}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.05] px-4 text-sm font-medium text-[var(--color-text-primary)] transition-all duration-200 hover:border-violet-400/35 hover:bg-violet-500/10 hover:text-white"
        >
          <Sparkles className="h-4 w-4 text-zinc-300" />
          督促模式
        </button>
        <button
          type="button"
          onClick={() => {
            console.log("[Group] 点击更多按钮")
          }}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.05] text-[var(--color-text-secondary)] transition-all duration-200",
            "hover:border-violet-400/35 hover:bg-violet-500/10 hover:text-white"
          )}
          aria-label="更多"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>
    </header>
  )
}

export const GroupChatHeader = memo(GroupChatHeaderInner)
GroupChatHeader.displayName = "GroupChatHeader"
