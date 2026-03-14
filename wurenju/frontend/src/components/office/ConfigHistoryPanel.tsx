"use client"

import { Clock3, FolderClock, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ConfigVersion } from "@/types/config"
import { buildConfigPreview, formatConfigTimestamp } from "@/utils/configEditor"

export function ConfigHistoryPanel({
  versions,
  selectedVersionId,
  onSelect,
  onClose,
}: {
  versions: ConfigVersion[]
  selectedVersionId?: string | null
  onSelect: (version: ConfigVersion) => void
  onClose: () => void
}) {
  return (
    <aside className="flex h-full w-full max-w-[340px] shrink-0 flex-col border-l border-white/10 bg-black/20 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
            <FolderClock className="h-4 w-4 text-[var(--color-brand)]" />
            历史版本
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            点击任意版本可回填到编辑器，需再次保存才会生效
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-[var(--color-text-secondary)] transition-colors hover:bg-white/[0.08] hover:text-[var(--color-text-primary)]"
          aria-label="关闭历史版本面板"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {versions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 text-center">
            <Clock3 className="h-8 w-8 text-[var(--color-text-secondary)]" />
            <div className="mt-3 text-sm font-medium text-[var(--color-text-primary)]">
              还没有历史版本
            </div>
            <p className="mt-1 text-xs leading-6 text-[var(--color-text-secondary)]">
              每次保存前，当前配置都会自动备份到这里，最多保留 20 条。
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {versions.map((version) => (
              <button
                key={version.id}
                type="button"
                onClick={() => onSelect(version)}
                className={cn(
                  "w-full rounded-2xl border px-4 py-3 text-left transition-all",
                  selectedVersionId === version.id
                    ? "border-[var(--color-brand)] bg-[rgba(255,107,53,0.12)] shadow-[0_0_0_1px_rgba(255,107,53,0.18)]"
                    : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {formatConfigTimestamp(version.timestamp)}
                  </span>
                  {version.label ? (
                    <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
                      {version.label}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">
                  {buildConfigPreview(version.content) || "空内容"}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
