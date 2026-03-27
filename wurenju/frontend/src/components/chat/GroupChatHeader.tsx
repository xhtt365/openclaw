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
import { ThemeToggle } from "@/components/chat/components/theme-toggle";
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
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all duration-200",
        danger
          ? "text-[var(--danger)] hover:bg-[var(--danger-subtle)]"
          : "text-[var(--text)] hover:bg-[var(--bg-hover)]",
      )}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--card)]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {detail ? (
          <span className="mt-0.5 block truncate text-[11px] font-normal text-[var(--muted)]">
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
    <header className="group-chat-header">
      <div className="group-chat-header__left">
        <div className="group-chat-header__icon text-[24px] font-semibold">#</div>

        <div className="min-w-0">
          <div className="group-chat-header__title truncate">{group.name}</div>
          <div className="group-chat-header__subtitle mt-1 flex min-w-0 items-center gap-3">
            <div className="flex items-center -space-x-2">
              {visibleMembers.map((member) => (
                <span
                  key={member.id}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)] text-[11px] font-semibold text-[var(--text)] shadow-[var(--shadow-sm)]"
                  title={member.name}
                >
                  {resolveAvatarText(member.name, member.emoji)}
                </span>
              ))}
              {hiddenCount > 0 ? (
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)] text-[10px] font-semibold text-[var(--text)] shadow-[var(--shadow-sm)]">
                  +{hiddenCount}
                </span>
              ) : null}
            </div>
            <span className="truncate">{totalMembers} 位成员</span>
          </div>
        </div>
      </div>

      <div className="group-chat-header__actions">
        <button
          type="button"
          onClick={onAnnouncementClick}
          className={cn(
            "group-chat-pill relative",
            hasAnnouncement ? "group-chat-pill--active" : "",
          )}
        >
          {hasAnnouncement ? (
            <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-[var(--warn)] shadow-[0_0_12px_var(--warn-subtle)]" />
          ) : null}
          <ClipboardList className="h-4 w-4" />
          群公告
        </button>
        <button
          type="button"
          onClick={onUrgeClick}
          className="group-chat-pill relative"
          style={
            isUrging
              ? isUrgePaused
                ? {
                    borderColor: "color-mix(in srgb, var(--warn) 24%, transparent)",
                    background: "var(--warn-subtle)",
                    color: "var(--warn)",
                  }
                : {
                    borderColor: "color-mix(in srgb, var(--danger) 24%, transparent)",
                    background: "var(--danger-subtle)",
                    color: "var(--danger)",
                  }
              : undefined
          }
        >
          {isUrging ? (
            <span
              className={cn(
                "absolute right-2 top-2 h-2.5 w-2.5 rounded-full shadow-[var(--shadow-sm)]",
                isUrgePaused ? "bg-[var(--warn)]" : "bg-[var(--danger)]",
              )}
            />
          ) : null}
          <Sparkles className="h-4 w-4" />
          {isUrging ? (isUrgePaused ? "⏸ 已暂停" : "🔴 督促中") : "督促模式"}
        </button>
        <ThemeToggle />

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => {
              setIsMenuOpen((current) => !current);
            }}
            className={cn("topbar-icon-btn", isMenuOpen ? "topbar-icon-btn--active" : "")}
            aria-label="更多"
            aria-expanded={isMenuOpen}
            aria-haspopup="menu"
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {isMenuOpen ? (
            <div className="group-chat-menu absolute right-0 top-[calc(100%+12px)] z-20 min-w-[240px] overflow-hidden">
              <MenuAction
                icon={<Search className="h-4 w-4" />}
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
                    <Bell className="h-4 w-4" />
                  ) : (
                    <BellOff className="h-4 w-4" />
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
                  soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />
                }
                label={`🔇 音效 ${soundEnabled ? "开" : "关"}`}
                detail={soundEnabled ? "新消息提醒带提示音" : "保留通知但不播放音效"}
                onClick={() => {
                  setIsMenuOpen(false);
                  onToggleSound();
                }}
              />
              <MenuAction
                icon={<PencilLine className="h-4 w-4" />}
                label="✏️ 编辑项目组"
                detail="修改群名和描述"
                onClick={() => {
                  setIsMenuOpen(false);
                  onEditGroupClick();
                }}
              />
              <MenuAction
                icon={<UsersRound className="h-4 w-4" />}
                label="👥 成员管理"
                detail="打开成员管理弹窗"
                onClick={() => {
                  setIsMenuOpen(false);
                  onManageMembersClick();
                }}
              />
              <MenuAction
                icon={<RotateCcw className="h-4 w-4" />}
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
