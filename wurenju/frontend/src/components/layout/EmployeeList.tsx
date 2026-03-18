"use client";

import {
  Archive,
  ArrowUpRight,
  BriefcaseBusiness,
  ChevronDown,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { CreateEmployeeModal } from "@/components/modals/CreateEmployeeModal";
import { CreateGroupModal } from "@/components/modals/CreateGroupModal";
import { DepartmentManageModal } from "@/components/modals/DepartmentManageModal";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAgentStore, type Agent } from "@/stores/agentStore";
import { useChatStore } from "@/stores/chatStore";
import { useDirectArchiveStore } from "@/stores/directArchiveStore";
import { useGroupStore, type GroupArchive, type GroupChatMessage } from "@/stores/groupStore";
import "@/styles/openclaw-sidebar.css";
import {
  AGENT_AVATAR_STORAGE_KEY,
  getAgentAvatarInfo,
  removeAgentAvatarMapping,
} from "@/utils/agentAvatar";
import { getGroupDisplayMemberCount } from "@/utils/groupMembers";
import { resolveAvatarImage } from "@/utils/groupSurface";
import type { ChatMessage } from "@/utils/messageAdapter";
import {
  purgeSidebarAgentData,
  readSidebarAgentMetaMap,
  readSidebarCollapsedSections,
  readSidebarDepartments,
  readSidebarDirectArchives,
  readSidebarUnreadState,
  readSidebarVisualPreset,
  subscribeSidebarStorage,
  writeSidebarAgentMetaMap,
  writeSidebarCollapsedSections,
  writeSidebarVisualPreset,
  type SidebarAgentMeta,
  type SidebarCollapsedSections,
  type SidebarDepartment,
  type SidebarDirectArchive,
  type SidebarVisualPreset,
} from "@/utils/sidebarPersistence";

type EmployeeStatus = "online" | "thinking" | "offline" | "error" | "idle" | "chatting";
type ConnectionStatus = "connecting" | "connected" | "disconnected";

type SidebarAgentEntry = {
  agent: Agent;
  employee: Employee;
  departmentId?: string;
  departmentName?: string;
  pinned: boolean;
};

type GroupPreview = {
  preview: string;
  timestamp: string;
};

type EmployeeRowProps = {
  departmentId?: string;
  departments: SidebarDepartment[];
  employee: Employee;
  isSelected: boolean;
  pinned: boolean;
  onClearDepartment: () => void;
  onDelete: () => void;
  onMoveToDepartment: (departmentId: string) => void;
  onSelect: () => void;
  onOpenDetail: () => void;
  onTogglePinned: () => void;
  unreadCount: number;
};

type ProjectGroupRowProps = {
  groupId: string;
  name: string;
  avatarUrl?: string;
  memberCount: number;
  preview: GroupPreview;
  selected: boolean;
  unreadCount: number;
  onClick: () => void;
};

type GroupArchiveRowProps = {
  archive: GroupArchive;
  selected: boolean;
  onClick: () => void;
};

type DirectArchiveRowProps = {
  archive: SidebarDirectArchive;
  selected: boolean;
  onClick: () => void;
};

export interface Employee {
  id: string;
  name: string;
  role: string;
  status: EmployeeStatus;
  lastMessage: string;
  timestamp: string;
  avatarColor: string;
  avatarText: string;
  avatarUrl?: string;
  emoji?: string;
}

const SECTION_KEYS = {
  pinned: "section:pinned",
  groups: "section:groups",
  ungrouped: "section:ungrouped",
  groupArchives: "section:group-archives",
  directArchives: "section:direct-archives",
} as const;

const AVATAR_COLORS = [
  "var(--color-avatar-1)",
  "var(--color-avatar-2)",
  "var(--color-avatar-3)",
  "var(--color-avatar-4)",
  "var(--color-avatar-5)",
  "var(--color-avatar-6)",
] as const;

const GROUP_ICON_GRADIENTS = [
  "linear-gradient(135deg, var(--accent-2), var(--info))",
  "linear-gradient(135deg, var(--accent), var(--danger))",
  "linear-gradient(135deg, var(--accent-2), var(--accent))",
  "linear-gradient(135deg, var(--warn), var(--accent))",
  "linear-gradient(135deg, var(--info), var(--accent-2))",
] as const;

