import {
  Bell,
  BellOff,
  ClipboardList,
  MoreVertical,
  PencilLine,
  RotateCcw,
  Search,
  Sparkles,
  UsersRound,
  Volume2,
  VolumeX,
} from "lucide-react";
import { memo, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Group } from "@/stores/groupStore";
import { getGroupDisplayMemberCount } from "@/utils/groupMembers";

type GroupChatHeaderProps = {
  group: Group;
  hasAnnouncement: boolean;
  isUrging: boolean;
  isUrgePaused: boolean;
  isSearchOpen: boolean;
  onAnnouncementClick: () => void;
  onUrgeClick: () => void;
  onSearchClick: () => void;
  onToggleNotifications: () => void;
  onToggleSound: () => void;
  onEditGroupClick: () => void;
  onManageMembersClick: () => void;
  onResetConversationClick: () => void;
};

function resolveAvatarText(name: string, emoji?: string) {
  return emoji?.trim() || name.trim().charAt(0).toUpperCase() || "#";
}

function MenuAction({
  icon,
  label,
  detail,
  danger = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  detail?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all duration-200 hover:text-white",
        danger
          ? "text-rose-100 hover:bg-rose-500/12"
          : "text-[var(--color-text-primary)] hover:bg-white/[0.06]",
      )}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {detail ? (
          <span className="mt-0.5 block truncate text-[11px] font-normal text-[var(--color-text-secondary)]">
            {detail}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function GroupChatHeaderInner({
  group,
  hasAnnouncement,
  isUrging,
  isUrgePaused,
  isSearchOpen,
  onAnnouncementClick,
  onUrgeClick,
  onSearchClick,
  onToggleNotifications,
  onToggleSound,
  onEditGroupClick,
  onManageMembersClick,
  onResetConversationClick,
}: GroupChatHeaderProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const visibleMembers = group.members.slice(0, 4);
  const hiddenCount = Math.max(0, group.members.length - visibleMembers.length);
  const totalMembers = getGroupDisplayMemberCount(group);
  const notificationsEnabled = group.notificationsEnabled !== false;
  const soundEnabled = group.soundEnabled !== false;

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

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
            <span className="truncate">{totalMembers} 位成员</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onAnnouncementClick}
          className={cn(
            "relative inline-flex h-10 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.05] px-4 text-sm font-medium text-[var(--color-text-primary)] transition-all duration-200 hover:border-violet-400/35 hover:bg-violet-500/10 hover:text-white",
            hasAnnouncement ? "border-amber-300/20 bg-amber-500/[0.08]" : "",
          )}
        >
          {hasAnnouncement ? (
            <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,0.85)]" />
          ) : null}
          <ClipboardList className="h-4 w-4 text-amber-300" />
          群公告
        </button>
        <button
          type="button"
          onClick={onUrgeClick}
          className={cn(
            "relative inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-all duration-200",
            isUrging
              ? isUrgePaused
                ? "border-amber-300/20 bg-amber-500/[0.08] text-amber-100 hover:border-amber-300/35 hover:bg-amber-500/12"
                : "border-red-300/20 bg-red-500/[0.08] text-red-100 hover:border-red-300/35 hover:bg-red-500/12"
              : "border-white/[0.08] bg-white/[0.05] text-[var(--color-text-primary)] hover:border-violet-400/35 hover:bg-violet-500/10 hover:text-white",
          )}
        >
          {isUrging ? (
            <span
              className={cn(
                "absolute right-2 top-2 h-2.5 w-2.5 rounded-full shadow-[0_0_12px_rgba(248,113,113,0.75)]",
                isUrgePaused ? "bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,0.7)]" : "bg-red-400",
              )}
            />
          ) : null}
          <Sparkles className={cn("h-4 w-4", isUrging ? "text-current" : "text-zinc-300")} />
          {isUrging ? (isUrgePaused ? "⏸ 已暂停" : "🔴 督促中") : "督促模式"}
        </button>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => {
              setIsMenuOpen((current) => !current);
            }}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.05] text-[var(--color-text-secondary)] transition-all duration-200",
              "hover:border-violet-400/35 hover:bg-violet-500/10 hover:text-white",
              isMenuOpen ? "border-violet-400/35 bg-violet-500/10 text-white" : "",
            )}
            aria-label="更多"
            aria-expanded={isMenuOpen}
            aria-haspopup="menu"
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {isMenuOpen ? (
            <div className="absolute right-0 top-[calc(100%+12px)] z-20 min-w-[240px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[rgba(8,8,12,0.94)] p-2 shadow-[0_26px_80px_rgba(0,0,0,0.38)] backdrop-blur-2xl">
              <MenuAction
                icon={<Search className="h-4 w-4 text-amber-200" />}
                label={isSearchOpen ? "🔍 关闭搜索" : "🔍 搜索消息"}
                detail={isSearchOpen ? "收起顶部搜索框并清空高亮" : "展开顶部搜索框检索群聊记录"}
                onClick={() => {
                  setIsMenuOpen(false);
                  onSearchClick();
                }}
              />
              <MenuAction
                icon={
                  notificationsEnabled ? (
                    <Bell className="h-4 w-4 text-emerald-200" />
                  ) : (
                    <BellOff className="h-4 w-4 text-zinc-300" />
                  )
                }
                label={`🔔 消息提醒 ${notificationsEnabled ? "开" : "关"}`}
                detail={notificationsEnabled ? "新消息可通知提醒" : "当前项目组静默"}
                onClick={() => {
                  setIsMenuOpen(false);
                  onToggleNotifications();
                }}
              />
              <MenuAction
                icon={
                  soundEnabled ? (
                    <Volume2 className="h-4 w-4 text-sky-200" />
                  ) : (
                    <VolumeX className="h-4 w-4 text-zinc-300" />
                  )
                }
                label={`🔇 音效 ${soundEnabled ? "开" : "关"}`}
                detail={soundEnabled ? "新消息提醒带提示音" : "保留通知但不播放音效"}
                onClick={() => {
                  setIsMenuOpen(false);
                  onToggleSound();
                }}
              />
              <MenuAction
                icon={<PencilLine className="h-4 w-4 text-violet-200" />}
                label="✏️ 编辑项目组"
                detail="修改群名和描述"
                onClick={() => {
                  setIsMenuOpen(false);
                  onEditGroupClick();
                }}
              />
              <MenuAction
                icon={<UsersRound className="h-4 w-4 text-violet-200" />}
                label="👥 成员管理"
                detail="打开 M14 成员管理弹窗"
                onClick={() => {
                  setIsMenuOpen(false);
                  onManageMembersClick();
                }}
              />
              <MenuAction
                icon={<RotateCcw className="h-4 w-4 text-rose-200" />}
                label="🔄 重置对话"
                detail="清空消息并重置全部成员 session"
                danger
                onClick={() => {
                  setIsMenuOpen(false);
                  onResetConversationClick();
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export const GroupChatHeader = memo(GroupChatHeaderInner);
GroupChatHeader.displayName = "GroupChatHeader";
