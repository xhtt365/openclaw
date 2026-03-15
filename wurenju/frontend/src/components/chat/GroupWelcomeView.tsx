import { memo } from "react";
import type { Group } from "@/stores/groupStore";
import { getGroupDisplayMemberCount } from "@/utils/groupMembers";

type GroupWelcomeViewProps = {
  group: Group;
  onMention: (name: string) => void;
};

function resolveAvatarText(name: string, emoji?: string) {
  return emoji?.trim() || name.trim().charAt(0).toUpperCase() || "#";
}

function GroupWelcomeViewInner({ group, onMention }: GroupWelcomeViewProps) {
  const visibleMembers = group.members.slice(0, 4);
  const hiddenCount = Math.max(0, group.members.length - visibleMembers.length);
  const totalMembers = getGroupDisplayMemberCount(group);

  return (
    <div className="flex min-h-full items-center justify-center">
      <div className="mx-auto flex w-full max-w-[780px] flex-col items-center text-center">
        <div className="flex h-28 w-28 items-center justify-center rounded-[32px] bg-[linear-gradient(135deg,#8b5cf6,#3b82f6)] text-[64px] font-semibold text-white shadow-[0_30px_120px_rgba(139,92,246,0.28)]">
          #
        </div>

        <h2 className="mt-8 text-[34px] font-semibold tracking-tight text-[var(--color-text-primary)]">
          🎉 欢迎来到 {group.name}
        </h2>
        <p className="mt-3 text-[15px] text-[var(--color-text-secondary)]">
          {totalMembers} 位成员已加入
        </p>

        <div className="mt-8 w-full rounded-[24px] border border-emerald-400/15 bg-emerald-500/10 px-6 py-5 text-left shadow-[0_18px_60px_rgba(16,185,129,0.08)] backdrop-blur-xl">
          <div className="text-[15px] font-semibold text-emerald-200">💬 开始讨论</div>
          <div className="mt-2 text-sm leading-7 text-emerald-100/80">
            使用 @ 键及 通知相关成员，他们会收到提醒并回复你
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          {visibleMembers.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => {
                onMention(member.name);
              }}
              className="inline-flex items-center gap-3 rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm text-[var(--color-text-primary)] shadow-[0_14px_40px_rgba(0,0,0,0.18)] backdrop-blur-xl transition-all duration-200 hover:border-violet-400/35 hover:bg-violet-500/12 hover:text-white"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(255,255,255,0.08)] text-[12px] font-semibold text-[var(--color-text-primary)]">
                {resolveAvatarText(member.name, member.emoji)}
              </span>
              <span>@{member.name}</span>
            </button>
          ))}
          {hiddenCount > 0 ? (
            <div className="inline-flex items-center gap-2 rounded-full px-2 py-2 text-sm text-[var(--color-text-secondary)]">
              <span>+{hiddenCount}</span>
              <span>更多</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const GroupWelcomeView = memo(GroupWelcomeViewInner);
GroupWelcomeView.displayName = "GroupWelcomeView";