function SidebarLobsterMark() {
  return (
    <div className="workspace-sidebar__brand-mark" aria-hidden="true">
      <svg
        className="workspace-sidebar__brand-lobster"
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
      >
        <path
          d="M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z"
          fill="url(#workspace-sidebar-lobster-gradient)"
          className="workspace-sidebar__brand-lobster-body"
        />
        <path
          d="M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z"
          fill="url(#workspace-sidebar-lobster-gradient)"
          className="workspace-sidebar__brand-lobster-claw-left"
        />
        <path
          d="M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z"
          fill="url(#workspace-sidebar-lobster-gradient)"
          className="workspace-sidebar__brand-lobster-claw-right"
        />
        <path
          d="M45 15 Q35 5 30 8"
          stroke="var(--workspace-sidebar-lobster-antenna)"
          strokeWidth="2"
          strokeLinecap="round"
          className="workspace-sidebar__brand-lobster-antenna"
        />
        <path
          d="M75 15 Q85 5 90 8"
          stroke="var(--workspace-sidebar-lobster-antenna)"
          strokeWidth="2"
          strokeLinecap="round"
          className="workspace-sidebar__brand-lobster-antenna"
        />
        <circle cx="45" cy="35" r="6" fill="var(--workspace-sidebar-lobster-eye)" />
        <circle cx="75" cy="35" r="6" fill="var(--workspace-sidebar-lobster-eye)" />
        <circle
          cx="46"
          cy="34"
          r="2"
          fill="var(--workspace-sidebar-lobster-eye-glow)"
          className="workspace-sidebar__brand-lobster-eye-glow"
        />
        <circle
          cx="76"
          cy="34"
          r="2"
          fill="var(--workspace-sidebar-lobster-eye-glow)"
          className="workspace-sidebar__brand-lobster-eye-glow"
        />
        <defs>
          <linearGradient
            id="workspace-sidebar-lobster-gradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" stopColor="var(--workspace-sidebar-lobster-start)" />
            <stop offset="100%" stopColor="var(--workspace-sidebar-lobster-end)" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

function OfficeEntryIcon() {
  return (
    <div className="workspace-sidebar__office-badge" aria-hidden="true">
      <BriefcaseBusiness className="h-5 w-5" />
      <span className="workspace-sidebar__office-badge-spark">
        <Sparkles className="h-3 w-3" />
      </span>
    </div>
  );
}

function hashText(value: string) {
  return Array.from(value).reduce((total, char) => total + char.charCodeAt(0), 0);
}

function getAvatarColor(agentId: string) {
  return AVATAR_COLORS[hashText(agentId) % AVATAR_COLORS.length];
}

function getGroupIconBackground(groupId: string) {
  return GROUP_ICON_GRADIENTS[hashText(groupId) % GROUP_ICON_GRADIENTS.length];
}

function ProjectGroupAvatar({
  groupId,
  name,
  avatarUrl,
}: {
  groupId: string;
  name: string;
  avatarUrl?: string;
}) {
  const resolvedAvatarUrl = resolveAvatarImage(avatarUrl);

  if (resolvedAvatarUrl) {
    return (
      <div className="workspace-sidebar__group-avatar">
        <img alt={name} className="h-full w-full object-cover" src={resolvedAvatarUrl} />
      </div>
    );
  }

  return (
    <div
      className="workspace-sidebar__group-avatar workspace-sidebar__group-avatar--fallback"
      style={{ background: getGroupIconBackground(groupId) }}
      aria-hidden="true"
    >
      <BriefcaseBusiness className="h-4 w-4" />
    </div>
  );
}

function getPreview(messages: ChatMessage[]) {
  const visibleMessages = messages.filter(
    (message) => !message.isLoading && message.content.trim(),
  );
  const latestMessage = visibleMessages[visibleMessages.length - 1];

  if (!latestMessage) {
    return {
      preview: "暂无消息",
      timestamp: "",
    };
  }

  const previewText = latestMessage.content.replace(/\s+/g, " ").trim();
  const preview = latestMessage.role === "user" ? `你：${previewText}` : previewText;

  if (typeof latestMessage.timestamp !== "number" || !Number.isFinite(latestMessage.timestamp)) {
    return {
      preview,
      timestamp: latestMessage.timestampLabel?.trim() || "",
    };
  }

  const messageDate = new Date(latestMessage.timestamp);
  const now = new Date();
  const sameDay = messageDate.toDateString() === now.toDateString();

  return {
    preview,
    timestamp: sameDay
      ? messageDate.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      : `${messageDate.getMonth() + 1}/${messageDate.getDate()}`,
  };
}

function formatSidebarTimestamp(date: Date) {
  if (Number.isNaN(date.getTime())) {
    return "刚刚";
  }

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : `${date.getMonth() + 1}/${date.getDate()}`;
}

function getGroupPreview(messages: GroupChatMessage[], fallbackCreatedAt: string) {
  const visibleMessages = messages.filter(
    (message) => !message.isLoading && message.content.trim(),
  );
  const latestMessage = visibleMessages[visibleMessages.length - 1];

  if (!latestMessage) {
    return {
      preview: "暂无消息",
      timestamp: formatSidebarTimestamp(new Date(fallbackCreatedAt)),
    };
  }

  const previewText = latestMessage.content.replace(/\s+/g, " ").trim();
  const senderLabel =
    latestMessage.role === "user" ? "你" : latestMessage.senderName?.trim() || "成员";
  const timestampSource =
    typeof latestMessage.timestamp === "number" && Number.isFinite(latestMessage.timestamp)
      ? new Date(latestMessage.timestamp)
      : new Date(fallbackCreatedAt);

  return {
    preview: `${senderLabel}：${previewText}`,
    timestamp: formatSidebarTimestamp(timestampSource),
  };
}

function getArchivePreview(archive: GroupArchive) {
  const visibleMessages = archive.messages.filter(
    (message) => !message.isLoading && message.content.trim(),
  );
  const latestMessage = visibleMessages[visibleMessages.length - 1];

  if (!latestMessage) {
    return {
      preview: "已归档，可随时回看",
      timestamp: formatSidebarTimestamp(new Date(archive.createdAt)),
    };
  }

  const previewText = latestMessage.content.replace(/\s+/g, " ").trim();
  const senderLabel =
    latestMessage.role === "user" ? "你" : latestMessage.senderName?.trim() || "成员";
  const timestampSource =
    typeof latestMessage.timestamp === "number" && Number.isFinite(latestMessage.timestamp)
      ? new Date(latestMessage.timestamp)
      : new Date(archive.createdAt);

  return {
    preview: `${senderLabel}：${previewText}`,
    timestamp: formatSidebarTimestamp(timestampSource),
  };
}

function getDirectArchivePreview(archive: SidebarDirectArchive) {
  return {
    preview: archive.preview,
    timestamp: formatSidebarTimestamp(new Date(archive.archivedAt)),
  };
}

function toEmployee(agent: Agent, preview: ReturnType<typeof getPreview>): Employee {
  const avatarText = agent.emoji?.trim() || agent.name.charAt(0).toUpperCase() || "A";

  return {
    id: agent.id,
    name: agent.name,
    role: agent.role?.trim() || "",
    status: "online",
    lastMessage: preview.preview,
    timestamp: preview.timestamp,
    avatarColor: getAvatarColor(agent.id),
    avatarText,
    avatarUrl: agent.avatarUrl,
    emoji: agent.emoji,
  };
}

function buildInitialEmployee(agent: Agent) {
  return toEmployee(agent, {
    preview: "暂无消息",
    timestamp: "",
  });
}

function getConnectionStyle(status: ConnectionStatus) {
  if (status === "connected") {
    return {
      dotColor: "var(--ok)",
      label: "已连接",
    };
  }

  if (status === "connecting") {
    return {
      dotColor: "var(--warn)",
      label: "连接中",
    };
  }

  return {
    dotColor: "var(--danger)",
    label: "连接断开",
  };
}

function getEmployeeStatusDotColor(status: string) {
  if (status === "error") {
    return "var(--danger)";
  }

  if (status === "offline") {
    return "var(--muted)";
  }

  return "var(--ok)";
}

function SidebarSectionHeader({
  label,
  count,
  collapsed,
  onToggle,
}: {
  label: string;
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" onClick={onToggle} className="workspace-sidebar__section-header">
      <ChevronDown
        className={cn(
          "workspace-sidebar__section-chevron shrink-0 transition-transform duration-200",
          collapsed ? "-rotate-90" : "rotate-0",
        )}
      />
      <span className="workspace-sidebar__section-labels">
        <span className="truncate leading-5">{label}</span>
        {typeof count === "number" ? (
          <span className="workspace-sidebar__section-count">{count}</span>
        ) : null}
      </span>
    </button>
  );
}

function SidebarUnreadBadge({ count }: { count: number }) {
  const label = count > 99 ? "99+" : String(count);

  return (
    <span
      className="workspace-sidebar__unread-badge"
      aria-label={`${count} 条未读消息`}
      title={`${count} 条未读消息`}
    >
      {label}
    </span>
  );
}

function EmptyHint({ children }: { children: string }) {
  return <div className="workspace-sidebar__empty">{children}</div>;
}

function EmployeeMenuAction({
  disabled = false,
  danger = false,
  label,
  leading,
  trailing,
  onClick,
}: {
  disabled?: boolean;
  danger?: boolean;
  label: string;
  leading: string;
  onClick?: () => void;
  trailing?: string;
}) {
  if (disabled) {
    return (
      <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--color-text-secondary)] opacity-70">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-base leading-none">
          {leading}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150",
        danger
          ? "text-[var(--danger)] hover:bg-[var(--danger-subtle)]"
          : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]",
      )}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-base leading-none">
        {leading}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing ? (
        <span className="shrink-0 text-sm font-medium text-[var(--color-brand)]">{trailing}</span>
      ) : null}
    </button>
  );
}

