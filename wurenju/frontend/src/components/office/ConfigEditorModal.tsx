"use client";

import { AlertTriangle, FolderClock, Loader2, Save, WandSparkles } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { ConfigHistoryPanel } from "@/components/office/ConfigHistoryPanel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";
import type { ConfigVersion } from "@/types/config";
import {
  buildJsonMergePatch,
  formatConfigTimestamp,
  isConfigObject,
  pushConfigHistoryVersion,
  readConfigHistory,
} from "@/utils/configEditor";
import { formatJSONWithComments, parseJSONWithComments } from "@/utils/json5Parse";

const DEFAULT_CONFIG_PATH = "~/.openclaw/openclaw.json";

function focusTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) {
    return;
  }

  window.setTimeout(() => {
    textarea.focus();
  }, 0);
}

function resolveErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function findLineStart(value: string, index: number) {
  let cursor = index;

  while (cursor > 0 && value[cursor - 1] !== "\n") {
    cursor -= 1;
  }

  return cursor;
}

function indentSelection(value: string, start: number, end: number) {
  if (start === end) {
    const nextValue = `${value.slice(0, start)}  ${value.slice(end)}`;
    return {
      value: nextValue,
      selectionStart: start + 2,
      selectionEnd: end + 2,
    };
  }

  const blockStart = findLineStart(value, start);
  const block = value.slice(blockStart, end);
  const lines = block.split("\n");
  const indented = lines.map((line) => `  ${line}`).join("\n");

  return {
    value: `${value.slice(0, blockStart)}${indented}${value.slice(end)}`,
    selectionStart: start + 2,
    selectionEnd: end + lines.length * 2,
  };
}

function outdentSelection(value: string, start: number, end: number) {
  const blockStart = findLineStart(value, start);
  const block = value.slice(blockStart, end);
  const lines = block.split("\n");
  let removedBeforeSelection = 0;
  let removedWithinSelection = 0;

  const nextLines = lines.map((line, index) => {
    if (line.startsWith("  ")) {
      if (index === 0) {
        removedBeforeSelection += 2;
      }
      removedWithinSelection += 2;
      return line.slice(2);
    }

    if (line.startsWith("\t")) {
      if (index === 0) {
        removedBeforeSelection += 1;
      }
      removedWithinSelection += 1;
      return line.slice(1);
    }

    return line;
  });

  if (removedWithinSelection === 0) {
    return {
      value,
      selectionStart: start,
      selectionEnd: end,
    };
  }

  const nextValue = `${value.slice(0, blockStart)}${nextLines.join("\n")}${value.slice(end)}`;
  return {
    value: nextValue,
    selectionStart: Math.max(blockStart, start - removedBeforeSelection),
    selectionEnd: Math.max(blockStart, end - removedWithinSelection),
  };
}

