import { ChevronDown, Plus, UserMinus, UserRound, UsersRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAgentStore, type Agent } from "@/stores/agentStore";
import type { AgentInfo, Group } from "@/stores/groupStore";
import {
  HUMAN_MEMBER_LABEL,
  addAgentToGroup,
  getAvailableGroupAgents,
  getGroupDisplayMemberCount,
  removeAgentFromGroup,
  resolveDisplayAgentMembers,
} from "@/utils/groupMembers";
import { readLocalStorageItem } from "@/utils/storage";

type GroupMemberManageModalProps = {
  open: boolean;
  group: Group;
  onClose: () => void;
};

type Feedback = {
  tone: "success" | "error";
  message: string;
};

function readStoredAvatar() {
  if (typeof window === "undefined") {
    return null;
  }

  const value = readLocalStorageItem("userAvatar");
  return value && value.trim() ? value : null;
}

function resolveAvatarText(name: string, emoji?: string) {
  return emoji?.trim() || name.trim().charAt(0).toUpperCase() || "#";
}

function MemberAvatar({
  name,
  avatarUrl,
  emoji,
  human = false,
}: {
  name: string;
  avatarUrl?: string;
  emoji?: string;
  human?: boolean;
}) {
  if (avatarUrl) {
    return (
      <img alt={name} className="h-12 w-12 shrink-0 rounded-full object-cover" src={avatarUrl} />
    );
  }

  return (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
      style={
        human
          ? {
              background: "var(--surface-success-soft)",
              color: "var(--surface-success-text)",
            }
          : {
              background: "var(--brand-primary)",
              color: "var(--text-inverse)",
            }
      }
    >
      {human ? <UserRound className="h-5 w-5" /> : resolveAvatarText(name, emoji)}
    </div>
  );
}

function AddAgentOption({ agent, onSelect }: { agent: Agent; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-[20px] border border-[var(--modal-shell-border)] bg-[var(--surface-glass)] px-4 py-3 text-left transition-all duration-200 hover:border-[var(--surface-brand-border)] hover:bg-[var(--surface-brand-soft)]"
    >
      <MemberAvatar name={agent.name} avatarUrl={agent.avatarUrl} emoji={agent.emoji} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
          {agent.name}
        </div>
        <div className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">
          {agent.role?.trim() || "未设置职位"}
        </div>
      </div>
      <span className="shrink-0 text-xs font-medium text-[var(--surface-brand-text)]">添加</span>
    </button>
  );
}

function AgentMemberRow({
  member,
  isLeader,
  onRemove,
}: {
  member: AgentInfo;
  isLeader: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[22px] border border-[var(--modal-shell-border)] bg-[var(--surface-glass)] px-4 py-4 shadow-[var(--shadow-sm)] backdrop-blur-xl">
      <MemberAvatar name={member.name} avatarUrl={member.avatarUrl} emoji={member.emoji} />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[15px] font-semibold text-[var(--color-text-primary)]">
            {member.name}
          </span>
          {isLeader ? (
            <span className="shrink-0 text-sm text-[var(--surface-warning-text)]" title="群主">
              👑
            </span>
          ) : null}
        </div>
        <div className="mt-1 truncate text-sm text-[var(--color-text-secondary)]">
          {isLeader ? "群主" : member.role?.trim() || "Agent 成员"}
        </div>
      </div>

      <button
        type="button"
        onClick={onRemove}
        disabled={isLeader}
        title={isLeader ? "需先更换群主" : `移除 ${member.name}`}
        className={cn(
          "inline-flex h-10 shrink-0 items-center justify-center rounded-full border px-3.5 text-sm font-medium transition-all duration-200",
          isLeader
            ? "cursor-not-allowed border-[var(--modal-shell-border)] bg-[var(--surface-soft)] text-[var(--color-text-secondary)] opacity-50"
            : "border-[var(--surface-danger-border)] bg-[var(--surface-danger-soft)] text-[var(--surface-danger-text)] hover:border-[var(--surface-danger-border)] hover:bg-[var(--surface-danger-soft)]",
        )}
      >
        <UserMinus className="h-4 w-4" />
      </button>
    </div>
  );
}