function EmployeeRow({
  departmentId,
  departments,
  employee,
  isSelected,
  pinned,
  onClearDepartment,
  onDelete,
  onMoveToDepartment,
  onSelect,
  onOpenDetail,
  onTogglePinned,
  unreadCount,
}: EmployeeRowProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const hasDepartments = departments.length > 0;
  const showUngroupAction = Boolean(departmentId);
  const normalizedRole = employee.role.trim();
  const avatarInfo = getAgentAvatarInfo(
    employee.id,
    employee.avatarUrl ?? employee.emoji ?? employee.avatarText,
    employee.name,
  );

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
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

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  function handleMenuAction(action: () => void) {
    action();
    setIsMenuOpen(false);
  }

  return (
    <div
      className={cn("workspace-sidebar__row-shell", isMenuOpen && "z-40")}
      data-menu-open={isMenuOpen ? "true" : "false"}
    >
      <div
        className={cn(
          "workspace-sidebar__row workspace-sidebar__row--with-menu",
          isSelected ? "workspace-sidebar__row--selected" : "",
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          className="workspace-sidebar__row-main"
          aria-current={isSelected ? "true" : undefined}
        >
          <div className="workspace-sidebar__row-avatar">
            <div className="workspace-sidebar__row-avatar-media">
              {avatarInfo.type === "image" ? (
                <img
                  alt={employee.name}
                  className="h-full w-full rounded-[inherit] object-cover"
                  src={avatarInfo.value}
                />
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center rounded-[inherit] text-[13px] font-semibold text-[var(--color-text-on-brand)]"
                  style={{ backgroundColor: employee.avatarColor }}
                >
                  {avatarInfo.value}
                </div>
              )}
            </div>
            <span
              className="workspace-sidebar__row-avatar-badge"
              style={{ backgroundColor: getEmployeeStatusDotColor(employee.status) }}
            />
          </div>

          <div className="workspace-sidebar__row-body">
            <div className="workspace-sidebar__row-title workspace-sidebar__row-title--employee">
              <div
                className={cn(
                  "workspace-sidebar__row-labels",
                  normalizedRole ? "workspace-sidebar__row-labels--with-role" : "",
                  unreadCount > 0 ? "workspace-sidebar__row-labels--with-unread" : "",
                )}
              >
                <span className="workspace-sidebar__row-name">{employee.name}</span>
                {normalizedRole ? (
                  <span className="workspace-sidebar__row-meta workspace-sidebar__row-meta--inline">
                    {normalizedRole}
                  </span>
                ) : null}
                {unreadCount > 0 ? <SidebarUnreadBadge count={unreadCount} /> : null}
              </div>
            </div>
            <div className="workspace-sidebar__row-preview-line">
              <div className="workspace-sidebar__row-preview workspace-sidebar__row-preview-text">
                {employee.lastMessage || "暂无消息"}
              </div>
            </div>
          </div>
        </button>

        <div className="workspace-sidebar__row-actions">
          <div ref={menuRef} className={cn("workspace-sidebar__row-menu", isMenuOpen && "z-50")}>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setIsMenuOpen((current) => !current);
              }}
              className="workspace-sidebar__row-menu-button"
              data-open={isMenuOpen ? "true" : "false"}
              aria-label={`打开 ${employee.name} 操作菜单`}
              aria-expanded={isMenuOpen}
              aria-haspopup="menu"
            >
              <Settings className="h-4 w-4" />
            </button>

            {isMenuOpen ? (
              <div role="menu" className="workspace-sidebar__row-menu-panel z-30">
                <EmployeeMenuAction
                  leading="✏️"
                  label="编辑资料"
                  onClick={() => {
                    handleMenuAction(onOpenDetail);
                  }}
                />
                <EmployeeMenuAction
                  leading="📌"
                  label={pinned ? "取消置顶" : "置顶"}
                  onClick={() => {
                    handleMenuAction(onTogglePinned);
                  }}
                />

                <div className="my-1 h-px bg-[var(--color-border)]" />
                <div className="workspace-sidebar__row-menu-section-title">移动到分组</div>

                {hasDepartments ? (
                  departments.map((department) => (
                    <EmployeeMenuAction
                      key={department.id}
                      leading={department.icon}
                      label={department.name}
                      trailing={departmentId === department.id ? "✓" : undefined}
                      onClick={() => {
                        handleMenuAction(() => {
                          onMoveToDepartment(department.id);
                        });
                      }}
                    />
                  ))
                ) : (
                  <EmployeeMenuAction disabled leading="🗂️" label="还没有已创建的分组" />
                )}

                {showUngroupAction ? (
                  <EmployeeMenuAction
                    leading="↩️"
                    label="移出分组"
                    onClick={() => {
                      handleMenuAction(onClearDepartment);
                    }}
                  />
                ) : null}

                <div className="my-1 h-px bg-[var(--color-border)]" />
                <EmployeeMenuAction
                  danger
                  leading="🗑️"
                  label="删除"
                  onClick={() => {
                    handleMenuAction(onDelete);
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectGroupRow({
  groupId,
  name,
  avatarUrl,
  memberCount,
  preview,
  selected,
  unreadCount,
  onClick,
}: ProjectGroupRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "workspace-sidebar__row group overflow-hidden text-left",
        selected ? "workspace-sidebar__row--selected" : "",
      )}
    >
      <ProjectGroupAvatar groupId={groupId} name={name} avatarUrl={avatarUrl} />

      <div className="workspace-sidebar__row-body">
        <div className="workspace-sidebar__row-title">
          <div className="workspace-sidebar__row-labels">
            <span className="workspace-sidebar__row-name">{name}</span>
            <span className="workspace-sidebar__row-meta">{memberCount} 人</span>
          </div>
        </div>
        <div className="workspace-sidebar__row-preview-line">
          <div className="workspace-sidebar__row-preview workspace-sidebar__row-preview-text">
            {preview.preview || "暂无消息"}
          </div>
          {unreadCount > 0 ? <SidebarUnreadBadge count={unreadCount} /> : null}
        </div>
      </div>
    </button>
  );
}

function GroupArchiveRow({ archive, selected, onClick }: GroupArchiveRowProps) {
  const preview = getArchivePreview(archive);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "workspace-sidebar__row group overflow-hidden text-left",
        selected ? "workspace-sidebar__row--selected" : "",
      )}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--accent-foreground)]"
        style={{ background: "linear-gradient(135deg, var(--muted-strong), var(--muted))" }}
      >
        <Archive className="h-4 w-4" />
      </div>

      <div className="workspace-sidebar__row-body">
        <div className="workspace-sidebar__row-title">
          <span className="workspace-sidebar__row-name">{archive.groupName}</span>
          <span className="workspace-sidebar__row-meta">{preview.timestamp}</span>
        </div>
        <div className="workspace-sidebar__row-preview">{preview.preview}</div>
      </div>
    </button>
  );
}

