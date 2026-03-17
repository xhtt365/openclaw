"use client";

import { ArrowLeft, Bot, FileText, Loader2, Save, Settings2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { ModelSelectModal } from "@/components/modals/ModelSelectModal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/agentStore";
import { useChatStore } from "@/stores/chatStore";
import type { AgentFile } from "@/types/agent";
import {
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
  const preferredNames = ["IDENTITY.md", "SOUL.md", "USER.md"];
  for (const name of preferredNames) {
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
  const toastTimerRef = useRef<number | null>(null);

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
    agent?.id ||
    "—";
  const createdAtMs = agent?.createdAtMs ?? pickAgentCreatedAtMs(files);
  const metadataItems: MetadataItem[] = [
    {
      label: "模型名",
      value: currentAgentModel?.trim() || agent?.modelName?.trim() || defaultModelLabel || "—",
    },
    { label: "Agent ID", value: agent?.id ?? "—" },
    { label: "创建时间", value: formatAgentCreatedAt(createdAtMs) },
    { label: "状态", value: "在线" },
    { label: "上下文消息条数", value: String(messages.length) },
    { label: "技能数", value: "0" },
  ];

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
        <div className="mx-auto flex max-w-[800px] flex-col gap-6 px-6 py-6">
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

          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-6 backdrop-blur-xl">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-[28px] border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-[0_18px_48px_var(--color-shadow-card)]">
                {agent.avatarUrl ? (
                  <img
                    alt={agent.name}
                    src={agent.avatarUrl}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-4xl">{agent.emoji?.trim() || agent.name.charAt(0)}</span>
                )}
              </div>
              <div className="mt-5 text-xl font-bold text-[var(--color-text-primary)]">
                {agent.name}
              </div>
              <div className="mt-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1 text-sm text-[var(--color-text-secondary)]">
                {roleLabel}
              </div>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3">
              {metadataItems.map((item) => (
                <MetadataCard key={item.label} item={item} />
              ))}
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <ActionCard
              emoji="🔗"
              title="配置渠道"
              icon={<Settings2 className="h-4 w-4" />}
              badge="开发中"
              hint="功能入口预留，下一轮接交互"
            />
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
          </section>

          <section className="min-h-[420px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-5 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] pb-4">
              <div className="flex items-center gap-2 text-base font-semibold text-[var(--color-text-primary)]">
                <span aria-hidden="true">📝</span>
                <span>提示词文件</span>
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

            <div className="mt-4 grid min-h-[360px] gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-2">
                <div className="mb-2 px-2 pt-1 text-xs uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
                  文件列表
                </div>
                <div className="space-y-1">
                  {files.length > 0 ? (
                    files.map((file) => {
                      const isActive = file.name === activeFileName;
                      return (
                        <button
                          key={file.name}
                          type="button"
                          onClick={() => void handleSelectFile(file.name)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl border-l-2 px-3 py-3 text-left transition-colors",
                            isActive
                              ? "border-[var(--color-brand)] bg-[var(--color-bg-hover)]"
                              : "border-transparent hover:bg-[var(--color-bg-hover)]",
                          )}
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-bg-soft)] text-base">
                            <span aria-hidden="true">📄</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                              {file.name}
                            </div>
                            <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                              {formatFileSize(file.size)}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="px-3 py-6 text-sm text-[var(--color-text-secondary)]">
                      暂无可编辑文件
                    </div>
                  )}
                </div>
              </div>

              <div className="flex min-h-[360px] flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)]">
                <div className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                      {activeFileName ?? "请选择文件"}
                    </div>
                    <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                      {activeFileName
                        ? "支持 Cmd+S / Ctrl+S 快速保存"
                        : "从左侧选择一个提示词文件开始编辑"}
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
                      placeholder={activeFileName ? "在这里编辑提示词内容..." : "请选择左侧文件"}
                      className="min-h-[320px] flex-1 resize-none bg-transparent px-4 py-4 font-mono text-sm leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)] disabled:cursor-not-allowed disabled:text-[var(--color-text-secondary)]"
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
            </div>
          </section>
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
