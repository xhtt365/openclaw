"use client";

import { Copy, X } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getPromptWorkbenchGuide } from "@/constants/promptWorkbenchGuides";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { readLocalStorageItem, writeLocalStorageItem } from "@/utils/storage";

const GUIDE_COLLAPSE_STORAGE_PREFIX = "wurenju.promptWorkbench.guideCollapsed";

function getGuideCollapseStorageKey(fileName: string) {
  return `${GUIDE_COLLAPSE_STORAGE_PREFIX}.${fileName}`;
}

function readGuideCollapsed(fileName: string) {
  if (typeof window === "undefined") {
    return false;
  }

  return readLocalStorageItem(getGuideCollapseStorageKey(fileName)) === "1";
}

function writeGuideCollapsed(fileName: string, collapsed: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  if (!writeLocalStorageItem(getGuideCollapseStorageKey(fileName), collapsed ? "1" : "0")) {
    console.warn("[Storage] 写入指南折叠状态失败");
  }
}

function ReadonlyTemplateMarkdown({ content }: { content: string }) {
  return (
    <div
      className={cn(
        "text-sm leading-7 text-[var(--color-text-primary)]",
        "[&_h1]:mb-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:tracking-tight",
        "[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:tracking-[0.08em] [&_h2]:text-[var(--color-brand)]",
        "[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold",
        "[&_p]:my-3 [&_ul]:my-3 [&_ol]:my-3",
        "[&_ul]:ml-5 [&_ul]:list-disc [&_ol]:ml-5 [&_ol]:list-decimal",
        "[&_li]:my-1.5 [&_li]:text-[var(--color-text-primary)]",
        "[&_a]:text-[var(--color-brand)] [&_a]:underline [&_a]:underline-offset-4",
        "[&_strong]:font-semibold [&_strong]:text-[var(--color-text-primary)]",
        "[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-4 [&_blockquote]:text-[var(--color-text-secondary)]",
        "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-[18px] [&_pre]:border [&_pre]:border-[var(--color-border)] [&_pre]:bg-[var(--color-bg-code-block)] [&_pre]:p-4 [&_pre]:text-[13px] [&_pre]:leading-6",
        "[&_code]:font-mono [&_code]:text-[13px]",
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

export function PromptWorkbenchGuideCard({ fileName }: { fileName: string | null }) {
  const guide = getPromptWorkbenchGuide(fileName);
  const [collapsed, setCollapsed] = useState(() =>
    guide ? readGuideCollapsed(guide.fileName) : false,
  );
  const [templateOpen, setTemplateOpen] = useState(false);

  if (!guide) {
    return null;
  }

  const activeGuide = guide;

  async function handleCopyTemplate() {
    try {
      await navigator.clipboard.writeText(activeGuide.template);
      toast({
        title: "范本已复制",
        description: `${activeGuide.fileName} 的完整范本已复制到剪贴板`,
      });
    } catch {
      toast({
        title: "复制失败",
        description: "浏览器未能写入剪贴板，请稍后再试",
        variant: "destructive",
      });
    }
  }

  function toggleCollapsed() {
    const nextCollapsed = !collapsed;
    setCollapsed(nextCollapsed);
    writeGuideCollapsed(activeGuide.fileName, nextCollapsed);
  }

  return (
    <>
      <section
        className="border-b px-4 py-4"
        style={{
          borderColor: "color-mix(in srgb, var(--color-brand) 10%, var(--color-border))",
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--color-brand) 4%, var(--color-bg-card)) 0%, color-mix(in srgb, var(--color-bg-soft) 86%, var(--color-bg-card)) 100%)",
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-[var(--color-bg-brand-soft)] px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] text-[var(--color-brand)]">
                编写指南
              </span>
              <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                {activeGuide.fileName}
              </span>
            </div>

            {collapsed ? (
              <div className="mt-2 truncate text-sm text-[var(--color-text-secondary)]">
                {activeGuide.description}
              </div>
            ) : (
              <>
                <div className="mt-3 text-sm leading-7 text-[var(--color-text-primary)]">
                  <span className="mr-2 text-base" aria-hidden="true">
                    💡
                  </span>
                  <span className="font-semibold">{activeGuide.fileName}</span>
                  <span className="text-[var(--color-text-secondary)]">
                    {" "}
                    — {activeGuide.description}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <div
                    className="rounded-[18px] border border-[var(--color-border)] px-4 py-3"
                    style={{
                      background: "color-mix(in srgb, var(--ok) 10%, var(--color-bg-card))",
                    }}
                  >
                    <div className="text-sm font-semibold text-[var(--ok)]">✅ 要写</div>
                    <ul className="mt-2 space-y-1.5 text-sm leading-6 text-[var(--color-text-secondary)]">
                      {activeGuide.dos.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div
                    className="rounded-[18px] border border-[var(--color-border)] px-4 py-3"
                    style={{
                      background: "color-mix(in srgb, var(--color-brand) 7%, var(--color-bg-card))",
                    }}
                  >
                    <div className="text-sm font-semibold text-[var(--color-brand)]">❌ 不要写</div>
                    <ul className="mt-2 space-y-1.5 text-sm leading-6 text-[var(--color-text-secondary)]">
                      {activeGuide.donts.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex shrink-0 items-start gap-2">
            {!collapsed ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setTemplateOpen(true)}
                className="h-9 rounded-full border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
              >
                查看完整范本
              </Button>
            ) : null}

            <button
              type="button"
              onClick={toggleCollapsed}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] text-base text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
              aria-label={
                collapsed
                  ? `展开 ${activeGuide.fileName} 编写指南`
                  : `收起 ${activeGuide.fileName} 编写指南`
              }
              title={collapsed ? "展开编写指南" : "收起编写指南"}
            >
              <span aria-hidden="true">{collapsed ? "▾" : "▴"}</span>
            </button>
          </div>
        </div>
      </section>

      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[min(80vh,860px)] w-[min(600px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[24px] border-[var(--modal-shell-border)] bg-[var(--modal-shell-bg)] p-0 text-[var(--color-text-primary)] shadow-[var(--modal-shell-shadow)] backdrop-blur-xl sm:max-w-[600px]"
        >
          <div className="flex items-start justify-between gap-4 border-b border-[var(--modal-shell-border)] px-5 py-4">
            <DialogHeader className="min-w-0 gap-2 text-left">
              <DialogTitle className="text-xl tracking-tight">
                完整范本 · {activeGuide.fileName}
              </DialogTitle>
              <div className="text-sm leading-6 text-[var(--color-text-secondary)]">
                只读预览，复制后按需替换方括号里的占位内容。
              </div>
            </DialogHeader>

            <button
              type="button"
              onClick={() => setTemplateOpen(false)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
              aria-label="关闭范本弹窗"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <ReadonlyTemplateMarkdown content={activeGuide.template} />
          </div>

          <DialogFooter className="border-t border-[var(--modal-shell-border)] bg-[var(--surface-soft)] px-5 py-4 sm:justify-between">
            <div className="text-xs leading-6 text-[var(--color-text-secondary)]">
              复制的是纯文本 markdown，不会带上弹窗样式。
            </div>
            <Button
              type="button"
              onClick={() => {
                void handleCopyTemplate();
              }}
              className="h-10 rounded-xl bg-[var(--color-brand)] px-4 text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-light)]"
            >
              <Copy className="h-4 w-4" />
              复制范本
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
