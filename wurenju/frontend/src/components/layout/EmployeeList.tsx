"use client";

import { Briefcase, Building2, ChevronDown, Plus, Search, Settings2, Users } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateEmployeeModal } from "@/components/modals/CreateEmployeeModal";
import { CreateGroupModal } from "@/components/modals/CreateGroupModal";
import { cn } from "@/lib/utils";
import { useAgentStore, type Agent } from "@/stores/agentStore";
import { useChatStore } from "@/stores/chatStore";
import { useGroupStore } from "@/stores/groupStore";
import type { ChatMessage } from "@/utils/messageAdapter";

type EmployeeStatus = "online" | "thinking" | "offline" | "error";
type ConnectionStatus = "connecting" | "connected" | "disconnected";
type SidebarTab = "functions" | "groups";

type GroupDefinition = {
  id: string;
  label: string;
};

type AgentPresentation = {
  functionGroupId: string;
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

const AVATAR_COLORS = [
  "var(--color-avatar-1)",
  "var(--color-avatar-2)",
  "var(--color-avatar-3)",
  "var(--color-avatar-4)",
  "var(--color-avatar-5)",
  "var(--color-avatar-6)",
] as const;

const FUNCTION_GROUPS: GroupDefinition[] = [
  { id: "management", label: "管理层" },
  { id: "team", label: "员工" },
];

function hashText(value: string) {
  return Array.from(value).reduce((total, char) => total + char.charCodeAt(0), 0);
}

function getAvatarColor(agentId: string) {
  return AVATAR_COLORS[hashText(agentId) % AVATAR_COLORS.length];
}

function getPresentation(agent: Agent): AgentPresentation {
  return {
    functionGroupId: agent.id === "main" ? "management" : "team",
  };
}

function getPreview(messages: ChatMessage[]) {
  const visibleMessages = messages.filter(
    (message) => !message.isLoading && message.content.trim(),
  );
  const latestMessage = visibleMessages[visibleMessages.length - 1];

  if (!latestMessage) {
    return {
      preview: "点击开始对话",
      timestamp: "待命中",
    };
  }

  const previewText = latestMessage.content.replace(/\s+/g, " ").trim();
  const preview = latestMessage.role === "user" ? `你：${previewText}` : previewText;

  if (typeof latestMessage.timestamp !== "number" || !Number.isFinite(latestMessage.timestamp)) {
    return {
      preview,
      timestamp: latestMessage.timestampLabel?.trim() || "刚刚",
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

function toEmployee(agent: Agent, preview: ReturnType<typeof getPreview>): Employee {
  const avatarText = agent.emoji?.trim() || agent.name.charAt(0).toUpperCase() || "A";

  return {
    id: agent.id,
    name: agent.name,
    role: agent.role?.trim() || "未设置职位",
    status: "online",
    lastMessage: preview.preview,
    timestamp: preview.timestamp,
    avatarColor: getAvatarColor(agent.id),
    avatarText,
    avatarUrl: agent.avatarUrl,
    emoji: agent.emoji,
  };
}

function buildEmployee(agent: Agent, messages: ChatMessage[]) {
  return {
    agent,
    employee: toEmployee(agent, getPreview(messages)),
    presentation: getPresentation(agent),
  };
}

function buildInitialEmployee(agent: Agent) {
  return toEmployee(agent, {
    preview: "",
    timestamp: "",
  });
}

function getConnectionStyle(status: ConnectionStatus) {
  if (status === "connected") {
    return {
      color: "var(--color-online)",
      label: "已连接",
    };
  }

  if (status === "connecting") {
    return {
      color: "var(--color-warning)",
      label: "连接中",
    };
  }

  return {
    color: "var(--color-text-secondary)",
    label: "未连接",
  };
}

interface EmployeeListProps {
  selectedEmployeeId: string;
  onSelectEmployee: (employee: Employee) => void;
}

function EmployeeListInner({ selectedEmployeeId, onSelectEmployee }: EmployeeListProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<SidebarTab>("functions");
  const [isCreateEmployeeOpen, setIsCreateEmployeeOpen] = useState(false);
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
  const selectGroup = useGroupStore((state) => state.selectGroup);
  const clearSelectedGroup = useGroupStore((state) => state.clearSelectedGroup);
  const switchAgent = useChatStore((state) => state.switchAgent);
  const status = useChatStore((state) => state.status);
  const messagesByAgentId = useChatStore((state) => state.messagesByAgentId);

  const activeAgentId = currentAgentId || selectedEmployeeId;
  const resolvedActiveTab: SidebarTab = selectedGroupId ? "groups" : activeTab;
  const keyword = search.trim().toLowerCase();
  const connection = getConnectionStyle(status);

  const entries = agents.map((agent) =>
    buildEmployee(agent, messagesByAgentId.get(agent.id) ?? []),
  );
  const visibleEntries = entries.filter(({ employee, presentation }) => {
    if (!keyword) {
      return true;
    }

    const activeGroupId = presentation.functionGroupId;
    const activeGroupLabel =
      FUNCTION_GROUPS.find((group) => group.id === activeGroupId)?.label ?? "";

    return (
      employee.name.toLowerCase().includes(keyword) ||
      employee.id.toLowerCase().includes(keyword) ||
      employee.role.toLowerCase().includes(keyword) ||
      employee.lastMessage.toLowerCase().includes(keyword) ||
      activeGroupLabel.toLowerCase().includes(keyword)
    );
  });

  const groupedEntries = FUNCTION_GROUPS.map((group) => ({
    ...group,
    employees: visibleEntries.filter(
      ({ presentation }) => presentation.functionGroupId === group.id,
    ),
  })).filter((group) => group.employees.length > 0);

  const visibleGroups = groups.filter((group) => {
    if (!keyword) {
      return true;
    }

    return (
      group.name.toLowerCase().includes(keyword) ||
      (group.description ?? "").toLowerCase().includes(keyword) ||
      group.members.some((member) => member.name.toLowerCase().includes(keyword))
    );
  });

  useEffect(() => {
    let isActive = true;

    const initAgents = async () => {
      try {
        await fetchAgents();
        if (!isActive) {
          return;
        }

        const store = useAgentStore.getState();
        const initialAgent =
          store.agents.find((agent) => agent.id === store.currentAgentId) ?? store.agents[0];
        if (!initialAgent) {
          return;
        }

        onSelectEmployee(buildInitialEmployee(initialAgent));
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
  }, [fetchAgents, onSelectEmployee, switchAgent]);

  async function handleSelectAgent(agent: Agent) {
    setActiveTab("functions");
    clearSelectedGroup();
    closeDetail();
    onSelectEmployee(buildInitialEmployee(agent));
    await switchAgent(agent.id);
  }

  function handleSelectFunctionsTab() {
    console.log("[Group] 切换到职能 Tab");
    setActiveTab("functions");
    clearSelectedGroup();
    closeDetail();
  }

  function handleSelectGroupsTab() {
    console.log("[Group] 切换到项目组 Tab");
    setActiveTab("groups");
    if (groups.length === 0 || resolvedActiveTab === "groups") {
      setIsCreateGroupOpen(true);
    }
  }

  function handleSelectGroup(groupId: string) {
    closeDetail();
    setActiveTab("groups");
    selectGroup(groupId);
  }

  function toggleGroup(groupId: string) {
    const key = `functions:${groupId}`;
    setCollapsedGroups((current) => ({
      ...current,
      [key]: !current[key],
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
            className="mt-5 flex w-full items-center gap-3 rounded-xl bg-[var(--color-brand)] px-4 py-4 text-left text-[var(--color-text-on-brand)] shadow-[0_4px_18px_var(--color-shadow-brand-soft)] transition-all duration-[250ms] hover:-translate-y-0.5 hover:bg-[var(--color-brand-light)] hover:shadow-[0_8px_24px_var(--color-shadow-brand-strong)] active:scale-[0.97]"
            style={{ transitionTimingFunction: "var(--ease-standard)" }}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-bg-brand-soft)]">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold">龙虾办公室</div>
              <div className="mt-0.5 truncate text-xs text-[var(--color-text-on-brand-muted)]">
                欢迎董事长视察工作
              </div>
            </div>
          </button>
        </div>

        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <div className="group relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={resolvedActiveTab === "groups" ? "搜索项目组..." : "搜索员工..."}
              className="h-11 w-full rounded-lg border border-transparent bg-[var(--color-bg-input)] pl-10 pr-3 text-sm text-[var(--color-text-primary)] outline-none transition-[border-color,box-shadow] duration-[250ms] placeholder:text-[var(--color-text-secondary)] focus:border-[var(--color-brand)] focus:shadow-[0_0_0_1px_var(--color-brand-glow)]"
            />
          </div>
        </div>

        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <button
            type="button"
            onClick={() => setIsCreateEmployeeOpen(true)}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-brand)] text-sm font-semibold text-[var(--color-text-on-brand)] transition-all duration-[250ms] hover:scale-[1.02] hover:bg-[var(--color-brand-light)] hover:shadow-[0_0_20px_var(--color-brand-glow)] active:scale-[0.97]"
          >
            <Plus className="h-4 w-4" />
            新增员工
          </button>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleSelectFunctionsTab}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition-all duration-200",
                resolvedActiveTab === "functions"
                  ? "border-[var(--color-brand)] bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] shadow-[0_0_0_1px_var(--color-brand-glow)]"
                  : "border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]",
              )}
            >
              <Briefcase className="h-4 w-4" />
              职能
            </button>
            <button
              type="button"
              onClick={handleSelectGroupsTab}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition-all duration-200",
                resolvedActiveTab === "groups"
                  ? "border-violet-400/35 bg-violet-500/10 text-white shadow-[0_0_0_1px_rgba(168,85,247,0.25)]"
                  : "border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]",
              )}
            >
              <Users className="h-4 w-4" />
              项目组
            </button>
          </div>
        </div>

        <div className="im-scroll flex-1 overflow-y-auto px-3 py-4">
          {resolvedActiveTab === "functions" ? (
            <>
              {isLoading && agents.length === 0 ? (
                <div className="px-3 py-6 text-sm text-[var(--color-text-secondary)]">
                  正在加载员工列表...
                </div>
              ) : null}

              {!isLoading && visibleEntries.length === 0 ? (
                <div className="px-3 py-6 text-sm text-[var(--color-text-secondary)]">
                  没找到匹配的员工
                </div>
              ) : null}

              <div className="space-y-3">
                {groupedEntries.map((group) => {
                  const collapseKey = `functions:${group.id}`;
                  const isCollapsed = collapsedGroups[collapseKey];

                  return (
                    <section key={group.id} className="rounded-xl bg-transparent">
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.id)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-[var(--color-text-secondary)]"
                      >
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 transition-transform duration-300",
                            isCollapsed ? "-rotate-90" : "rotate-0",
                          )}
                        />
                        <span>{group.label}</span>
                      </button>

                      <div
                        className="overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out"
                        style={{
                          maxHeight: isCollapsed ? "0px" : `${group.employees.length * 68}px`,
                          opacity: isCollapsed ? 0 : 1,
                        }}
                      >
                        <div className="space-y-1 px-1 pb-1">
                          {group.employees.map(({ agent, employee }) => {
                            const isSelected = employee.id === activeAgentId;
                            const isDetailActive = showDetailFor === employee.id;

                            return (
                              <div
                                key={employee.id}
                                className={cn(
                                  "group relative flex h-14 items-center rounded-xl transition-all duration-200",
                                  isSelected
                                    ? "bg-[var(--color-bg-hover)]"
                                    : "hover:bg-[var(--color-bg-row-hover)]",
                                )}
                              >
                                {isSelected ? (
                                  <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-[var(--color-brand)]" />
                                ) : null}

                                <button
                                  type="button"
                                  onClick={() => {
                                    void handleSelectAgent(agent);
                                  }}
                                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 pr-11 text-left"
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
                                    <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full border border-[var(--color-bg-secondary)] bg-[var(--color-online)]" />
                                  </div>

                                  <div className="min-w-0 flex-1">
                                    <div className="flex min-w-0 items-center gap-2">
                                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-text-primary)]">
                                        {employee.name}
                                      </span>
                                      <span className="max-w-[92px] shrink rounded-full bg-[var(--color-bg-soft)] px-2 py-0.5 text-[11px] leading-4 text-[var(--color-text-secondary)] truncate">
                                        {employee.role}
                                      </span>
                                    </div>
                                    <div className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">
                                      {employee.lastMessage}
                                    </div>
                                  </div>
                                </button>

                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void openDetail(employee.id);
                                  }}
                                  className={cn(
                                    "absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full transition-all duration-200",
                                    isDetailActive
                                      ? "translate-x-0 bg-[var(--color-bg-soft)] text-[var(--color-brand)] opacity-100"
                                      : "translate-x-2 text-[var(--color-text-secondary)] opacity-0 group-hover:translate-x-0 group-hover:opacity-100 hover:bg-[var(--color-bg-soft)] hover:text-[var(--color-text-primary)]",
                                  )}
                                  aria-label={`打开 ${employee.name} 配置`}
                                >
                                  <Settings2 className="h-4 w-4" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </section>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              {groups.length === 0 ? (
                <div className="flex min-h-[180px] items-center justify-center px-6 text-center text-sm leading-6 text-[var(--color-text-secondary)]">
                  还没有项目组，点击「项目组」标签直接创建
                </div>
              ) : null}

              {groups.length > 0 && visibleGroups.length === 0 ? (
                <div className="flex min-h-[180px] items-center justify-center px-6 text-center text-sm leading-6 text-[var(--color-text-secondary)]">
                  没找到匹配的项目组
                </div>
              ) : null}

              <div className="space-y-2">
                {visibleGroups.map((group) => {
                  const isSelected = selectedGroupId === group.id;

                  return (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => handleSelectGroup(group.id)}
                      className={cn(
                        "group relative flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left backdrop-blur-xl transition-all duration-200",
                        isSelected
                          ? "border-violet-400/35 bg-violet-500/10 shadow-[0_16px_50px_rgba(139,92,246,0.12)]"
                          : "border-white/[0.06] bg-white/[0.03] hover:border-white/[0.12] hover:bg-white/[0.06]",
                      )}
                    >
                      {isSelected ? (
                        <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r bg-violet-400" />
                      ) : null}

                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#8b5cf6,#3b82f6)] text-[22px] font-semibold text-white shadow-[0_12px_36px_rgba(139,92,246,0.22)]">
                        #
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                          {group.name}
                        </div>
                        <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                          {group.members.length}人
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="border-t border-[var(--color-border)] px-5 py-4">
          <div className="flex items-center gap-2 text-sm" style={{ color: connection.color }}>
            <span
              key={status}
              className="h-2.5 w-2.5 rounded-full status-pulse-once"
              style={{ backgroundColor: connection.color }}
            />
            <span>{connection.label}</span>
          </div>
        </div>
      </aside>

      <CreateEmployeeModal open={isCreateEmployeeOpen} onOpenChange={setIsCreateEmployeeOpen} />
      <CreateGroupModal
        open={isCreateGroupOpen}
        onOpenChange={setIsCreateGroupOpen}
        onCreated={() => {
          setActiveTab("groups");
        }}
      />
    </>
  );
}

export const EmployeeList = memo(EmployeeListInner);
EmployeeList.displayName = "EmployeeList";
