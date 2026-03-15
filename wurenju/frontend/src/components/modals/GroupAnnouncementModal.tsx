import { Megaphone, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type GroupAnnouncementModalProps = {
  open: boolean;
  groupName: string;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
};

const MAX_ANNOUNCEMENT_LENGTH = 1000;

export function GroupAnnouncementModal({
  open,
  groupName,
  value,
  onChange,
  onClose,
  onSave,
}: GroupAnnouncementModalProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }

      textarea.focus();
      const cursor = textarea.value.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  }, [open, value, groupName]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      onClose();
    }
  }

  function handleSave() {
    onSave();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-3xl overflow-hidden rounded-[28px] border border-white/12 bg-[rgba(8,8,12,0.92)] p-0 text-[var(--color-text-primary)] shadow-[0_28px_120px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
      >
        <div className="relative">
          <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.22),transparent_58%),radial-gradient(circle_at_top_right,rgba(244,114,182,0.12),transparent_42%)]" />

          <div className="relative flex items-start justify-between gap-4 border-b border-white/8 px-6 pb-5 pt-6">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-amber-300/20 bg-[linear-gradient(135deg,rgba(251,191,36,0.32),rgba(249,115,22,0.22))] text-amber-200 shadow-[0_16px_40px_rgba(249,115,22,0.18)]">
                <Megaphone className="h-6 w-6" />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[22px] font-semibold tracking-tight text-white">
                    群公告
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-[var(--color-text-secondary)]">
                    运行时注入
                  </span>
                </div>
                <p className="mt-1 truncate text-sm text-[var(--color-text-secondary)]">
                  {groupName}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[var(--color-text-secondary)] transition-all duration-200 hover:border-white/16 hover:bg-white/[0.08] hover:text-white"
              aria-label="关闭群公告弹窗"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-6 py-5">
            <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl">
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(event) => {
                  onChange(event.target.value.slice(0, MAX_ANNOUNCEMENT_LENGTH));
                }}
                placeholder="请输入群公告内容，例如项目规范、沟通约定、交付要求。"
                rows={11}
                className="im-scroll min-h-[320px] w-full resize-none bg-transparent text-[15px] leading-8 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]"
              />
            </div>

            <div className="mt-3 flex items-center justify-between gap-4">
              <p className="text-xs leading-6 text-[var(--color-text-secondary)]">
                公告仅在群聊发消息时注入给 Agent 参考，不会额外写入聊天记录。
              </p>
              <span
                className={cn(
                  "shrink-0 text-xs tabular-nums text-[var(--color-text-secondary)]",
                  value.length >= MAX_ANNOUNCEMENT_LENGTH ? "text-amber-200" : "",
                )}
              >
                {value.length}/{MAX_ANNOUNCEMENT_LENGTH}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-white/8 px-6 py-5">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-5 text-sm font-medium text-[var(--color-text-primary)] transition-all duration-200 hover:border-white/16 hover:bg-white/[0.08]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#f59e0b,#f97316)] px-5 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(249,115,22,0.32)] transition-all duration-200 hover:brightness-110 active:scale-[0.98]"
            >
              保存公告
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
