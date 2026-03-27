"use client";

import { CalendarClock, FolderKanban, Plus, Save, ShieldCheck, Trash2, Users } from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { CronManageModal } from "@/components/cron/CronManageModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAgentStore, type Agent } from "@/stores/agentStore";
import { useCronStore } from "@/stores/cronStore";
import { useGroupStore, type AgentInfo, type Group } from "@/stores/groupStore";
import { getAgentAvatarInfo } from "@/utils/agentAvatar";
import { filterCronJobsByGroup } from "@/utils/cronTask";
import {
  addAgentToGroup,
  getAvailableGroupAgents,
  removeAgentFromGroup,
  resolveDisplayAgentMembers,
} from "@/utils/groupMembers";

type GroupDetailPageProps = {
  group: Group;
};

const GROUP_AVATAR_UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";
const GROUP_AVATAR_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

type GroupDraft = {
  name: string;
  avatarUrl: string;
  description: string;
  announcement: string;
};

type Feedback = {
  tone: "success" | "error";
  message: string;
};

function buildDraft(group: Group): GroupDraft {
  return {
    name: group.name,
    avatarUrl: group.avatarUrl ?? "",
    description: group.description ?? "",
    announcement: group.announcement ?? "",
  };
}

function normalizeDraftValue(value: string | undefined) {
  return value?.trim() || "";
}

function resolveAvatarLabel(name: string) {
  return name.trim().charAt(0).toUpperCase() || "#";
}

function isSupportedAvatarFile(file: File) {
  if (file.type.startsWith("image/")) {
    return true;
  }

  return /\.(png|jpe?g|webp|svg)$/i.test(file.name);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("图标读取失败，请换一张图片再试"));
    });
    reader.addEventListener("error", () => reject(new Error("图标读取失败，请换一张图片再试")));
    reader.readAsDataURL(file);
  });
}

function MemberAvatar({
  seed,
  name,
  avatarUrl,
  emoji,
  className,
}: {
  seed?: string;
  name: string;
  avatarUrl?: string;
  emoji?: string;
  className?: string;
}) {
  const avatarInfo = getAgentAvatarInfo(seed ?? name, avatarUrl ?? emoji, name);
  const avatarLabel =
    avatarInfo.type === "image"
      ? resolveAvatarLabel(name)
      : avatarInfo.value || resolveAvatarLabel(name);

  return (
    <div
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] text-sm font-semibold text-[var(--color-text-primary)]",
        className,
      )}
    >
      {avatarInfo.type === "image" ? (
        <img src={avatarInfo.value} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span>{avatarLabel}</span>
      )}
    </div>
  );
}

