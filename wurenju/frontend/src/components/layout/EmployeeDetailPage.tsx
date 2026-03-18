"use client";

import {
  ArrowLeft,
  Bot,
  BriefcaseBusiness,
  FileText,
  ImagePlus,
  Loader2,
  Save,
  Settings2,
  Sparkles,
} from "lucide-react";
import { type ChangeEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { ModelSelectModal } from "@/components/modals/ModelSelectModal";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";
import { useAgentStore } from "@/stores/agentStore";
import { useChatStore } from "@/stores/chatStore";
import type { AgentFile } from "@/types/agent";
import { getAgentAvatarInfo, saveAgentAvatarMapping } from "@/utils/agentAvatar";
import {
  buildAgentIdentityContent,
  formatAgentCreatedAt,
  parseAgentIdentityContent,
  pickAgentCreatedAtMs,
} from "@/utils/agentIdentity";

type MetadataItem = {
  label: string;
  value: string;
};

const EMPTY_FILES: AgentFile[] = [];
const EMPTY_MESSAGES: Array<{ id?: string }> = [];
const PRIORITY_FILE_NAMES = ["IDENTITY.md", "SOUL.md", "USER.md"] as const;
const AVATAR_UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";
const AVATAR_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(size >= 10 * 1024 ? 0 : 1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function resolveIdentityRole(content: string) {
  if (!content.trim()) {
    return null;
  }

  const normalized = content.replace(/\r\n/g, "\n");
  const headingPatterns = [
    /##\s*角色\s*\n+([\s\S]*?)(?=\n##\s|$)/,
    /##\s*职位\s*\n+([\s\S]*?)(?=\n##\s|$)/,
  ];

  for (const pattern of headingPatterns) {
    const match = normalized.match(pattern);
    const role = match?.[1]
      ?.split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (role) {
      return role;
    }
  }

  const inlineMatch = content.match(/^\s*-\s*(?:角色|职位)\s*:\s*(.+)$/m);
  if (inlineMatch?.[1]?.trim()) {
    return inlineMatch[1].trim();
  }

  return null;
}

function resolvePreferredFile(files: AgentFile[]) {
  for (const name of PRIORITY_FILE_NAMES) {
    const matched = files.find((file) => file.name === name);
    if (matched) {
      return matched.name;
    }
  }

  return files[0]?.name ?? null;
}

function formatModelShortName(modelRef: string | null | undefined) {
  if (!modelRef?.trim()) {
    return "未设置";
  }

  const trimmed = modelRef.trim();
  const separatorIndex = trimmed.indexOf("/");
  if (separatorIndex === -1) {
    return trimmed;
  }

  return trimmed.slice(separatorIndex + 1) || trimmed;
}

function upsertAgentFile(files: AgentFile[], nextFile: AgentFile) {
  const exists = files.some((file) => file.name === nextFile.name);
  return exists
    ? files.map((file) => (file.name === nextFile.name ? nextFile : file))
    : [...files, nextFile];
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

      reject(new Error("头像读取失败，请换一张图片再试"));
    });
    reader.addEventListener("error", () => reject(new Error("头像读取失败，请换一张图片再试")));
    reader.readAsDataURL(file);
  });
}

function MetadataCard({ item }: { item: MetadataItem }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
        {item.label}
      </div>
      <div className="mt-2 truncate text-sm font-medium text-[var(--color-text-primary)]">
        {item.value}
      </div>
    </div>
  );
}

