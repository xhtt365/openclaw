"use client";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
  icon: string;
  iconBgColor: string;
  iconTextColor: string;
  title: string;
  subtitle: string;
  description: string;
  cancelText?: string;
  cancelClassName?: string;
  confirmText: string;
  confirmColor: string;
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  loading = false,
  icon,
  iconBgColor,
  iconTextColor,
  title,
  subtitle,
  description,
  cancelText = "取消",
  cancelClassName,
  confirmText,
  confirmColor,
}: ConfirmModalProps) {
  function handleOpenChange(nextOpen: boolean) {
    if (loading) {
      return;
    }

    if (!nextOpen) {
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-sm rounded-2xl border border-gray-200 bg-white p-0 text-gray-900 shadow-[0_24px_80px_rgba(15,23,42,0.18)] dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
      >
        <div className="space-y-6 p-6">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-gray-200 text-xl dark:border-white/10",
                iconBgColor,
                iconTextColor
              )}
            >
              <span aria-hidden="true">{icon}</span>
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{title}</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">{subtitle}</p>
            </div>
          </div>

          <p className="text-sm leading-6 text-gray-700 dark:text-zinc-300">{description}</p>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className={cn(
                "inline-flex h-10 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 px-5 text-sm font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-800",
                cancelClassName
              )}
            >
              {cancelText}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className={cn(
                "inline-flex h-10 min-w-[112px] items-center justify-center gap-2 rounded-lg px-5 text-sm font-medium text-white shadow-sm transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:brightness-100",
                confirmColor
              )}
            >
              {loading ? (
                <>
                  <Spinner className="h-4 w-4" />
                  处理中…
                </>
              ) : (
                confirmText
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
