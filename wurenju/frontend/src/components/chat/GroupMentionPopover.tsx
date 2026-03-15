import { memo } from "react";
import { cn } from "@/lib/utils";
import type { AgentInfo } from "@/stores/groupStore";

type GroupMentionPopoverProps = {
  open: boolean;
  members: AgentInfo[];
  activeIndex: number;
  query: string;
  onSelect: (member: AgentInfo) => void;
  onActiveIndexChange: (index: number) => void;
};

const AVATAR_COLORS = [
  "var(--color-avatar-1)",
  "var(--color-avatar-2)",
  "var(--color-avatar-3)",
  "var(--color-avatar-4)",
  "var(--color-avatar-5)",
  "var(--color-avatar-6)",
] as const;

function hashText(value: string) {
  return Array.from(value).reduce((total, char) => total + char.charCodeAt(0), 0);
}

function getAvatarColor(value: string) {
  return AVATAR_COLORS[hashText(value) % AVATAR_COLORS.length];
}

function resolveAvatarText(name: string, emoji?: string) {
  return emoji?.trim() || name.trim().charAt(0).toUpperCase() || "#";
}

function GroupMentionPopoverInner({
  open,
  members,
  activeIndex,
  query,
  onSelect,
  onActiveIndexChange,
}: GroupMentionPopoverProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-3">
      <div className="overflow-hidden rounded-[24px] border border-white/[0.10] bg-[linear-gradient(180deg,rgba(16,16,24,0.94),rgba(8,8,14,0.92))] shadow-[0_28px_90px_rgba(0,0,0,0.46)] backdrop-blur-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <span className="text-[11px] font-medium tracking-[0.12em] text-[var(--color-text-secondary)]">
            {query.trim() ? `筛选 @${query}` : "选择要提及的 Agent"}
          </span>
          <span className="text-[11px] text-[var(--color-text-secondary)]">
            {members.length} 位成员
          </span>
        </div>

        {members.length > 0 ? (
          <div className="im-scroll max-h-[280px] space-y-1 overflow-y-auto p-2">
            {members.map((member, index) => {
              const isActive = index === activeIndex;

              return (
                <button
                  key={member.id}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onMouseEnter={() => {
                    onActiveIndexChange(index);
                  }}
                  onClick={() => {
                    onSelect(member);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[18px] border px-3 py-3 text-left transition-all duration-150",
                    isActive
                      ? "border-violet-400/35 bg-violet-500/14 shadow-[0_0_0_1px_rgba(167,139,250,0.16)]"
                      : "border-transparent bg-white/[0.03] hover:border-white/[0.08] hover:bg-white/[0.05]",
                  )}
                >
                  {member.avatarUrl ? (
                    <img
                      src={member.avatarUrl}
                      alt={member.name}
                      className="h-10 w-10 shrink-0 rounded-full border border-white/[0.08] object-cover"
                    />
                  ) : (
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/[0.08] text-sm font-semibold text-white"
                      style={{ backgroundColor: getAvatarColor(member.id || member.name) }}
                    >
                      {resolveAvatarText(member.name, member.emoji)}
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                      {member.name}
                    </div>
                    <div className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">
                      {member.role?.trim() || "Agent 成员"}
                    </div>
                  </div>

                  <span
                    className={cn(
                      "text-xs font-medium transition-colors",
                      isActive ? "text-violet-100" : "text-[var(--color-text-secondary)]",
                    )}
                  >
                    回车选择
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="px-4 py-6 text-sm text-[var(--color-text-secondary)]">
            没有匹配的 Agent
          </div>
        )}
      </div>
    </div>
  );
}

export const GroupMentionPopover = memo(GroupMentionPopoverInner);
GroupMentionPopover.displayName = "GroupMentionPopover";