function PickerPanel({
  open,
  isLoading,
  agents,
  onSelect,
}: {
  open: boolean;
  isLoading: boolean;
  agents: Agent[];
  onSelect: (agent: Agent) => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="absolute inset-x-0 top-[calc(100%+12px)] z-30 rounded-[24px] border border-[var(--modal-shell-border)] bg-[var(--modal-shell-bg)] p-3 shadow-[var(--modal-shell-shadow)] backdrop-blur-2xl">
      {isLoading ? (
        <div className="flex h-24 items-center justify-center rounded-[20px] border border-[var(--modal-shell-border)] bg-[var(--surface-glass)] text-sm text-[var(--color-text-secondary)]">
          正在加载可添加成员...
        </div>
      ) : null}

      {!isLoading && agents.length === 0 ? (
        <div className="flex h-24 items-center justify-center rounded-[20px] border border-[var(--modal-shell-border)] bg-[var(--surface-glass)] text-sm text-[var(--color-text-secondary)]">
          当前没有可添加的 Agent
        </div>
      ) : null}

      {!isLoading && agents.length > 0 ? (
        <div className="im-scroll max-h-[280px] space-y-3 overflow-y-auto pr-1">
          {agents.map((agent) => (
            <AddAgentOption
              key={agent.id}
              agent={agent}
              onSelect={() => {
                onSelect(agent);
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function GroupMemberManageModal({ open, group, onClose }: GroupMemberManageModalProps) {
  const agents = useAgentStore((state) => state.agents);
  const isAgentsLoading = useAgentStore((state) => state.isLoading);
  const fetchAgents = useAgentStore((state) => state.fetchAgents);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const userAvatar = readStoredAvatar();

  const agentMembers = useMemo(() => resolveDisplayAgentMembers(group, agents), [agents, group]);
  const availableAgents = useMemo(() => getAvailableGroupAgents(group, agents), [agents, group]);
  const totalMembers = getGroupDisplayMemberCount(group);
  const isPickerLoading = isAgentsLoading && agents.length === 0;
  const canTogglePicker = isPickerLoading || availableAgents.length > 0;
  const pickerButtonLabel = isPickerLoading
    ? "正在加载成员"
    : availableAgents.length > 0
      ? "添加成员"
      : "暂无可添加成员";

  useEffect(() => {
    if (!open || agents.length > 0) {
      return;
    }

    void fetchAgents().catch((error) => {
      console.error("[Member] 拉取 Agent 列表失败:", error);
    });
  }, [agents.length, fetchAgents, open]);

  useEffect(() => {
    if (!isPickerOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (pickerRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsPickerOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsPickerOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPickerOpen]);

  useEffect(() => {
    if (!feedback) {
      return;
    }

    const timerId = window.setTimeout(() => {
      setFeedback((current) => (current === feedback ? null : current));
    }, 2200);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [feedback]);

  function showFeedback(tone: Feedback["tone"], message: string) {
    setFeedback({ tone, message });
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      onClose();
    }
  }

  function handleAddMember(agent: Agent) {
    const result = addAgentToGroup(group.id, agent);
    if (!result.changed) {
      showFeedback("error", "这个 Agent 已经在项目组里了");
      return;
    }

    setIsPickerOpen(false);
    showFeedback("success", `已添加 ${agent.name}`);
  }

  function handleRemoveMember(member: AgentInfo) {
    const result = removeAgentFromGroup(group.id, member.id);
    if (!result.changed) {
      showFeedback(
        "error",
        result.reason === "leader_locked" ? "需先更换群主" : "成员移除失败，请稍后重试",
      );
      return;
    }

    showFeedback("success", `已移除 ${member.name}`);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-3xl border-none bg-transparent p-0 text-[var(--color-text-primary)] shadow-none"
      >
        <div className="relative rounded-[30px] border border-[var(--modal-shell-border)] bg-[var(--modal-shell-bg)] shadow-[var(--modal-shell-shadow)] backdrop-blur-2xl">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-28 rounded-t-[30px]"
            style={{
              background:
                "radial-gradient(circle at top left, var(--surface-brand-soft), transparent 54%), radial-gradient(circle at top right, var(--brand-glow), transparent 46%)",
            }}
          />

          <div className="relative flex items-start justify-between gap-4 border-b border-[var(--divider)] px-6 pb-5 pt-6">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand-primary)] text-[var(--text-inverse)] shadow-[var(--shadow-sm)]">
                <UsersRound className="h-7 w-7" />
              </div>

              <div className="min-w-0">
                <div className="text-[24px] font-semibold tracking-tight text-[var(--color-text-primary)]">
                  成员管理
                </div>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  {totalMembers} 位成员
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--modal-shell-border)] bg-[var(--surface-soft)] text-[var(--color-text-secondary)] transition-all duration-200 hover:border-[var(--surface-brand-border)] hover:bg-[var(--surface-brand-soft)] hover:text-[var(--color-text-primary)]"
              aria-label="关闭成员管理弹窗"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="relative px-6 py-5">
            <div ref={pickerRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  if (!canTogglePicker) {
                    return;
                  }

                  setIsPickerOpen((current) => !current);
                }}
                disabled={!canTogglePicker}
                className={cn(
                  "flex h-13 w-full items-center justify-center gap-2 rounded-[20px] border px-4 text-sm font-semibold transition-all duration-200",
                  canTogglePicker
                    ? "border-[var(--surface-brand-border)] bg-[var(--brand-primary)] text-[var(--text-inverse)] hover:bg-[var(--brand-hover)]"
                    : "cursor-not-allowed border-[var(--modal-shell-border)] bg-[var(--surface-soft)] text-[var(--color-text-secondary)] opacity-70",
                )}
              >
                <Plus className="h-4 w-4" />
                <span>{pickerButtonLabel}</span>
                {canTogglePicker ? (
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform duration-200",
                      isPickerOpen ? "rotate-180" : "rotate-0",
                    )}
                  />
                ) : null}
              </button>

              <PickerPanel
                open={isPickerOpen}
                isLoading={isPickerLoading}
                agents={availableAgents}
                onSelect={handleAddMember}
              />
            </div>

            {feedback ? (
              <div className="mt-4">
                <span
                  className={cn(
                    "inline-flex rounded-full border px-3 py-1 text-xs font-medium shadow-[var(--shadow-sm)]",
                    feedback.tone === "success"
                      ? "border-[var(--surface-success-border)] bg-[var(--surface-success-soft)] text-[var(--surface-success-text)]"
                      : "border-[var(--surface-danger-border)] bg-[var(--surface-danger-soft)] text-[var(--surface-danger-text)]",
                  )}
                >
                  {feedback.message}
                </span>
              </div>
            ) : null}

            <div className="mt-6 space-y-6">
              <section className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-secondary)]">
                  <span>👤</span>
                  <span>人类用户</span>
                </div>

                <div className="flex items-center gap-3 rounded-[22px] border border-[var(--modal-shell-border)] bg-[var(--surface-glass)] px-4 py-4 shadow-[var(--shadow-sm)] backdrop-blur-xl">
                  <MemberAvatar
                    name={HUMAN_MEMBER_LABEL}
                    avatarUrl={userAvatar ?? undefined}
                    human
                  />

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold text-[var(--color-text-primary)]">
                      {HUMAN_MEMBER_LABEL}
                    </div>
                    <div className="mt-1 text-sm text-[var(--color-text-secondary)]">创建者</div>
                  </div>

                  <span className="inline-flex h-10 items-center rounded-full border border-[var(--modal-shell-border)] bg-[var(--surface-soft)] px-4 text-sm text-[var(--color-text-secondary)]">
                    不可移除
                  </span>
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-secondary)]">
                  <span>🤖</span>
                  <span>Agent 成员 ({agentMembers.length})</span>
                </div>

                <div className="im-scroll max-h-[320px] space-y-3 overflow-y-auto pr-1">
                  {agentMembers.map((member) => (
                    <AgentMemberRow
                      key={member.id}
                      member={member}
                      isLeader={member.id === group.leaderId}
                      onRemove={() => {
                        handleRemoveMember(member);
                      }}
                    />
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