export function ConfigEditorModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [editorValue, setEditorValue] = useState("");
  const [initialValue, setInitialValue] = useState("");
  const [configPath, setConfigPath] = useState(DEFAULT_CONFIG_PATH);
  const [baseHash, setBaseHash] = useState<string | undefined>();
  const [loadedAtMs, setLoadedAtMs] = useState<number>(0);
  const [historyVersions, setHistoryVersions] = useState<ConfigVersion[]>([]);
  const [loadedHistoryVersion, setLoadedHistoryVersion] = useState<ConfigVersion | null>(null);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [validationError, setValidationError] = useState("");
  const [discardModalOpen, setDiscardModalOpen] = useState(false);

  const hasUnsavedChanges = editorValue !== initialValue;

  const resetState = useCallback(() => {
    setEditorValue("");
    setInitialValue("");
    setConfigPath(DEFAULT_CONFIG_PATH);
    setBaseHash(undefined);
    setLoadedAtMs(0);
    setHistoryVersions([]);
    setLoadedHistoryVersion(null);
    setHistoryPanelOpen(false);
    setLoading(false);
    setSaving(false);
    setLoadError("");
    setValidationError("");
    setDiscardModalOpen(false);
  }, []);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    setValidationError("");

    try {
      console.log("[Config] 读取核心配置");
      const snapshot = await gateway.getConfigEditorSnapshot();
      const normalizedRaw = snapshot.raw.replace(/\r\n/g, "\n");
      const now = Date.now();

      setEditorValue(normalizedRaw);
      setInitialValue(normalizedRaw);
      setConfigPath(snapshot.path?.trim() || DEFAULT_CONFIG_PATH);
      setBaseHash(snapshot.hash);
      setLoadedAtMs(now);
      setHistoryVersions(readConfigHistory());
      setLoadedHistoryVersion(null);
      focusTextarea(textareaRef.current);
    } catch (error) {
      const message = resolveErrorMessage(error, "读取核心配置失败，请检查 Gateway 连接");
      console.error("[Config] 读取核心配置失败:", error);
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      resetState();
      return;
    }

    void loadConfig();
  }, [loadConfig, open, resetState]);

  const closeModal = useCallback(() => {
    setHistoryPanelOpen(false);
    setDiscardModalOpen(false);
    onOpenChange(false);
  }, [onOpenChange]);

  const attemptClose = useCallback(() => {
    if (saving) {
      return;
    }

    if (hasUnsavedChanges) {
      setDiscardModalOpen(true);
      return;
    }

    closeModal();
  }, [closeModal, hasUnsavedChanges, saving]);

  const handleFormat = useCallback(() => {
    try {
      const formatted = formatJSONWithComments(editorValue);
      console.log("[Config] 格式优化完成");
      setEditorValue(formatted);
      setValidationError("");
      setLoadedHistoryVersion(null);
    } catch (error) {
      const message = resolveErrorMessage(error, "请先修复语法错误再格式化");
      console.error("[Config] 格式优化失败:", error);
      setValidationError(message);
      toast({
        title: "请先修复语法错误再格式化",
        description: message,
        variant: "destructive",
      });
    }
  }, [editorValue]);

  const handleSave = useCallback(async () => {
    if (loading || saving) {
      return;
    }

    if (!hasUnsavedChanges) {
      return;
    }

    let currentConfig: Record<string, unknown>;
    let nextConfig: Record<string, unknown>;

    try {
      currentConfig = parseJSONWithComments<Record<string, unknown>>(initialValue);
      nextConfig = parseJSONWithComments<Record<string, unknown>>(editorValue);

      if (!isConfigObject(currentConfig) || !isConfigObject(nextConfig)) {
        throw new Error("核心配置根节点必须是对象");
      }
    } catch (error) {
      const message = resolveErrorMessage(error, "JSON 语法错误，请检查后再保存");
      console.error("[Config] 保存前校验失败:", error);
      setValidationError(message);
      return;
    }

    setSaving(true);
    setValidationError("");

    try {
      const nextHistory = pushConfigHistoryVersion({
        content: initialValue,
        label: "保存前自动备份",
      });
      setHistoryVersions(nextHistory);

      // 这里按当前前端需求显式走 patch -> apply：
      // - patch 使用 merge patch 语义，能正确表达删除字段；
      // - apply 再把完整 JSON5 原文落盘，确保最终文件内容与编辑器一致。
      const patch = buildJsonMergePatch(currentConfig, nextConfig);

      console.log("[Config] 保存开始：config.patch");
      await gateway.patchConfig(JSON.stringify(patch, null, 2), {
        ...(baseHash ? { baseHash } : {}),
        note: "虾班核心配置编辑器保存补丁",
        restartDelayMs: 0,
      });

      console.log("[Config] 保存继续：config.apply");
      await gateway.applyConfig(editorValue, {
        note: "虾班核心配置编辑器应用完整配置",
        restartDelayMs: 0,
      });

      toast({
        title: "✅ 配置已保存并热加载",
        description: "openclaw.json 已更新，Gateway 正在应用新配置。",
      });
      closeModal();
    } catch (error) {
      const message = resolveErrorMessage(error, "保存失败，请稍后重试");
      console.error("[Config] 保存失败:", error);
      setValidationError(message);
      toast({
        title: "保存失败",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [baseHash, closeModal, editorValue, hasUnsavedChanges, initialValue, loading, saving]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleSave, open]);

  function handleDialogOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      attemptClose();
    }
  }

  function handleEditorKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab") {
      return;
    }

    event.preventDefault();

    const { selectionStart, selectionEnd, value } = event.currentTarget;
    const nextSelection = event.shiftKey
      ? outdentSelection(value, selectionStart, selectionEnd)
      : indentSelection(value, selectionStart, selectionEnd);

    setEditorValue(nextSelection.value);
    setLoadedHistoryVersion(null);

    requestAnimationFrame(() => {
      if (!textareaRef.current) {
        return;
      }

      textareaRef.current.selectionStart = nextSelection.selectionStart;
      textareaRef.current.selectionEnd = nextSelection.selectionEnd;
    });
  }

  function handleSelectHistoryVersion(version: ConfigVersion) {
    console.log("[Config] 加载历史版本:", version.id);
    setEditorValue(version.content);
    setLoadedHistoryVersion(version);
    setHistoryPanelOpen(false);
    setValidationError("");
    focusTextarea(textareaRef.current);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          className="h-[min(80vh,760px)] overflow-hidden rounded-[24px] border border-[var(--border)] p-0 text-[var(--color-text-primary)] backdrop-blur-2xl sm:max-w-[min(1180px,92vw)]"
          style={{
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--card) 96%, transparent), color-mix(in srgb, var(--panel-strong) 96%, transparent))",
            boxShadow: "var(--shadow-xl)",
          }}
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="border-b border-[var(--border)] px-6 py-5">
              <DialogHeader className="gap-2 text-left">
                <DialogTitle className="text-2xl tracking-tight">
                  ⚙️ 核心配置 — openclaw.json
                </DialogTitle>
                <DialogDescription className="text-[var(--color-text-secondary)]">
                  {configPath}
                </DialogDescription>
              </DialogHeader>
            </div>

            <div className="flex min-h-0 flex-1">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {loadedHistoryVersion ? (
                  <div className="mx-6 mt-4 rounded-2xl border border-[var(--color-brand)] bg-[var(--accent-subtle)] px-4 py-3 text-sm text-[var(--color-text-primary)]">
                    已加载历史版本（{formatConfigTimestamp(loadedHistoryVersion.timestamp)}
                    ），点击保存以应用
                  </div>
                ) : null}

                <div className="min-h-0 flex-1 px-6 py-5">
                  {loading ? (
                    <div className="flex h-full items-center justify-center rounded-[22px] border border-[var(--border)] bg-[var(--color-bg-card)]">
                      <div className="flex items-center gap-3 text-sm text-[var(--color-text-secondary)]">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        正在读取 openclaw.json...
                      </div>
                    </div>
                  ) : loadError ? (
                    <div className="flex h-full items-center justify-center rounded-[22px] border border-[var(--danger)] bg-[var(--danger-subtle)] px-6">
                      <div className="max-w-lg text-center">
                        <div className="text-base font-semibold text-[var(--danger)]">读取失败</div>
                        <p className="mt-2 text-sm leading-7 text-[var(--text)]">{loadError}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full flex-col rounded-[22px] border border-[var(--border)] bg-[var(--color-bg-card)]">
                      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                        <div className="text-xs uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
                          JSON5 编辑器
                        </div>
                        <div className="text-xs text-[var(--color-text-secondary)]">
                          支持注释、尾逗号、Tab 缩进
                        </div>
                      </div>

                      <textarea
                        ref={textareaRef}
                        value={editorValue}
                        onChange={(event) => {
                          setEditorValue(event.target.value);
                          setValidationError("");
                        }}
                        onKeyDown={handleEditorKeyDown}
                        spellCheck={false}
                        wrap="off"
                        className="min-h-0 flex-1 resize-none bg-[var(--bg-accent)] px-5 py-4 font-mono text-sm leading-7 text-[var(--color-text-primary)] outline-none"
                      />
                    </div>
                  )}
                </div>

                <div className="border-t border-[var(--border)] px-6 py-4">
                  {validationError ? (
                    <div className="mb-4 flex items-start gap-3 rounded-2xl border border-[var(--danger)] bg-[var(--danger-subtle)] px-4 py-3 text-sm text-[var(--text)]">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger)]" />
                      <div>{validationError}</div>
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setHistoryPanelOpen((current) => !current)}
                        disabled={loading}
                        className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <FolderClock className="h-4 w-4" />
                        加载历史版本
                      </button>

                      <div className="text-sm text-[var(--color-text-secondary)]">
                        当前版本载入时间：{loadedAtMs ? formatConfigTimestamp(loadedAtMs) : "--"}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={handleFormat}
                        disabled={loading || saving || Boolean(loadError)}
                        className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <WandSparkles className="h-4 w-4" />
                        格式优化
                      </button>

                      <button
                        type="button"
                        onClick={attemptClose}
                        disabled={saving}
                        className="inline-flex h-11 items-center rounded-xl border border-[var(--border)] bg-[var(--card)] px-5 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        取消
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          void handleSave();
                        }}
                        disabled={loading || saving || Boolean(loadError) || !hasUnsavedChanges}
                        className={cn(
                          "inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold text-[var(--accent-foreground)] transition-all disabled:cursor-not-allowed disabled:opacity-60",
                          hasUnsavedChanges
                            ? "bg-[var(--color-brand)] shadow-[var(--shadow-md)] hover:bg-[var(--color-brand-light)]"
                            : "bg-[var(--muted-strong)] hover:brightness-110",
                          hasUnsavedChanges ? "ring-2 ring-[var(--accent-glow)]" : "",
                        )}
                      >
                        {saving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        保存
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {historyPanelOpen ? (
                <ConfigHistoryPanel
                  versions={historyVersions}
                  selectedVersionId={loadedHistoryVersion?.id ?? null}
                  onSelect={handleSelectHistoryVersion}
                  onClose={() => setHistoryPanelOpen(false)}
                />
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={discardModalOpen}
        onClose={() => setDiscardModalOpen(false)}
        onConfirm={() => {
          closeModal();
        }}
        icon="⚠️"
        iconBgColor="bg-[var(--warn-subtle)]"
        iconTextColor="text-[var(--warn)]"
        title="未保存的修改"
        subtitle="关闭后当前编辑内容会丢失"
        description="你有未保存的配置修改，关闭后将丢失。"
        cancelText="继续编辑"
        cancelClassName="border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--accent-foreground)] hover:border-[var(--color-brand-light)] hover:bg-[var(--color-brand-light)]"
        confirmText="放弃修改"
        confirmColor="bg-[var(--muted-strong)] hover:brightness-110"
      />
    </>
  );
}