function AddAgentOption({ agent, onSelect }: { agent: Agent; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-[18px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-3 text-left transition-colors hover:bg-[var(--color-bg-hover)]"
    >
      <MemberAvatar
        seed={agent.id}
        name={agent.name}
        avatarUrl={agent.avatarUrl}
        emoji={agent.emoji}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
          {agent.name}
        </div>
        <div className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">
          {agent.role?.trim() || "未填写职位"}
        </div>
      </div>
      <span className="shrink-0 text-xs font-medium text-[var(--color-brand)]">添加</span>
    </button>
  );
}

export function GroupDetailPage({ group }: GroupDetailPageProps) {
  const agents = useAgentStore((state) => state.agents);
  const cronJobs = useCronStore((state) => state.jobs);
  const updateGroupInfo = useGroupStore((state) => state.updateGroupInfo);
  const updateGroupAnnouncement = useGroupStore((state) => state.updateGroupAnnouncement);
  const [draft, setDraft] = useState<GroupDraft>(() => buildDraft(group));
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isCronManageOpen, setIsCronManageOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(buildDraft(group));
  }, [group]);

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

  const leaderId = group.leaderId.trim();
  const memberCount = group.members.length;
  const groupCronJobs = useMemo(
    () => filterCronJobsByGroup(cronJobs, group.id, group.leaderId),
    [cronJobs, group.id, group.leaderId],
  );
  const sortedMembers = useMemo(() => {
    return [...resolveDisplayAgentMembers(group, agents)].toSorted((left, right) => {
      if (left.id === leaderId) {
        return -1;
      }
      if (right.id === leaderId) {
        return 1;
      }
      return left.name.localeCompare(right.name, "zh-CN");
    });
  }, [agents, group, leaderId]);
  const availableAgents = useMemo(() => getAvailableGroupAgents(group, agents), [agents, group]);

  const hasPendingChanges =
    normalizeDraftValue(draft.name) !== normalizeDraftValue(group.name) ||
    normalizeDraftValue(draft.avatarUrl) !== normalizeDraftValue(group.avatarUrl) ||
    normalizeDraftValue(draft.description) !== normalizeDraftValue(group.description) ||
    normalizeDraftValue(draft.announcement) !== normalizeDraftValue(group.announcement);

  function patchDraft<K extends keyof GroupDraft>(key: K, value: GroupDraft[K]) {
    setDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function showFeedback(tone: Feedback["tone"], message: string) {
    setFeedback({ tone, message });
  }

  function handleTriggerAvatarUpload() {
    avatarInputRef.current?.click();
  }

  async function handleAvatarFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!isSupportedAvatarFile(file)) {
      showFeedback("error", "请上传 PNG、JPG、WEBP 或 SVG 图片");
      return;
    }

    if (file.size > GROUP_AVATAR_UPLOAD_MAX_BYTES) {
      showFeedback("error", "请上传 2MB 以内的图片");
      return;
    }

    try {
      const avatarSrc = await readFileAsDataUrl(file);
      patchDraft("avatarUrl", avatarSrc);
      showFeedback("success", "项目组图标已更新，记得保存");
    } catch (error) {
      showFeedback(
        "error",
        error instanceof Error && error.message.trim() ? error.message : "项目组图标更新失败",
      );
    }
  }

  function handleSaveGroupInfo() {
    const nextName = draft.name.trim();
    if (!nextName) {
      showFeedback("error", "项目组名称不能为空");
      return;
    }

    if (!hasPendingChanges) {
      showFeedback("success", "项目组信息已是最新");
      return;
    }

    updateGroupInfo(group.id, {
      name: nextName,
      avatarUrl: draft.avatarUrl.trim() || null,
      description: draft.description,
    });
    updateGroupAnnouncement(group.id, draft.announcement);
    showFeedback("success", "项目组信息已保存");
  }

  function handleAddMember(agent: Agent) {
    const result = addAgentToGroup(group.id, agent);
    if (!result.changed) {
      showFeedback("error", "这个员工已经在项目组里了");
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
        result.reason === "leader_locked" ? "群主不能直接移除" : "成员移除失败，请稍后重试",
      );
      return;
    }

    showFeedback("success", `已移除 ${member.name}`);
  }

  return (
    <>
      <div className="relative flex h-full min-h-0 flex-col bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
        <div
          className="shrink-0 border-b border-[var(--color-border)]"
          style={{
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--accent) 5%, transparent), color-mix(in srgb, var(--color-bg-soft) 92%, transparent))",
          }}
        >
          <div className="flex items-center gap-3 px-4 py-4">
            <MemberAvatar
              seed={group.id}
              name={draft.name || group.name}
              avatarUrl={draft.avatarUrl || undefined}
              className="h-12 w-12"
            />

            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold text-[var(--color-text-primary)]">
                {draft.name.trim() || group.name}
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2 py-0.5">
                  <Users className="h-3.5 w-3.5" />
                  {memberCount} 位成员
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2 py-0.5">
                  <CalendarClock className="h-3.5 w-3.5" />
                  {groupCronJobs.length} 个任务
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="im-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-4">
            <section
              className="overflow-hidden rounded-[24px] border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-4 shadow-[var(--shadow-sm)] backdrop-blur-xl"
              style={{
                background:
                  "linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, transparent), transparent 42%, color-mix(in srgb, var(--accent-2) 12%, transparent))",
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                    项目组介绍
                  </div>
                  <div className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">
                    名称、图标、简介和群公告都在这里直接改。
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsCronManageOpen(true);
                  }}
                  className="shrink-0 rounded-2xl border-[var(--color-border)] bg-[var(--color-bg-card)]"
                >
                  <CalendarClock className="h-4 w-4" />
                  新建定时任务
                </Button>
              </div>

              {feedback ? (
                <div className="mt-3">
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

              <div className="mt-4 space-y-4">
                <div className="grid gap-4 md:grid-cols-[88px_minmax(0,1fr)]">
                  <div className="flex flex-col items-center gap-3">
                    <button
                      type="button"
                      onClick={handleTriggerAvatarUpload}
                      className="flex h-[88px] w-[88px] items-center justify-center overflow-hidden rounded-[24px] border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-[var(--shadow-sm)] transition-colors hover:bg-[var(--color-bg-hover)]"
                      aria-label="点击修改项目组图标"
                      title="点击修改项目组图标"
                    >
                      {draft.avatarUrl.trim() ? (
                        <img
                          src={draft.avatarUrl}
                          alt={draft.name || group.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <FolderKanban className="h-7 w-7 text-[var(--color-brand)]" />
                      )}
                    </button>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept={GROUP_AVATAR_UPLOAD_ACCEPT}
                      className="hidden"
                      onChange={(event) => {
                        void handleAvatarFileChange(event);
                      }}
                    />
                    <div className="text-center text-xs text-[var(--color-text-secondary)]">
                      点击上传项目组图标
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label className="block">
                      <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                        项目组名称
                      </div>
                      <Input
                        value={draft.name}
                        onChange={(event) => {
                          patchDraft("name", event.target.value);
                        }}
                        placeholder="例如：M15 项目组"
                        className="rounded-2xl border-[var(--color-border)] bg-[var(--color-bg-card)]"
                      />
                    </label>
                  </div>
                </div>

                <label className="block">
                  <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                    简介
                  </div>
                  <Textarea
                    value={draft.description}
                    onChange={(event) => {
                      patchDraft("description", event.target.value);
                    }}
                    rows={4}
                    placeholder="写清楚这个项目组负责什么、最近在推进什么。"
                    className="rounded-[20px] border-[var(--color-border)] bg-[var(--color-bg-card)]"
                  />
                </label>

                <label className="block">
                  <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                    群公告
                  </div>
                  <Textarea
                    value={draft.announcement}
                    onChange={(event) => {
                      patchDraft("announcement", event.target.value);
                    }}
                    rows={5}
                    placeholder="这里直接维护群公告，保存后会同步到群聊。"
                    className="rounded-[20px] border-[var(--color-border)] bg-[var(--color-bg-card)]"
                  />
                </label>
              </div>

              <div className="mt-4 flex items-center justify-end">
                <Button
                  type="button"
                  onClick={handleSaveGroupInfo}
                  disabled={!draft.name.trim()}
                  className="rounded-2xl bg-[var(--color-brand)] text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-light)]"
                >
                  <Save className="h-4 w-4" />
                  保存介绍
                </Button>
              </div>
            </section>

            <section className="rounded-[24px] border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-4 shadow-[var(--shadow-sm)] backdrop-blur-xl">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                    成员管理
                  </div>
                  <div className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">
                    直接增删成员，不再额外弹窗。
                  </div>
                </div>

                <div ref={pickerRef} className="relative shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsPickerOpen((current) => !current);
                    }}
                    className="rounded-2xl border-[var(--color-border)] bg-[var(--color-bg-card)]"
                  >
                    <Plus className="h-4 w-4" />
                    添加成员
                  </Button>

                  {isPickerOpen ? (
                    <div className="absolute right-0 top-[calc(100%+12px)] z-30 w-[320px] rounded-[22px] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3 shadow-[var(--shadow-md)]">
                      {availableAgents.length > 0 ? (
                        <div className="im-scroll max-h-[260px] space-y-3 overflow-y-auto pr-1">
                          {availableAgents.map((agent) => (
                            <AddAgentOption
                              key={agent.id}
                              agent={agent}
                              onSelect={() => {
                                handleAddMember(agent);
                              }}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-[18px] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">
                          当前没有可添加的员工
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {sortedMembers.map((member) => {
                  const isLeader = member.id === leaderId;
                  return (
                    <div
                      key={member.id}
                      className="flex items-center gap-3 rounded-[20px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-3"
                    >
                      <MemberAvatar
                        seed={member.id}
                        name={member.name}
                        avatarUrl={member.avatarUrl}
                        emoji={member.emoji}
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                            {member.name}
                          </span>
                          {isLeader ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-bg-brand-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-brand)]">
                              <ShieldCheck className="h-3 w-3" />
                              群主
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">
                          {member.role?.trim() || "未填写职位"}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          handleRemoveMember(member);
                        }}
                        disabled={isLeader}
                        title={isLeader ? "群主不能直接移除" : `移除 ${member.name}`}
                        className={cn(
                          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors",
                          isLeader
                            ? "cursor-not-allowed border-[var(--color-border)] bg-[var(--surface-soft)] text-[var(--color-text-secondary)] opacity-50"
                            : "border-[var(--surface-danger-border)] bg-[var(--surface-danger-soft)] text-[var(--surface-danger-text)] hover:bg-[var(--surface-danger-soft)]",
                        )}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      </div>

      <CronManageModal
        open={isCronManageOpen}
        onOpenChange={setIsCronManageOpen}
        title={`${group.name} 的定时任务`}
        description="顶部先看当前项目组任务，底部继续新增。"
        jobs={groupCronJobs}
        emptyText="暂无新任务"
        createLabel="新建定时任务"
        lockedAgentId={group.leaderId}
        defaultReplyMode="group"
        defaultGroupId={group.id}
      />
    </>
  );
}
