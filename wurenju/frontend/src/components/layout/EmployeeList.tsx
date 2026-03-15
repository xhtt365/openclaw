"use client";

import { Archive, Building2, ChevronDown, Plus, Search, Settings, Users } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateEmployeeModal } from "@/components/modals/CreateEmployeeModal";
import { CreateGroupModal } from "@/components/modals/CreateGroupModal";
import { DepartmentManageModal } from "@/components/modals/DepartmentManageModal";
import { cn } from "@/lib/utils";
import { useAgentStore, type Agent } from "@/stores/agentStore";
import { useChatStore } from "@/stores/chatStore";
import { useGroupStore, type GroupArchive, type GroupChatMessage } from "@/stores/groupStore";
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
  "linear-gradient(135deg,#8b5cf6,#3b82f6)",
  "linear-gradient(135deg,#f97316,#ef4444)",
  "linear-gradient(135deg,#14b8a6,#06b6d4)",
  "linear-gradient(135deg,#eab308,#f59e0b)",
  "linear-gradient(135deg,#ec4899,#8b5cf6)",
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
      dotClassName: "bg-green-500",
      label: "已连接",
    };
  }

  if (status === "connecting") {
    return {
      dotClassName: "bg-amber-400",
      label: "连接中",
    };
  }

  return {
    dotClassName: "bg-red-500",
    label: "连接断开",
  };
}

function matchesKeyword(keyword: string, values: Array<string | undefined>) {
  if (!keyword) {
    return true;
  }

  return values.some((value) => value?.toLowerCase().includes(keyword));
}

function getEmployeeStatusDotClass(status: string) {
  if (status === "error") {
    return "bg-red-500";
  }

  if (status === "offline") {
    return "bg-gray-400";
  }

  return "bg-green-500";
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
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-2 px-1 py-2 text-left text-[12px] font-medium text-gray-400 transition-colors duration-200 hover:text-gray-500"
    >
      <ChevronDown
        className={cn(
          "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
          collapsed ? "-rotate-90" : "rotate-0",
        )}
      />
      <span className="truncate leading-5">{label}</span>
      {typeof count === "number" ? <span className="shrink-0 leading-5">{count}</span> : null}
    </button>
  );
}