function ActionCard({
  emoji,
  title,
  icon,
  disabled = true,
  badge,
  hint,
  value,
  onClick,
}: {
  emoji: string;
  title: string;
  icon: ReactNode;
  disabled?: boolean;
  badge?: string;
  hint: string;
  value?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-disabled={disabled ? "true" : undefined}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        onClick?.();
      }}
      className={cn(
        "group flex items-center gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-5 text-left backdrop-blur-xl transition-transform duration-200 hover:scale-[1.01]",
        disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-[var(--color-bg-hover)]",
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-bg-soft-strong)] text-xl">
        <span aria-hidden="true">{emoji}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold text-[var(--color-text-primary)]">{title}</span>
          {badge ? (
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
              {badge}
            </span>
          ) : null}
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-sm text-[var(--color-text-secondary)]">
          <div className="flex min-w-0 items-center gap-2">
            {icon}
            <span className="truncate">{hint}</span>
          </div>
          {value ? (
            <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">{value}</span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

export function EmployeeDetailPage() {
  const closeDetail = useAgentStore((state) => state.closeDetail);
  const showDetailFor = useAgentStore((state) => state.showDetailFor);
  const agents = useAgentStore((state) => state.agents);
  const activeFileName = useAgentStore((state) => state.activeFileName);
  const fileContent = useAgentStore((state) => state.fileContent);
  const fileDirty = useAgentStore((state) => state.fileDirty);
  const fileSaving = useAgentStore((state) => state.fileSaving);
  const fileLoading = useAgentStore((state) => state.fileLoading);
  const agentFiles = useAgentStore((state) => state.agentFiles);
  const defaultModelLabel = useAgentStore((state) => state.defaultModelLabel);
  const currentAgentModel = useAgentStore((state) => state.currentAgentModel);
  const selectFile = useAgentStore((state) => state.selectFile);
  const updateFileContent = useAgentStore((state) => state.updateFileContent);
  const saveFile = useAgentStore((state) => state.saveFile);
  const messagesByAgentId = useChatStore((state) => state.messagesByAgentId);

  const [showSavedToast, setShowSavedToast] = useState(false);
  const [showModelModal, setShowModelModal] = useState(false);
  const [showUnsavedChangesModal, setShowUnsavedChangesModal] = useState(false);
  const [pendingFileName, setPendingFileName] = useState<string | null>(null);
  const [switchingFile, setSwitchingFile] = useState(false);
  const [, setAvatarVersion] = useState(0);
  const [profileDraft, setProfileDraft] = useState({
    name: "",
    role: "",
    description: "",
    emoji: "🤖",
  });
  const [profileBaseline, setProfileBaseline] = useState({
    name: "",
    role: "",
    description: "",
    emoji: "🤖",
  });
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const toastTimerRef = useRef<number | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const agent = agents.find((item) => item.id === showDetailFor) ?? null;
  const files = showDetailFor ? (agentFiles.get(showDetailFor) ?? EMPTY_FILES) : EMPTY_FILES;
  const messages = showDetailFor
    ? (messagesByAgentId.get(showDetailFor) ?? EMPTY_MESSAGES)
    : EMPTY_MESSAGES;
  const identityFile = files.find((file) => file.name === "IDENTITY.md");
  const parsedIdentity = parseAgentIdentityContent(identityFile?.content ?? "");
  const roleLabel =
    agent?.role?.trim() ||
    parsedIdentity.role?.trim() ||
    resolveIdentityRole(identityFile?.content ?? "") ||
    "AI 员工";
  const createdAtMs = agent?.createdAtMs ?? pickAgentCreatedAtMs(files);
  const metadataItems: MetadataItem[] = [
    {
      label: "模型名",
      value: currentAgentModel?.trim() || agent?.modelName?.trim() || defaultModelLabel || "—",
    },
    { label: "Agent ID", value: agent?.id ?? "—" },
    { label: "创建时间", value: formatAgentCreatedAt(createdAtMs) },
    { label: "上下文消息条数", value: String(messages.length) },
    { label: "状态", value: "在线" },
  ];
  const profileDirty =
    profileDraft.name.trim() !== profileBaseline.name ||
    profileDraft.role.trim() !== profileBaseline.role ||
    profileDraft.description.trim() !== profileBaseline.description ||
    profileDraft.emoji.trim() !== profileBaseline.emoji;
  const avatarInfo = agent
    ? getAgentAvatarInfo(
        agent.id,
        agent.avatarUrl ?? profileDraft.emoji ?? agent.emoji,
        profileDraft.name.trim() || agent.name,
      )
    : null;
  const priorityFiles = files.filter((file) =>
    PRIORITY_FILE_NAMES.includes(file.name as (typeof PRIORITY_FILE_NAMES)[number]),
  );
  const secondaryFiles = files.filter(
    (file) => !PRIORITY_FILE_NAMES.includes(file.name as (typeof PRIORITY_FILE_NAMES)[number]),
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!showDetailFor || activeFileName || fileLoading || files.length === 0) {
      return;
    }

    const preferredFileName = resolvePreferredFile(files);
    if (!preferredFileName) {
      return;
    }

    void selectFile(preferredFileName);
  }, [activeFileName, fileLoading, files, selectFile, showDetailFor]);

  useEffect(() => {
    if (!showDetailFor) {
      return;
    }

    // 页面级快捷键，保存当前正在编辑的提示词文件。
    const handleKeyDown = (event: KeyboardEvent) => {
      const isSaveShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s";
      if (!isSaveShortcut) {
        return;
      }

      event.preventDefault();
      if (!activeFileName || fileLoading || fileSaving) {
        return;
      }

      void handleSave();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeFileName, fileLoading, fileSaving, showDetailFor]);

  useEffect(() => {
    if (!agent) {
      return;
    }

    const nextProfile = {
      name: agent.name,
      role:
        agent.role?.trim() ||
        parsedIdentity.role?.trim() ||
        resolveIdentityRole(identityFile?.content ?? "") ||
        "",
      description: agent.description?.trim() || parsedIdentity.description?.trim() || "",
      emoji: parsedIdentity.emoji?.trim() || agent.emoji?.trim() || "🤖",
    };

    setProfileDraft(nextProfile);
    setProfileBaseline(nextProfile);
    setIsSavingProfile(false);
  }, [
    agent,
    identityFile?.content,
    parsedIdentity.description,
    parsedIdentity.emoji,
    parsedIdentity.role,
  ]);

  useEffect(() => {
    function handleAvatarRefresh() {
      setAvatarVersion((current) => current + 1);
    }

    window.addEventListener("xiaban-agent-avatar-updated", handleAvatarRefresh);
    return () => {
      window.removeEventListener("xiaban-agent-avatar-updated", handleAvatarRefresh);
    };
  }, []);

  if (!showDetailFor) {
    return null;
  }

  if (!agent) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
        <div className="mx-auto flex w-full max-w-[800px] flex-1 flex-col gap-6 px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            <Button
              type="button"
              variant="ghost"
              onClick={closeDetail}
              className="h-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4 text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
            >
              <ArrowLeft className="h-4 w-4" />
              返回聊天
            </Button>
            <div className="text-sm text-[var(--color-text-secondary)]">{showDetailFor}</div>
          </div>

          <div className="flex flex-1 items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] backdrop-blur-xl">
            <div className="text-center">
              <div className="text-base font-medium text-[var(--color-text-primary)]">
                正在加载员工详情...
              </div>
              <div className="mt-2 text-sm text-[var(--color-text-secondary)]">
                如果持续空白，通常是员工信息还没同步完成
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  async function handleSave() {
    const ok = await saveFile();
    if (!ok) {
      return;
    }

    setShowSavedToast(true);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setShowSavedToast(false);
    }, 3000);
  }

  async function handleSelectFile(name: string) {
    if (name === activeFileName) {
      return;
    }

    if (fileDirty) {
      setPendingFileName(name);
      setShowUnsavedChangesModal(true);
      return;
    }

    await selectFile(name);
  }

  async function handleSaveProfile() {
    if (!agent || isSavingProfile) {
      return;
    }

    const nextName = profileDraft.name.trim();
    if (!nextName) {
      toast({
        title: "姓名不能为空",
        description: "请先填写员工名称",
        variant: "destructive",
      });
      return;
    }

    const nextRole = profileDraft.role.trim();
    const nextDescription = profileDraft.description.trim();
    const nextEmoji = profileDraft.emoji.trim() || agent.emoji?.trim() || "🤖";
    const previousIdentityContent =
      activeFileName === "IDENTITY.md" && fileContent.trim() ? fileContent : identityFile?.content;
    const nextIdentityContent = buildAgentIdentityContent({
      previousContent: previousIdentityContent,
      name: nextName,
      emoji: nextEmoji,
      role: nextRole,
      description: nextDescription,
    });

    setIsSavingProfile(true);

    try {
      await gateway.updateAgent(agent.id, { name: nextName });
      await gateway.setAgentFile(agent.id, "IDENTITY.md", nextIdentityContent);

      const updatedAtMs = Date.now();
      const nextIdentityFile: AgentFile = {
        name: "IDENTITY.md",
        size: new TextEncoder().encode(nextIdentityContent).length,
        updatedAtMs,
        content: nextIdentityContent,
      };

      useAgentStore.setState((state) => {
        const currentFiles = state.agentFiles.get(agent.id) ?? [];
        const nextFiles = upsertAgentFile(currentFiles, nextIdentityFile);
        const nextAgentFiles = new Map(state.agentFiles);
        nextAgentFiles.set(agent.id, nextFiles);

        return {
          agents: state.agents.map((item) =>
            item.id === agent.id
              ? {
                  ...item,
                  name: nextName,
                  role: nextRole || "AI 员工",
                  description: nextDescription || undefined,
                  emoji: nextEmoji,
                  createdAtMs: item.createdAtMs ?? updatedAtMs,
                }
              : item,
          ),
          agentFiles: nextAgentFiles,
          fileContent:
            state.showDetailFor === agent.id && state.activeFileName === "IDENTITY.md"
              ? nextIdentityContent
              : state.fileContent,
          fileDirty:
            state.showDetailFor === agent.id && state.activeFileName === "IDENTITY.md"
              ? false
              : state.fileDirty,
        };
      });

      const nextProfile = {
        name: nextName,
        role: nextRole,
        description: nextDescription,
        emoji: nextEmoji,
      };
      setProfileDraft(nextProfile);
      setProfileBaseline(nextProfile);
      toast({
        title: "资料已更新",
        description: "姓名、职务和简介已同步到员工资料",
      });
    } catch (error) {
      toast({
        title: "保存资料失败",
        description: error instanceof Error && error.message.trim() ? error.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setIsSavingProfile(false);
    }
  }

  function handleTriggerAvatarUpload() {
    avatarInputRef.current?.click();
  }

  async function handleAvatarFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!agent || !file) {
      return;
    }

    if (!isSupportedAvatarFile(file)) {
      toast({
        title: "头像格式不支持",
        description: "请上传 PNG、JPG、WEBP 或 SVG 图片",
        variant: "destructive",
      });
      return;
    }

    if (file.size > AVATAR_UPLOAD_MAX_BYTES) {
      toast({
        title: "头像过大",
        description: "请上传 2MB 以内的图片",
        variant: "destructive",
      });
      return;
    }

    try {
      // 头像只走本地映射，避免影响网关文件结构。
      const avatarSrc = await readFileAsDataUrl(file);
      saveAgentAvatarMapping(agent.id, avatarSrc);
      setAvatarVersion((current) => current + 1);
      toast({
        title: "头像已更新",
        description: "资料页、侧栏和聊天头像会同步刷新",
      });
    } catch (error) {
      toast({
        title: "头像更新失败",
        description: error instanceof Error && error.message.trim() ? error.message : "请稍后重试",
        variant: "destructive",
      });
    }
  }

  function closeUnsavedChangesModal() {
    if (switchingFile) {
      return;
    }

    setShowUnsavedChangesModal(false);
    setPendingFileName(null);
  }

  async function handleConfirmFileSwitch() {
    if (!pendingFileName) {
      setShowUnsavedChangesModal(false);
      return;
    }

    setSwitchingFile(true);
    try {
      await selectFile(pendingFileName);
      setShowUnsavedChangesModal(false);
      setPendingFileName(null);
    } finally {
      setSwitchingFile(false);
    }
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1360px] flex-col gap-4 px-5 py-5">
          <div className="flex items-center justify-between gap-4">
            <Button
              type="button"
              variant="ghost"
              onClick={closeDetail}
              className="h-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4 text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
            >
              <ArrowLeft className="h-4 w-4" />
              返回聊天
            </Button>
            <div className="truncate text-sm font-medium text-[var(--color-text-secondary)]">
              {agent.name}
            </div>
          </div>

          <div className="grid min-h-0 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col gap-4 xl:sticky xl:top-5 xl:self-start">
              <section
                className="overflow-hidden rounded-[28px] border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-5 shadow-[var(--shadow-md)] backdrop-blur-xl"
                style={{
                  background:
                    "linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, transparent), transparent 40%, color-mix(in srgb, var(--accent-2) 12%, transparent))",
                }}
              >
                <div className="flex items-start gap-4">
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onClick={handleTriggerAvatarUpload}
                      className="group relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-[28px] border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-[0_18px_48px_var(--color-shadow-card)]"
                      aria-label="点击修改头像"
                      title="点击修改头像"
                    >
                      {avatarInfo?.type === "image" ? (
                        <img
                          alt={profileDraft.name || agent.name}
                          src={avatarInfo.value}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-5xl">
                          {avatarInfo?.value ?? agent.name.charAt(0)}
                        </span>
                      )}
                      <div className="absolute inset-x-2 bottom-2 rounded-full bg-[color:color-mix(in_srgb,var(--color-bg-card)_82%,transparent)] px-2 py-1 text-[11px] font-medium text-[var(--color-text-primary)] opacity-0 transition-opacity group-hover:opacity-100">
                        点击修改头像
                      </div>
                    </button>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept={AVATAR_UPLOAD_ACCEPT}
                      className="hidden"
                      onChange={(event) => {
                        void handleAvatarFileChange(event);
                      }}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="inline-flex items-center gap-2 rounded-full bg-[var(--color-bg-brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--color-brand)]">
                      <BriefcaseBusiness className="h-3.5 w-3.5" />
                      编辑资料
                    </div>
                    <div className="mt-3 text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
                      {profileDraft.name || agent.name}
                    </div>
                    <div className="mt-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1 text-sm font-medium text-[var(--color-text-secondary)]">
                      {profileDraft.role.trim() || roleLabel}
                    </div>
                    <div className="mt-3 text-sm leading-7 text-[var(--color-text-secondary)]">
                      {profileDraft.description.trim() || "为董事长处理复杂工作，保持持续在线。"}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)]">
                    <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
                    在线待命
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)]">
                    <Bot className="h-3.5 w-3.5 text-[var(--accent-2)]" />
                    {formatModelShortName(
                      currentAgentModel || agent?.modelName || defaultModelLabel,
                    )}
                  </div>
                </div>
              </section>

              <section className="rounded-[24px] border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-4 shadow-[var(--shadow-sm)] backdrop-blur-xl">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                      资料面板
                    </div>
                    <div className="mt-1 text-xs leading-6 text-[var(--color-text-secondary)]">
                      保存后会同步写入 `IDENTITY.md`
                    </div>
                  </div>
                  <Button
                    type="button"
                    onClick={() => {
                      void handleSaveProfile();
                    }}
                    disabled={!profileDirty || isSavingProfile}
                    className="h-10 rounded-2xl px-4"
                  >
                    {isSavingProfile ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    保存
                  </Button>
                </div>

                <div className="mt-4 space-y-3">
                  <label className="block">
                    <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                      员工名称
                    </div>
                    <input
                      value={profileDraft.name}
                      onChange={(event) => {
                        setProfileDraft((current) => ({
                          ...current,
                          name: event.target.value,
                        }));
                      }}
                      placeholder="输入员工名称"
                      className="h-11 w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 text-[15px] text-[var(--color-text-primary)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--color-text-secondary)] focus:border-[var(--accent)] focus:shadow-[0_0_0_1px_var(--accent-glow)]"
                    />
                  </label>

                  <label className="block">
                    <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                      职务
                    </div>
                    <input
                      value={profileDraft.role}
                      onChange={(event) => {
                        setProfileDraft((current) => ({
                          ...current,
                          role: event.target.value,
                        }));
                      }}
                      placeholder="例如：产品负责人、运营经理、全栈开发"
                      className="h-11 w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 text-[15px] text-[var(--color-text-primary)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--color-text-secondary)] focus:border-[var(--accent)] focus:shadow-[0_0_0_1px_var(--accent-glow)]"
                    />
                  </label>

                  <label className="block">
                    <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                      简介
                    </div>
                    <textarea
                      value={profileDraft.description}
                      onChange={(event) => {
                        setProfileDraft((current) => ({
                          ...current,
                          description: event.target.value,
                        }));
                      }}
                      rows={4}
                      placeholder="介绍一下职责、擅长方向和协作风格"
                      className="min-h-[112px] w-full resize-none rounded-[20px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-3 text-[15px] leading-7 text-[var(--color-text-primary)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--color-text-secondary)] focus:border-[var(--accent)] focus:shadow-[0_0_0_1px_var(--accent-glow)]"
                    />
                  </label>
                </div>
              </section>

              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
                {metadataItems.map((item) => (
                  <MetadataCard key={item.label} item={item} />
                ))}
              </section>

              <section className="grid gap-3">
                <ActionCard
                  emoji="🤖"
                  title="配置模型"
                  icon={<Bot className="h-4 w-4" />}
                  disabled={false}
                  hint="已接入 Gateway，可直接切换当前员工模型"
                  value={formatModelShortName(
                    currentAgentModel || agent?.modelName || defaultModelLabel,
                  )}
                  onClick={() => setShowModelModal(true)}
                />
                <ActionCard
                  emoji="🖼️"
                  title="修改头像"
                  icon={<ImagePlus className="h-4 w-4" />}
                  disabled={false}
                  hint="头像立即本地生效，不影响网关文件"
                  onClick={handleTriggerAvatarUpload}
                />
                <ActionCard
                  emoji="🔗"
                  title="配置渠道"
                  icon={<Settings2 className="h-4 w-4" />}
                  badge="开发中"
                  hint="功能入口预留，下一轮接交互"
                />
              </section>
            </aside>

            <section className="min-h-0 rounded-[28px] border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-5 shadow-[var(--shadow-md)] backdrop-blur-xl">
              <div className="flex flex-col gap-4 border-b border-[var(--color-border)] pb-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-base font-semibold text-[var(--color-text-primary)]">
                    <span aria-hidden="true">📝</span>
                    <span>核心提示词工作台</span>
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
                    关键文件直接放到首屏，减少滚动；支持 Cmd+S / Ctrl+S 快速保存。
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={!activeFileName || fileLoading || fileSaving}
                  className={cn(
                    "h-10 rounded-xl px-4",
                    fileDirty
                      ? "bg-[var(--color-brand)] text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-light)]"
                      : "border border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]",
                  )}
                >
                  {fileSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {fileDirty ? "保存 *" : "保存"}
                </Button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {(priorityFiles.length > 0 ? priorityFiles : files).map((file) => {
                  const isActive = file.name === activeFileName;
                  return (
                    <button
                      key={file.name}
                      type="button"
                      onClick={() => void handleSelectFile(file.name)}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                        isActive
                          ? "border-[var(--color-brand)] bg-[var(--color-bg-brand-soft)] text-[var(--color-brand)]"
                          : "border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]",
                      )}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      {file.name}
                    </button>
                  );
                })}
              </div>

              {secondaryFiles.length > 0 ? (
                <div className="mt-4 rounded-[22px] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
                    其他文件
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {secondaryFiles.map((file) => {
                      const isActive = file.name === activeFileName;
                      return (
                        <button
                          key={file.name}
                          type="button"
                          onClick={() => void handleSelectFile(file.name)}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-xs transition-colors",
                            isActive
                              ? "border-[var(--color-brand)] bg-[var(--color-bg-brand-soft)] text-[var(--color-brand)]"
                              : "border-[var(--color-border)] bg-[var(--color-bg-soft)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]",
                          )}
                        >
                          {file.name} · {formatFileSize(file.size)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="mt-4 flex min-h-[calc(100vh-220px)] min-w-0 flex-col rounded-[24px] border border-[var(--color-border)] bg-[var(--color-bg-card)]">
                <div className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                      {activeFileName ?? "请选择文件"}
                    </div>
                    <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                      {activeFileName
                        ? "优先文件已上提到首屏，减少来回滚动"
                        : "从上方选择一个提示词文件开始编辑"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                    <FileText className="h-4 w-4" />
                    <span>{activeFileName ? "Markdown" : "未选中"}</span>
                  </div>
                </div>

                <div className="relative flex min-h-0 flex-1">
                  {fileLoading ? (
                    <div className="flex flex-1 items-center justify-center gap-3 text-sm text-[var(--color-text-secondary)]">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>正在加载文件内容...</span>
                    </div>
                  ) : (
                    <textarea
                      value={fileContent}
                      onChange={(event) => updateFileContent(event.target.value)}
                      disabled={!activeFileName || fileSaving}
                      placeholder={activeFileName ? "在这里编辑提示词内容..." : "请选择上方文件"}
                      className="min-h-[420px] flex-1 resize-none bg-transparent px-5 py-4 font-mono text-sm leading-7 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)] disabled:cursor-not-allowed disabled:text-[var(--color-text-secondary)]"
                    />
                  )}

                  {fileSaving ? (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end px-4 pb-3">
                      <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-3 py-1 text-xs text-[var(--color-text-secondary)] backdrop-blur">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        正在保存
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      <ModelSelectModal
        open={showModelModal}
        onOpenChange={setShowModelModal}
        agentId={agent.id}
        agentName={agent.name}
      />

      <ConfirmModal
        open={showUnsavedChangesModal}
        onClose={closeUnsavedChangesModal}
        onConfirm={() => {
          void handleConfirmFileSwitch();
        }}
        loading={switchingFile}
        icon="⚠️"
        iconBgColor="bg-[var(--warn-subtle)]"
        iconTextColor="text-[var(--warn)]"
        title="切换文件"
        subtitle="检测到未保存修改"
        description="当前文件还有未保存的内容，继续切换会保留这些修改在编辑区之外，不会自动写入磁盘。确定继续切换吗？"
        confirmText="继续切换"
        confirmColor="bg-[var(--warn)] hover:brightness-110"
      />

      {showSavedToast ? (
        <div className="pointer-events-none absolute bottom-6 right-6 rounded-xl border border-[var(--ok)] bg-[var(--ok-subtle)] px-4 py-3 text-sm font-medium text-[var(--ok)] shadow-[var(--shadow-md)] backdrop-blur-xl">
          ✅ 已保存
        </div>
      ) : null}
    </div>
  );
}
