"use client";

import { Archive, Building2, ChevronDown, Plus, Search, Settings, Users } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ThemeToggle } from "@/components/chat/components/theme-toggle";
import { CreateEmployeeModal } from "@/components/modals/CreateEmployeeModal";
import { CreateGroupModal } from "@/components/modals/CreateGroupModal";
import { DepartmentManageModal } from "@/components/modals/DepartmentManageModal";
import { cn } from "@/lib/utils";
import { useAgentStore, type Agent } from "@/stores/agentStore";
import { useChatStore } from "@/stores/chatStore";
import { useGroupStore, type GroupArchive, type GroupChatMessage } from "@/stores/groupStore";
import "@/styles/openclaw-sidebar.css";
import { AGENT_AVATAR_STORAGE_KEY, getAgentAvatarInfo } from "@/utils/agentAvatar";
import { getGroupDisplayMemberCount } from "@/utils/groupMembers";
import type { ChatMessage } from "@/utils/messageAdapter";
import {
  readSidebarAgentMetaMap,
  readSidebarCollapsedSections,
  readSidebarDepartments,
  readSidebarDirectArchives,
  subscribeSidebarStorage,
  writeSidebarAgentMetaMap,
  writeSidebarCollapsedSections,
  type SidebarAgentMeta,
  type SidebarCollapsedSections,
  type SidebarDepartment,
  type SidebarDirectArchive,
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
  isDetailActive: boolean;
  pinned: boolean;
  onClearDepartment: () => void;
  onMoveToDepartment: (departmentId: string) => void;
  onSelect: () => void;
  onOpenDetail: () => void;
  onTogglePinned: () => void;
};

type ProjectGroupRowProps = {
  groupId: string;
  name: string;
  memberCount: number;
  preview: GroupPreview;
  selected: boolean;
  onClick: () => void;
};

type GroupArchiveRowProps = {
  archive: GroupArchive;
  selected: boolean;
  onClick: () => void;
};

type DirectArchiveRowProps = {
  archive: SidebarDirectArchive;
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

function hashText(value: string) {
  return Array.from(value).reduce((total, char) => total + char.charCodeAt(0), 0);
}

function getAvatarColor(agentId: string) {
  return AVATAR_COLORS[hashText(agentId) % AVATAR_COLORS.length];
}

function getGroupIconBackground(groupId: string) {
  return GROUP_ICON_GRADIENTS[hashText(groupId) % GROUP_ICON_GRADIENTS.length];
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

function matchesKeyword(keyword: string, values: Array<string | undefined>) {
  if (!keyword) {
    return true;
  }

  return values.some((value) => value?.toLowerCase().includes(keyword));
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
      <span className="truncate leading-5">{label}</span>
      {typeof count === "number" ? (
        <span className="ml-auto shrink-0 leading-5">{count}</span>
      ) : null}
    </button>
  );
}

function EmptyHint({ children }: { children: string }) {
  return <div className="workspace-sidebar__empty">{children}</div>;
}

function EmployeeMenuAction({
  disabled = false,
  label,
  leading,
  trailing,
  onClick,
}: {
  disabled?: boolean;
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
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-[var(--color-text-primary)] transition-colors duration-150 hover:bg-[var(--color-bg-hover)]"
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
  isDetailActive,
  pinned,
  onClearDepartment,
  onMoveToDepartment,
  onSelect,
  onOpenDetail,
  onTogglePinned,
}: EmployeeRowProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const hasDepartments = departments.length > 0;
  const showUngroupAction = Boolean(departmentId);
  const isActionActive = isDetailActive || isMenuOpen;
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
    <div className={cn("group relative", isMenuOpen && "z-40")}>
      <div
        className={cn(
          "workspace-sidebar__row",
          isSelected ? "workspace-sidebar__row--selected" : "",
        )}
      >
        {isSelected ? <span className="workspace-sidebar__row-accent" /> : null}

        <button
          type="button"
          onClick={onSelect}
          className="flex min-h-16 w-full min-w-0 items-center gap-3 text-left"
        >
          <div className="workspace-sidebar__row-avatar">
            {avatarInfo.type === "image" ? (
              <img
                alt={employee.name}
                className="h-10 w-10 rounded-full object-cover"
                src={avatarInfo.value}
              />
            ) : (
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-[var(--color-text-on-brand)]"
                style={{ backgroundColor: employee.avatarColor }}
              >
                {avatarInfo.value}
              </div>
            )}
            <span
              className="workspace-sidebar__row-avatar-badge"
              style={{ backgroundColor: getEmployeeStatusDotColor(employee.status) }}
            />
          </div>

          <div className="workspace-sidebar__row-body">
            <div className="workspace-sidebar__row-title">
              <span className="workspace-sidebar__row-name">{employee.name}</span>
              {employee.role ? (
                <span className="workspace-sidebar__row-meta">{employee.role}</span>
              ) : null}
            </div>
            <div className="workspace-sidebar__row-preview">
              {employee.lastMessage || "暂无消息"}
            </div>
          </div>
        </button>

        <div ref={menuRef} className={cn("workspace-sidebar__row-menu", isMenuOpen && "z-50")}>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIsMenuOpen((current) => !current);
            }}
            className="workspace-sidebar__row-menu-button"
            data-open={isActionActive ? "true" : "false"}
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
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ProjectGroupRow({
  groupId,
  name,
  memberCount,
  preview,
  selected,
  onClick,
}: ProjectGroupRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "workspace-sidebar__row group overflow-hidden",
        selected ? "workspace-sidebar__row--selected" : "",
      )}
    >
      {selected ? <span className="workspace-sidebar__row-accent" /> : null}

      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--accent-foreground)]"
        style={{ background: getGroupIconBackground(groupId) }}
      >
        <Users className="h-4 w-4" />
      </div>

      <div className="workspace-sidebar__row-body">
        <div className="workspace-sidebar__row-title">
          <span className="workspace-sidebar__row-name">{name}</span>
          <span className="workspace-sidebar__row-meta">{memberCount} 人</span>
        </div>
        <div className="workspace-sidebar__row-preview">{preview.preview || "暂无消息"}</div>
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
        "workspace-sidebar__row group overflow-hidden",
        selected ? "workspace-sidebar__row--selected" : "",
      )}
    >
      {selected ? <span className="workspace-sidebar__row-accent" /> : null}

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