function DirectArchiveRow({ archive, selected, onClick }: DirectArchiveRowProps) {
  const preview = getDirectArchivePreview(archive);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "workspace-sidebar__row group overflow-hidden text-left",
        selected ? "workspace-sidebar__row--selected" : "",
      )}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--accent-foreground)]"
        style={{ background: "linear-gradient(135deg, var(--info), var(--accent-2))" }}
      >
        <span className="text-[11px] font-semibold">1v1</span>
      </div>

      <div className="workspace-sidebar__row-body">
        <div className="workspace-sidebar__row-title">
          <span className="workspace-sidebar__row-name">{archive.agentName}</span>
          <span className="workspace-sidebar__row-meta">{preview.timestamp}</span>
        </div>
        <div className="workspace-sidebar__row-preview">{preview.preview}</div>
      </div>
    </button>
  );
}

interface EmployeeListProps {
  selectedEmployeeId: string;
  onSelectEmployee: (employee: Employee) => void;
}

function EmployeeListInner({ selectedEmployeeId, onSelectEmployee }: EmployeeListProps) {
  const [collapsedSections, setCollapsedSections] = useState<SidebarCollapsedSections>(() =>
    readSidebarCollapsedSections(),
  );
  // 部门、置顶和 1v1 归档还没接后端，先从 localStorage 读取 mock 数据。
  const [departments, setDepartments] = useState<SidebarDepartment[]>(() =>
    readSidebarDepartments(),
  );
  const [agentMetaById, setAgentMetaById] = useState(() => readSidebarAgentMetaMap());
  const [directArchives, setDirectArchives] = useState(() => readSidebarDirectArchives());
  const [unreadState, setUnreadState] = useState(() => readSidebarUnreadState());
  const [visualPreset, setVisualPreset] = useState<SidebarVisualPreset>(() =>
    readSidebarVisualPreset(),
  );
  const [isCreateEmployeeOpen, setIsCreateEmployeeOpen] = useState(false);
  const [isDepartmentManageOpen, setIsDepartmentManageOpen] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [pendingDeleteEmployee, setPendingDeleteEmployee] = useState<Employee | null>(null);
  const [isDeletingEmployee, setIsDeletingEmployee] = useState(false);
  const [, setAgentAvatarVersion] = useState(0);
  const agents = useAgentStore((state) => state.agents);
  const currentAgentId = useAgentStore((state) => state.currentAgentId);
  const isLoading = useAgentStore((state) => state.isLoading);
  const fetchAgents = useAgentStore((state) => state.fetchAgents);
  const showDetailFor = useAgentStore((state) => state.showDetailFor);
  const deleteAgent = useAgentStore((state) => state.deleteAgent);
  const openDetail = useAgentStore((state) => state.openDetail);
  const closeDetail = useAgentStore((state) => state.closeDetail);
  const groups = useGroupStore((state) => state.groups);
  const selectedGroupId = useGroupStore((state) => state.selectedGroupId);
  const selectedArchiveId = useGroupStore((state) => state.selectedArchiveId);
  const archives = useGroupStore((state) => state.archives);
  const messagesByGroupId = useGroupStore((state) => state.messagesByGroupId);
  const selectGroup = useGroupStore((state) => state.selectGroup);
  const clearSelectedGroup = useGroupStore((state) => state.clearSelectedGroup);
  const selectArchive = useGroupStore((state) => state.selectArchive);
  const clearSelectedArchive = useGroupStore((state) => state.clearSelectedArchive);
  const switchAgent = useChatStore((state) => state.switchAgent);
  const removeAgentLocalState = useChatStore((state) => state.removeAgentLocalState);
  const status = useChatStore((state) => state.status);
  const messagesByAgentId = useChatStore((state) => state.messagesByAgentId);
  const selectedDirectArchiveId = useDirectArchiveStore((state) => state.selectedDirectArchiveId);
  const selectDirectArchive = useDirectArchiveStore((state) => state.selectDirectArchive);
  const clearSelectedDirectArchive = useDirectArchiveStore(
    (state) => state.clearSelectedDirectArchive,
  );
  const onSelectEmployeeRef = useRef(onSelectEmployee);

  const activeAgentId = currentAgentId || selectedEmployeeId;
  const connection = getConnectionStyle(status);
  const departmentsById = new Map(departments.map((department) => [department.id, department]));
  const directUnreadByAgentId = unreadState.directByAgentId;
  const groupUnreadById = unreadState.groupById;
  const isDirectConversationActive =
    selectedGroupId === null && selectedArchiveId === null && selectedDirectArchiveId === null;

  const agentEntries = agents.map((agent) => {
    const preview = getPreview(messagesByAgentId.get(agent.id) ?? []);
    const employee = toEmployee(agent, preview);
    const meta = agentMetaById[agent.id] ?? {};
    const resolvedDepartment = meta.departmentId
      ? departmentsById.get(meta.departmentId)
      : undefined;

    return {
      agent,
      employee,
      departmentId: resolvedDepartment?.id,
      departmentName: resolvedDepartment?.name,
      pinned: meta.pinned === true,
    } satisfies SidebarAgentEntry;
  });

  const visibleAgentEntries = agentEntries;

  const pinnedEntries = visibleAgentEntries.filter((entry) => entry.pinned);

  const departmentSections: Array<SidebarDepartment & { employees: SidebarAgentEntry[] }> = [];
  for (const department of departments) {
    const employees = visibleAgentEntries.filter((entry) => entry.departmentId === department.id);

    if (employees.length === 0) {
      continue;
    }

    departmentSections.push({
      ...department,
      employees,
    });
  }

  const ungroupedEntries = visibleAgentEntries.filter((entry) => !entry.departmentId);

  const visibleGroups = groups;
  const visibleGroupArchives = archives.toSorted(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
  const visibleDirectArchives = directArchives;

  const shouldShowPinnedSection = pinnedEntries.length > 0;
  const shouldShowGroupsSection = visibleGroups.length > 0;
  const shouldShowGroupArchivesSection = visibleGroupArchives.length > 0;
  const shouldShowDirectArchivesSection = visibleDirectArchives.length > 0;

  const hasVisibleContent =
    pinnedEntries.length > 0 ||
    visibleGroups.length > 0 ||
    departmentSections.length > 0 ||
    ungroupedEntries.length > 0 ||
    visibleGroupArchives.length > 0 ||
    visibleDirectArchives.length > 0;

  useEffect(() => {
    onSelectEmployeeRef.current = onSelectEmployee;
  }, [onSelectEmployee]);

  useEffect(() => {
    writeSidebarCollapsedSections(collapsedSections);
  }, [collapsedSections]);

  useEffect(() => {
    writeSidebarVisualPreset(visualPreset);
  }, [visualPreset]);

  useEffect(() => {
    return subscribeSidebarStorage(() => {
      setDepartments(readSidebarDepartments());
      setAgentMetaById(readSidebarAgentMetaMap());
      setDirectArchives(readSidebarDirectArchives());
      setUnreadState(readSidebarUnreadState());
      setVisualPreset(readSidebarVisualPreset());
    });
  }, []);

  useEffect(() => {
    function handleAvatarRefresh(event?: Event) {
      if (event instanceof StorageEvent && event.key && event.key !== AGENT_AVATAR_STORAGE_KEY) {
        return;
      }

      setAgentAvatarVersion((current) => current + 1);
    }

    window.addEventListener("xiaban-agent-avatar-updated", handleAvatarRefresh);
    window.addEventListener("storage", handleAvatarRefresh);
    return () => {
      window.removeEventListener("xiaban-agent-avatar-updated", handleAvatarRefresh);
      window.removeEventListener("storage", handleAvatarRefresh);
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    const initAgents = async () => {
      try {
        if (useAgentStore.getState().agents.length === 0) {
          await fetchAgents();
        }
        if (!isActive) {
          return;
        }

        const store = useAgentStore.getState();
        const initialAgent =
          store.agents.find((agent) => agent.id === store.currentAgentId) ?? store.agents[0];
        if (!initialAgent) {
          return;
        }

        onSelectEmployeeRef.current(buildInitialEmployee(initialAgent));

        const chatStore = useChatStore.getState();
        const alreadySelected = store.currentAgentId === initialAgent.id;
        const historyResolved = chatStore.hasHistoryLoadedForAgent(initialAgent.id);
        const historyLoading = chatStore.isHistoryLoadingForAgent(initialAgent.id);
        if (alreadySelected && (historyResolved || historyLoading)) {
          return;
        }

        await switchAgent(initialAgent.id);
      } catch (error) {
        if (!isActive) {
          return;
        }

        console.error("[UI] 初始化员工列表失败:", error);
      }
    };

    void initAgents();

    return () => {
      isActive = false;
    };
  }, [fetchAgents, switchAgent]);

  async function handleSelectAgent(agent: Agent) {
    clearSelectedGroup();
    clearSelectedArchive();
    clearSelectedDirectArchive();
    closeDetail();
    onSelectEmployee(buildInitialEmployee(agent));
    await switchAgent(agent.id);
  }

  async function handleCreatedAgent(agentId: string) {
    const nextAgent = useAgentStore.getState().agents.find((agent) => agent.id === agentId);
    if (!nextAgent) {
      return;
    }

    clearSelectedGroup();
    clearSelectedArchive();
    clearSelectedDirectArchive();
    closeDetail();
    onSelectEmployee(buildInitialEmployee(nextAgent));
    await switchAgent(nextAgent.id);
  }

  function handleOpenDetail(agentId: string) {
    clearSelectedGroup();
    clearSelectedArchive();
    clearSelectedDirectArchive();
    void openDetail(agentId);
  }

  function handleOpenOfficePage() {
    if (typeof window === "undefined") {
      return;
    }

    const targetUrl = new URL("/office", window.location.href).toString();
    window.open(targetUrl, "_blank", "noopener,noreferrer");
  }

  async function handleConfirmDeleteEmployee() {
    if (!pendingDeleteEmployee || isDeletingEmployee) {
      return;
    }

    const targetEmployee = pendingDeleteEmployee;
    const currentDirectArchive =
      selectedDirectArchiveId !== null
        ? (directArchives.find((archive) => archive.id === selectedDirectArchiveId) ?? null)
        : null;
    const shouldFallbackToNextEmployee =
      (isDirectConversationActive && activeAgentId === targetEmployee.id) ||
      showDetailFor === targetEmployee.id ||
      currentDirectArchive?.agentId === targetEmployee.id;

    setIsDeletingEmployee(true);

    try {
      const { nextAgentId } = await deleteAgent(targetEmployee.id, true);

      if (currentDirectArchive?.agentId === targetEmployee.id) {
        clearSelectedDirectArchive();
      }

      useGroupStore.getState().removeAgentData(targetEmployee.id);
      removeAgentLocalState(targetEmployee.id);
      purgeSidebarAgentData(targetEmployee.id);
      removeAgentAvatarMapping(targetEmployee.id);

      if (shouldFallbackToNextEmployee && nextAgentId) {
        const nextAgent = useAgentStore.getState().agents.find((agent) => agent.id === nextAgentId);
        if (nextAgent) {
          await handleSelectAgent(nextAgent);
        }
      }

      toast({
        title: "员工已删除",
        description: `${targetEmployee.name} 以及对应空间数据已清理`,
      });
      setPendingDeleteEmployee(null);
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim() ? error.message : "删除员工失败，请稍后重试";
      toast({
        title: "删除失败",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsDeletingEmployee(false);
    }
  }

  function handleSelectGroup(groupId: string) {
    clearSelectedDirectArchive();
    closeDetail();
    selectGroup(groupId);
  }

  function handleSelectArchive(archiveId: string) {
    clearSelectedDirectArchive();
    closeDetail();
    selectArchive(archiveId);
  }

  function handleSelectDirectArchive(archiveId: string) {
    clearSelectedGroup();
    clearSelectedArchive();
    closeDetail();
    selectDirectArchive(archiveId);
  }

  function toggleSection(key: string) {
    setCollapsedSections((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function updateAgentMeta(
    agentId: string,
    updater: (current: SidebarAgentMeta) => SidebarAgentMeta,
  ) {
    const nextMeta = updater(agentMetaById[agentId] ?? {});
    const nextValue = writeSidebarAgentMetaMap({
      ...agentMetaById,
      [agentId]: nextMeta,
    });

    setAgentMetaById(nextValue);
  }

  function handleTogglePinned(agentId: string) {
    updateAgentMeta(agentId, (current) => ({
      ...current,
      pinned: current.pinned !== true,
    }));
  }

  function handleMoveToDepartment(agentId: string, departmentId?: string) {
    updateAgentMeta(agentId, (current) => ({
      ...current,
      departmentId,
    }));
  }

  return (
    <>
      <aside className={cn("workspace-sidebar", `workspace-sidebar--preset-${visualPreset}`)}>
        <div className="workspace-sidebar__hero">
          <div className="workspace-sidebar__brand">
            {/* 侧栏头部沿用官网龙虾骨架，但把动效收轻到更适合工作台。 */}
            <SidebarLobsterMark />
            <div
              className="workspace-sidebar__brand-slogan"
              aria-label="上虾班，当董事长。你的 AI 团队，永不下班。"
            >
              <div className="workspace-sidebar__brand-slogan-line">
                上<span className="workspace-sidebar__brand-slogan-brand">虾班</span>
                ，当董事长
              </div>
              <div className="workspace-sidebar__brand-slogan-line">你的 AI 团队，永不下班</div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleOpenOfficePage}
            className="workspace-sidebar__office"
          >
            <div className="workspace-sidebar__office-main">
              <OfficeEntryIcon />
              <div className="workspace-sidebar__office-copy min-w-0">
                <div className="workspace-sidebar__office-title">虾班办公室</div>
                <div className="workspace-sidebar__office-subtitle">欢迎董事长视察工作</div>
              </div>
            </div>
            <ArrowUpRight className="workspace-sidebar__office-arrow h-4 w-4" />
          </button>
        </div>

        <div className="workspace-sidebar__toolbar">
          <button
            type="button"
            onClick={() => setIsCreateEmployeeOpen(true)}
            className="workspace-sidebar__toolbar-primary"
          >
            <Plus className="h-4 w-4" />
            新增员工
          </button>

          <div className="workspace-sidebar__toolbar-grid">
            <button
              type="button"
              onClick={() => {
                setIsDepartmentManageOpen(true);
              }}
              className="workspace-sidebar__toolbar-secondary whitespace-nowrap"
            >
              部门管理
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCreateGroupOpen(true);
              }}
              className="workspace-sidebar__toolbar-secondary whitespace-nowrap"
            >
              新建项目组
            </button>
          </div>
        </div>

        <div className="im-scroll workspace-sidebar__body">
          {isLoading && agents.length === 0 ? <EmptyHint>正在加载员工列表...</EmptyHint> : null}
          {!isLoading && !hasVisibleContent ? (
            <EmptyHint>还没有可显示的成员或分组</EmptyHint>
          ) : null}

          <div className="workspace-sidebar__sections">
            {shouldShowPinnedSection ? (
              <section className="workspace-sidebar__section">
                <SidebarSectionHeader
                  label="置顶"
                  count={pinnedEntries.length}
                  collapsed={collapsedSections[SECTION_KEYS.pinned]}
                  onToggle={() => toggleSection(SECTION_KEYS.pinned)}
                />

                {!collapsedSections[SECTION_KEYS.pinned] ? (
                  <div className="workspace-sidebar__section-items">
                    {pinnedEntries.map(({ agent, employee, pinned, departmentId }) => (
                      <EmployeeRow
                        key={`pinned:${employee.id}`}
                        departmentId={departmentId}
                        departments={departments}
                        employee={employee}
                        isSelected={isDirectConversationActive && employee.id === activeAgentId}
                        pinned={pinned}
                        unreadCount={directUnreadByAgentId[employee.id] ?? 0}
                        onClearDepartment={() => {
                          handleMoveToDepartment(employee.id, undefined);
                        }}
                        onDelete={() => {
                          setPendingDeleteEmployee(employee);
                        }}
                        onMoveToDepartment={(nextDepartmentId) => {
                          handleMoveToDepartment(employee.id, nextDepartmentId);
                        }}
                        onSelect={() => {
                          void handleSelectAgent(agent);
                        }}
                        onOpenDetail={() => {
                          handleOpenDetail(employee.id);
                        }}
                        onTogglePinned={() => {
                          handleTogglePinned(employee.id);
                        }}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {shouldShowGroupsSection ? (
              <section className="workspace-sidebar__section">
                <SidebarSectionHeader
                  label="项目组"
                  count={visibleGroups.length}
                  collapsed={collapsedSections[SECTION_KEYS.groups]}
                  onToggle={() => toggleSection(SECTION_KEYS.groups)}
                />

                {!collapsedSections[SECTION_KEYS.groups] ? (
                  <div className="workspace-sidebar__section-items">
                    {visibleGroups.map((group) => (
                      <ProjectGroupRow
                        key={group.id}
                        groupId={group.id}
                        name={group.name}
                        avatarUrl={group.avatarUrl}
                        memberCount={getGroupDisplayMemberCount(group)}
                        preview={getGroupPreview(
                          messagesByGroupId[group.id] ?? [],
                          group.createdAt,
                        )}
                        selected={selectedGroupId === group.id}
                        unreadCount={groupUnreadById[group.id] ?? 0}
                        onClick={() => handleSelectGroup(group.id)}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {departmentSections.map((department) => {
              const collapseKey = `department:${department.id}`;

              return (
                <section key={department.id} className="workspace-sidebar__section">
                  <SidebarSectionHeader
                    label={department.name}
                    count={department.employees.length}
                    collapsed={collapsedSections[collapseKey]}
                    onToggle={() => toggleSection(collapseKey)}
                  />

                  {!collapsedSections[collapseKey] ? (
                    <div className="workspace-sidebar__section-items">
                      {department.employees.map(({ agent, employee, pinned, departmentId }) => (
                        <EmployeeRow
                          key={`${department.id}:${employee.id}`}
                          departmentId={departmentId}
                          departments={departments}
                          employee={employee}
                          isSelected={isDirectConversationActive && employee.id === activeAgentId}
                          pinned={pinned}
                          unreadCount={directUnreadByAgentId[employee.id] ?? 0}
                          onClearDepartment={() => {
                            handleMoveToDepartment(employee.id, undefined);
                          }}
                          onDelete={() => {
                            setPendingDeleteEmployee(employee);
                          }}
                          onMoveToDepartment={(nextDepartmentId) => {
                            handleMoveToDepartment(employee.id, nextDepartmentId);
                          }}
                          onSelect={() => {
                            void handleSelectAgent(agent);
                          }}
                          onOpenDetail={() => {
                            handleOpenDetail(employee.id);
                          }}
                          onTogglePinned={() => {
                            handleTogglePinned(employee.id);
                          }}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })}

            <section className="workspace-sidebar__section">
              <SidebarSectionHeader
                label="未分组"
                count={ungroupedEntries.length}
                collapsed={collapsedSections[SECTION_KEYS.ungrouped]}
                onToggle={() => toggleSection(SECTION_KEYS.ungrouped)}
              />

              {!collapsedSections[SECTION_KEYS.ungrouped] ? (
                <div className="workspace-sidebar__section-items">
                  {ungroupedEntries.length > 0 ? (
                    ungroupedEntries.map(({ agent, employee, pinned, departmentId }) => (
                      <EmployeeRow
                        key={`ungrouped:${employee.id}`}
                        departmentId={departmentId}
                        departments={departments}
                        employee={employee}
                        isSelected={isDirectConversationActive && employee.id === activeAgentId}
                        pinned={pinned}
                        unreadCount={directUnreadByAgentId[employee.id] ?? 0}
                        onClearDepartment={() => {
                          handleMoveToDepartment(employee.id, undefined);
                        }}
                        onDelete={() => {
                          setPendingDeleteEmployee(employee);
                        }}
                        onMoveToDepartment={(nextDepartmentId) => {
                          handleMoveToDepartment(employee.id, nextDepartmentId);
                        }}
                        onSelect={() => {
                          void handleSelectAgent(agent);
                        }}
                        onOpenDetail={() => {
                          handleOpenDetail(employee.id);
                        }}
                        onTogglePinned={() => {
                          handleTogglePinned(employee.id);
                        }}
                      />
                    ))
                  ) : (
                    <EmptyHint>新建员工默认会出现在这里</EmptyHint>
                  )}
                </div>
              ) : null}
            </section>

            {shouldShowGroupArchivesSection ? (
              <section className="workspace-sidebar__section">
                <SidebarSectionHeader
                  label="项目组归档"
                  count={visibleGroupArchives.length}
                  collapsed={collapsedSections[SECTION_KEYS.groupArchives]}
                  onToggle={() => toggleSection(SECTION_KEYS.groupArchives)}
                />

                {!collapsedSections[SECTION_KEYS.groupArchives] ? (
                  <div className="workspace-sidebar__section-items">
                    {visibleGroupArchives.map((archive) => (
                      <GroupArchiveRow
                        key={archive.id}
                        archive={archive}
                        selected={selectedArchiveId === archive.id}
                        onClick={() => handleSelectArchive(archive.id)}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {shouldShowDirectArchivesSection ? (
              <section className="workspace-sidebar__section">
                <SidebarSectionHeader
                  label="1v1 归档"
                  count={visibleDirectArchives.length}
                  collapsed={collapsedSections[SECTION_KEYS.directArchives]}
                  onToggle={() => toggleSection(SECTION_KEYS.directArchives)}
                />

                {!collapsedSections[SECTION_KEYS.directArchives] ? (
                  <div className="workspace-sidebar__section-items">
                    {visibleDirectArchives.map((archive) => (
                      <DirectArchiveRow
                        key={archive.id}
                        archive={archive}
                        selected={selectedDirectArchiveId === archive.id}
                        onClick={() => handleSelectDirectArchive(archive.id)}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
        </div>

        <div className="workspace-sidebar__footer">
          <div className="workspace-sidebar__footer-card">
            <span className="workspace-sidebar__footer-label">网关</span>
            <span className="workspace-sidebar__footer-status">
              <span
                key={status}
                className="workspace-sidebar__footer-dot"
                style={{ backgroundColor: connection.dotColor }}
              />
              <span>{connection.label}</span>
            </span>
          </div>
        </div>
      </aside>

      <CreateEmployeeModal
        open={isCreateEmployeeOpen}
        onOpenChange={setIsCreateEmployeeOpen}
        onCreated={handleCreatedAgent}
      />
      <DepartmentManageModal
        open={isDepartmentManageOpen}
        onOpenChange={setIsDepartmentManageOpen}
        departments={departments}
        agentIds={agents.map((agent) => agent.id)}
        agentMetaById={agentMetaById}
      />
      <CreateGroupModal open={isCreateGroupOpen} onOpenChange={setIsCreateGroupOpen} />
      <ConfirmModal
        open={pendingDeleteEmployee !== null}
        onClose={() => {
          if (isDeletingEmployee) {
            return;
          }

          setPendingDeleteEmployee(null);
        }}
        onConfirm={() => {
          void handleConfirmDeleteEmployee();
        }}
        loading={isDeletingEmployee}
        icon="⚠️"
        iconBgColor="bg-[var(--danger-subtle)]"
        iconTextColor="text-[var(--danger)]"
        title="删除员工"
        subtitle={pendingDeleteEmployee?.name ?? ""}
        description="确认后会一并删除该员工及其全部空间数据，包括私聊会话、项目组成员关系、本地归档与头像缓存。这个操作不可恢复。"
        confirmText="确认删除"
        confirmColor="bg-[var(--danger)] hover:brightness-110"
      />
    </>
  );
}

export const EmployeeList = memo(EmployeeListInner);
EmployeeList.displayName = "EmployeeList";
