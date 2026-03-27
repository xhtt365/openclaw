"use client";

import type { ReactNode } from "react";
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
  children?: ReactNode;
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
  children,
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
        className="max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-0 text-[var(--text-strong)] shadow-[var(--shadow-xl)]"
      >
        <div className="space-y-6 p-6">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-xl",
                iconBgColor,
                iconTextColor,
              )}
            >
              <span aria-hidden="true">{icon}</span>
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-[var(--text-strong)]">{title}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{subtitle}</p>
            </div>
          </div>

          <p className="text-sm leading-6 text-[var(--text)]">{description}</p>

          {children ? <div className="space-y-3">{children}</div> : null}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className={cn(
                "inline-flex h-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-content)] px-5 text-sm font-medium text-[var(--text)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50",
                cancelClassName,
              )}
            >
              {cancelText}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className={cn(
                "inline-flex h-10 min-w-[112px] items-center justify-center gap-2 rounded-lg px-5 text-sm font-medium text-[var(--accent-foreground)] shadow-[var(--shadow-sm)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:brightness-100",
                confirmColor,
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