function DirectArchiveRow({ archive }: DirectArchiveRowProps) {
  const preview = getDirectArchivePreview(archive);

  return (
    <button
      type="button"
      onClick={() => {
        console.log("[Archive] 1v1 归档回看暂未实现:", archive.id);
      }}
      className="workspace-sidebar__row group overflow-hidden"
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
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<SidebarCollapsedSections>(() =>
    readSidebarCollapsedSections(),
  );
  // 部门、置顶和 1v1 归档还没接后端，先从 localStorage 读取 mock 数据。
  const [departments, setDepartments] = useState<SidebarDepartment[]>(() =>
    readSidebarDepartments(),
  );
  const [agentMetaById, setAgentMetaById] = useState(() => readSidebarAgentMetaMap());
  const [directArchives, setDirectArchives] = useState(() => readSidebarDirectArchives());
  const [isCreateEmployeeOpen, setIsCreateEmployeeOpen] = useState(false);
  const [isDepartmentManageOpen, setIsDepartmentManageOpen] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [, setAgentAvatarVersion] = useState(0);
  const agents = useAgentStore((state) => state.agents);
  const currentAgentId = useAgentStore((state) => state.currentAgentId);
  const isLoading = useAgentStore((state) => state.isLoading);
  const showDetailFor = useAgentStore((state) => state.showDetailFor);
  const fetchAgents = useAgentStore((state) => state.fetchAgents);
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
  const status = useChatStore((state) => state.status);
  const messagesByAgentId = useChatStore((state) => state.messagesByAgentId);
  const onSelectEmployeeRef = useRef(onSelectEmployee);

  const activeAgentId = currentAgentId || selectedEmployeeId;
  const keyword = search.trim().toLowerCase();
  const connection = getConnectionStyle(status);
  const departmentsById = new Map(departments.map((department) => [department.id, department]));

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

  const visibleAgentEntries = agentEntries.filter(({ employee, departmentName, pinned }) =>
    matchesKeyword(keyword, [
      employee.name,
      employee.id,
      employee.role,
      employee.lastMessage,
      departmentName,
      pinned ? "置顶" : "",
      departmentName ? "" : "未分组",
    ]),
  );

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

  const visibleGroups = groups.filter((group) =>
    matchesKeyword(keyword, [
      group.name,
      group.description ?? "",
      "项目组",
      ...group.members.map((member) => member.name),
    ]),
  );

  const visibleGroupArchives = archives
    .filter((archive) => {
      if (!keyword) {
        return true;
      }

      return (
        archive.groupName.toLowerCase().includes(keyword) ||
        archive.messages.some((message) => {
          const senderLabel = message.role === "user" ? "你" : message.senderName?.trim() || "成员";
          return (
            senderLabel.toLowerCase().includes(keyword) ||
            message.content.toLowerCase().includes(keyword)
          );
        })
      );
    })
    .toSorted(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    );

  const visibleDirectArchives = directArchives.filter((archive) =>
    matchesKeyword(keyword, [archive.agentName, archive.preview, "1v1 归档"]),
  );

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
    return subscribeSidebarStorage(() => {
      setDepartments(readSidebarDepartments());
      setAgentMetaById(readSidebarAgentMetaMap());
      setDirectArchives(readSidebarDirectArchives());
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
    closeDetail();
    onSelectEmployee(buildInitialEmployee(nextAgent));
    await switchAgent(nextAgent.id);
  }

  function handleSelectGroup(groupId: string) {
    closeDetail();
    selectGroup(groupId);
  }

  function handleSelectArchive(archiveId: string) {
    closeDetail();
    selectArchive(archiveId);
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
      <aside className="workspace-sidebar">
        <div className="workspace-sidebar__hero">
          <div className="flex items-start justify-between gap-4">
            <div className="workspace-sidebar__brand">
              <div className="workspace-sidebar__brand-logo">
                <span aria-hidden="true">🦞</span>
              </div>
              <div>
                <div className="workspace-sidebar__brand-name">虾班</div>
                <div className="workspace-sidebar__brand-subtitle">你的 AI 永不下班</div>
              </div>
            </div>
            <ThemeToggle />
          </div>

          <button
            type="button"
            onClick={() => navigate("/office")}
            className="workspace-sidebar__office"
          >
            <div className="workspace-sidebar__office-icon">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="workspace-sidebar__office-title truncate">龙虾办公室</div>
              <div className="workspace-sidebar__office-subtitle truncate">欢迎董事长视察工作</div>
            </div>
          </button>
        </div>

        <div className="workspace-sidebar__search">
          <div className="workspace-sidebar__search-wrap">
            <Search className="workspace-sidebar__search-icon" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索员工、项目组、归档..."
              className="workspace-sidebar__search-input"
            />
          </div>
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

          {!isLoading && keyword && !hasVisibleContent ? (
            <EmptyHint>没找到匹配的员工、项目组或归档</EmptyHint>
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
                        isSelected={employee.id === activeAgentId}
                        isDetailActive={showDetailFor === employee.id}
                        pinned={pinned}
                        onClearDepartment={() => {
                          handleMoveToDepartment(employee.id, undefined);
                        }}
                        onMoveToDepartment={(nextDepartmentId) => {
                          handleMoveToDepartment(employee.id, nextDepartmentId);
                        }}
                        onSelect={() => {
                          void handleSelectAgent(agent);
                        }}
                        onOpenDetail={() => {
                          void openDetail(employee.id);
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
                        memberCount={getGroupDisplayMemberCount(group)}
                        preview={getGroupPreview(
                          messagesByGroupId[group.id] ?? [],
                          group.createdAt,
                        )}
                        selected={selectedGroupId === group.id}
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
                          isSelected={employee.id === activeAgentId}
                          isDetailActive={showDetailFor === employee.id}
                          pinned={pinned}
                          onClearDepartment={() => {
                            handleMoveToDepartment(employee.id, undefined);
                          }}
                          onMoveToDepartment={(nextDepartmentId) => {
                            handleMoveToDepartment(employee.id, nextDepartmentId);
                          }}
                          onSelect={() => {
                            void handleSelectAgent(agent);
                          }}
                          onOpenDetail={() => {
                            void openDetail(employee.id);
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
                        isSelected={employee.id === activeAgentId}
                        isDetailActive={showDetailFor === employee.id}
                        pinned={pinned}
                        onClearDepartment={() => {
                          handleMoveToDepartment(employee.id, undefined);
                        }}
                        onMoveToDepartment={(nextDepartmentId) => {
                          handleMoveToDepartment(employee.id, nextDepartmentId);
                        }}
                        onSelect={() => {
                          void handleSelectAgent(agent);
                        }}
                        onOpenDetail={() => {
                          void openDetail(employee.id);
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
                      <DirectArchiveRow key={archive.id} archive={archive} />
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
    </>
  );
}

export const EmployeeList = memo(EmployeeListInner);
EmployeeList.displayName = "EmployeeList";