function EmptyHint({ children }: { children: string }) {
  return <div className="px-4 py-3 text-[12px] leading-5 text-gray-400">{children}</div>;
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
          "relative rounded-xl transition-all duration-200",
          isSelected ? "bg-gray-100" : "hover:bg-gray-100",
        )}
      >
        {isSelected ? (
          <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r bg-orange-500" />
        ) : null}

        <button
          type="button"
          onClick={onSelect}
          className="flex min-h-16 w-full min-w-0 items-center gap-3 px-3 py-3 pr-11 text-left"
        >
          <div className="relative shrink-0">
            {employee.avatarUrl ? (
              <img
                alt={employee.name}
                className="h-10 w-10 rounded-full object-cover"
                src={employee.avatarUrl}
              />
            ) : (
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-[var(--color-text-on-brand)]"
                style={{ backgroundColor: employee.avatarColor }}
              >
                {employee.avatarText}
              </div>
            )}
            <span
              className={cn(
                "absolute bottom-0 right-0 h-2 w-2 rounded-full border-2 border-[var(--color-bg-secondary)]",
                getEmployeeStatusDotClass(employee.status),
              )}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[14px] font-semibold leading-5 text-[var(--color-text-primary)]">
                {employee.name}
              </span>
              {employee.role ? (
                <span className="min-w-0 truncate text-[12px] font-normal leading-5 text-gray-400">
                  {employee.role}
                </span>
              ) : null}
            </div>
            <div className="truncate text-[12px] leading-5 text-gray-400">
              {employee.lastMessage || "暂无消息"}
            </div>
          </div>
        </button>

        <div
          ref={menuRef}
          className={cn("absolute right-3 top-1/2 -translate-y-1/2", isMenuOpen && "z-50")}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIsMenuOpen((current) => !current);
            }}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200",
              isActionActive
                ? "translate-x-0 bg-[var(--color-bg-soft)] text-[var(--color-brand)] opacity-100"
                : "translate-x-2 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 hover:bg-[var(--color-bg-soft)]",
            )}
            style={!isActionActive ? { color: "var(--color-text-secondary)" } : undefined}
            aria-label={`打开 ${employee.name} 操作菜单`}
            aria-expanded={isMenuOpen}
            aria-haspopup="menu"
          >
            <Settings className="h-4 w-4" />
          </button>

          {isMenuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+8px)] z-30 w-48 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] p-1.5 shadow-[0_18px_40px_var(--color-shadow-card)]"
              style={{ animation: "sidebar-popover-fade-in 150ms var(--ease-standard)" }}
            >
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
              <div className="px-3 pb-1 pt-1 text-[11px] font-medium text-[var(--color-text-secondary)]">
                移动到分组
              </div>

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
        "group relative flex min-h-16 w-full items-center gap-3 overflow-hidden rounded-xl px-3 py-3 text-left transition-all duration-200",
        selected ? "bg-gray-100" : "hover:bg-gray-100",
      )}
    >
      {selected ? (
        <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-orange-500" />
      ) : null}

      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
        style={{ background: getGroupIconBackground(groupId) }}
      >
        <Users className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[14px] font-semibold leading-5 text-[var(--color-text-primary)]">
            {name}
          </span>
          <span className="shrink-0 text-[12px] font-normal leading-5 text-gray-400">
            {memberCount} 人
          </span>
        </div>
        <div className="truncate text-[12px] leading-5 text-gray-400">
          {preview.preview || "暂无消息"}
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
        "group relative flex min-h-16 w-full items-center gap-3 overflow-hidden rounded-xl px-3 py-3 text-left transition-all duration-200",
        selected ? "bg-gray-100" : "hover:bg-gray-100",
      )}
    >
      {selected ? (
        <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-orange-500" />
      ) : null}

      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-700 text-white">
        <Archive className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[14px] font-semibold leading-5 text-[var(--color-text-primary)]">
            {archive.groupName}
          </span>
          <span className="shrink-0 text-[12px] leading-5 text-gray-400">{preview.timestamp}</span>
        </div>
        <div className="truncate text-[12px] leading-5 text-gray-400">{preview.preview}</div>
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
      className="group relative flex min-h-16 w-full items-center gap-3 overflow-hidden rounded-xl px-3 py-3 text-left transition-all duration-200 hover:bg-gray-100"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-700 text-white">
        <span className="text-[11px] font-semibold">1v1</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[14px] font-semibold leading-5 text-[var(--color-text-primary)]">
            {archive.agentName}
          </span>
          <span className="shrink-0 text-[12px] leading-5 text-gray-400">{preview.timestamp}</span>
        </div>
        <div className="truncate text-[12px] leading-5 text-gray-400">{preview.preview}</div>
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
      <aside className="flex h-full min-h-0 w-[var(--sidebar-w)] min-w-[var(--sidebar-w)] flex-col bg-[var(--color-bg-secondary)]">
        <div className="border-b border-[var(--color-border)] px-5 pb-5 pt-6">
          <div className="flex items-center gap-4">
            <div className="brand-gradient flex h-14 w-14 items-center justify-center rounded-2xl text-[24px] shadow-[0_12px_32px_var(--color-shadow-avatar)]">
              <span aria-hidden="true">🦞</span>
            </div>
            <div>
              <div className="text-[20px] font-bold tracking-tight text-[var(--color-text-primary)]">
                虾班
              </div>
              <div className="mt-1 text-xs text-[var(--color-text-secondary)]">你的AI永不下班</div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate("/office")}
            className="mt-5 flex w-full items-center gap-3 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-4 text-left text-white shadow-sm transition-all duration-200 hover:brightness-105 hover:shadow-md active:scale-[0.98]"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold">龙虾办公室</div>
              <div className="mt-0.5 truncate text-xs text-white/80">欢迎董事长视察工作</div>
            </div>
          </button>
        </div>

        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <div className="group relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索员工、项目组、归档..."
              className="h-11 w-full rounded-xl border border-transparent bg-[var(--color-bg-input)] pl-10 pr-3 text-sm text-[var(--color-text-primary)] outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-[var(--color-text-secondary)] focus:border-[var(--color-brand)] focus:shadow-[0_0_0_1px_var(--color-brand-glow)]"
            />
          </div>
        </div>

        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <button
            type="button"
            onClick={() => setIsCreateEmployeeOpen(true)}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:brightness-110 hover:shadow-md active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            新增员工
          </button>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setIsDepartmentManageOpen(true);
              }}
              className="flex h-9 items-center justify-center rounded-lg bg-gray-100 px-3 text-[13px] font-medium whitespace-nowrap text-[var(--color-text-primary)] transition-all duration-200 hover:bg-gray-200 hover:shadow-sm"
            >
              部门管理
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCreateGroupOpen(true);
              }}
              className="flex h-9 items-center justify-center rounded-lg bg-gray-100 px-3 text-[13px] font-medium whitespace-nowrap text-[var(--color-text-primary)] transition-all duration-200 hover:bg-gray-200 hover:shadow-sm"
            >
              新建项目组
            </button>
          </div>
        </div>

        <div className="im-scroll flex-1 overflow-y-auto px-3 py-4">
          {isLoading && agents.length === 0 ? <EmptyHint>正在加载员工列表...</EmptyHint> : null}

          {!isLoading && keyword && !hasVisibleContent ? (
            <EmptyHint>没找到匹配的员工、项目组或归档</EmptyHint>
          ) : null}

          <div className="space-y-3">
            {shouldShowPinnedSection ? (
              <section className="border-t border-gray-100 pt-3 first:border-t-0 first:pt-0">
                <SidebarSectionHeader
                  label="置顶"
                  count={pinnedEntries.length}
                  collapsed={collapsedSections[SECTION_KEYS.pinned]}
                  onToggle={() => toggleSection(SECTION_KEYS.pinned)}
                />

                {!collapsedSections[SECTION_KEYS.pinned] ? (
                  <div className="space-y-1 px-1 pb-1">
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
              <section className="border-t border-gray-100 pt-3 first:border-t-0 first:pt-0">
                <SidebarSectionHeader
                  label="项目组"
                  count={visibleGroups.length}
                  collapsed={collapsedSections[SECTION_KEYS.groups]}
                  onToggle={() => toggleSection(SECTION_KEYS.groups)}
                />

                {!collapsedSections[SECTION_KEYS.groups] ? (
                  <div className="space-y-1 px-1 pb-1">
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
                <section
                  key={department.id}
                  className="border-t border-gray-100 pt-3 first:border-t-0 first:pt-0"
                >
                  <SidebarSectionHeader
                    label={department.name}
                    count={department.employees.length}
                    collapsed={collapsedSections[collapseKey]}
                    onToggle={() => toggleSection(collapseKey)}
                  />

                  {!collapsedSections[collapseKey] ? (
                    <div className="space-y-1 px-1 pb-1">
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

            <section className="border-t border-gray-100 pt-3 first:border-t-0 first:pt-0">
              <SidebarSectionHeader
                label="未分组"
                count={ungroupedEntries.length}
                collapsed={collapsedSections[SECTION_KEYS.ungrouped]}
                onToggle={() => toggleSection(SECTION_KEYS.ungrouped)}
              />

              {!collapsedSections[SECTION_KEYS.ungrouped] ? (
                <div className="space-y-1 px-1 pb-1">
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
              <section className="border-t border-gray-100 pt-3 first:border-t-0 first:pt-0">
                <SidebarSectionHeader
                  label="项目组归档"
                  count={visibleGroupArchives.length}
                  collapsed={collapsedSections[SECTION_KEYS.groupArchives]}
                  onToggle={() => toggleSection(SECTION_KEYS.groupArchives)}
                />

                {!collapsedSections[SECTION_KEYS.groupArchives] ? (
                  <div className="space-y-1 px-1 pb-1">
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
              <section className="border-t border-gray-100 pt-3 first:border-t-0 first:pt-0">
                <SidebarSectionHeader
                  label="1v1 归档"
                  count={visibleDirectArchives.length}
                  collapsed={collapsedSections[SECTION_KEYS.directArchives]}
                  onToggle={() => toggleSection(SECTION_KEYS.directArchives)}
                />

                {!collapsedSections[SECTION_KEYS.directArchives] ? (
                  <div className="space-y-1 px-1 pb-1">
                    {visibleDirectArchives.map((archive) => (
                      <DirectArchiveRow key={archive.id} archive={archive} />
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
        </div>

        <div className="border-t border-[var(--color-border)] px-5 py-4">
          <div
            className="flex items-center gap-2 text-[12px]"
            style={{ color: "var(--color-text-secondary)", opacity: 0.86 }}
          >
            <span key={status} className={cn("h-2 w-2 rounded-full", connection.dotClassName)} />
            <span>{connection.label}</span>
          </div>
        </div>
      </aside>

      <CreateEmployeeModal open={isCreateEmployeeOpen} onOpenChange={setIsCreateEmployeeOpen} />
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
