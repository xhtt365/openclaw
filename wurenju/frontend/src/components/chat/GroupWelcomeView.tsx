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
      <div className="chat-empty-state__body mx-auto flex w-full max-w-[780px] flex-col items-center text-center">
        <div
          className="flex h-28 w-28 items-center justify-center rounded-[32px] text-[64px] font-semibold text-[var(--accent-foreground)]"
          style={{
            background: "linear-gradient(135deg, var(--accent-2), var(--accent))",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          #
        </div>

        <h2 className="mt-8 text-[34px] font-semibold tracking-tight text-[var(--text-strong)]">
          🎉 欢迎来到 {group.name}
        </h2>
        <p className="mt-3 text-[15px] text-[var(--muted)]">{totalMembers} 位成员已加入</p>

        <div
          className="mt-8 w-full rounded-[24px] border px-6 py-5 text-left"
          style={{
            borderColor: "color-mix(in srgb, var(--accent-2) 16%, transparent)",
            background: "var(--accent-2-subtle)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div className="text-[15px] font-semibold text-[var(--accent-2)]">💬 开始讨论</div>
          <div className="mt-2 text-sm leading-7 text-[var(--muted)]">
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
              className="group-chat-pill px-4 py-2.5 text-sm"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--panel-strong)] text-[12px] font-semibold text-[var(--text)]">
                {resolveAvatarText(member.name, member.emoji)}
              </span>
              <span>@{member.name}</span>
            </button>
          ))}
          {hiddenCount > 0 ? (
            <div className="inline-flex items-center gap-2 rounded-full px-2 py-2 text-sm text-[var(--muted)]">
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
