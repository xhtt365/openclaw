import { ArrowLeft, Expand, RefreshCw, Settings2, Shrink, SlidersHorizontal } from "lucide-react";

type TopBarProps = {
  isFullscreen: boolean;
  isRestarting: boolean;
  restartDisabled?: boolean;
  configDisabled?: boolean;
  onBack: () => void;
  onRestart: () => void;
  onOpenConfigEditor: () => void;
  onToggleFullscreen: () => void;
};

const ACTION_BUTTON_CLASS_NAME =
  "inline-flex h-10 items-center gap-2 rounded-2xl border border-[var(--modal-shell-border)] bg-[color-mix(in_srgb,var(--surface-glass-strong)_86%,transparent)] px-4 text-sm font-semibold text-[var(--color-text-primary)] shadow-[0_6px_18px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-150";

export function TopBar({
  isFullscreen,
  isRestarting,
  restartDisabled = false,
  configDisabled = false,
  onBack,
  onRestart,
  onOpenConfigEditor,
  onToggleFullscreen,
}: TopBarProps) {
  return (
    <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-[color-mix(in_srgb,var(--divider)_72%,transparent)] bg-[color-mix(in_srgb,var(--color-bg-primary)_78%,transparent)] px-5 backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--surface-soft-strong)] hover:text-[var(--color-text-primary)]"
          aria-label="返回主聊天页"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <div className="brand-gradient flex h-12 w-12 items-center justify-center rounded-2xl text-xl shadow-[0_12px_32px_var(--color-shadow-avatar)]">
          <span aria-hidden="true">🦞</span>
        </div>

        <div className="min-w-0">
          <div className="truncate text-[17px] font-semibold tracking-tight text-[var(--color-text-primary)]">
            虾班办公室 Lobster Office
          </div>
          <div className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">
            AI 员工总控台
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onRestart}
          disabled={restartDisabled}
          className={`${ACTION_BUTTON_CLASS_NAME} ${restartDisabled ? "cursor-not-allowed opacity-70" : "hover:border-[var(--surface-brand-border)] hover:bg-[var(--surface-brand-soft)]"}`}
        >
          <RefreshCw className={`h-4 w-4 ${isRestarting ? "animate-spin" : ""}`} />
          {isRestarting ? "重启中…" : "重启网关"}
        </button>
        <button
          type="button"
          onClick={onOpenConfigEditor}
          disabled={configDisabled}
          className={`${ACTION_BUTTON_CLASS_NAME} ${configDisabled ? "cursor-not-allowed opacity-70" : "hover:border-[var(--surface-brand-border)] hover:bg-[var(--surface-brand-soft)]"}`}
        >
          <Settings2 className="h-4 w-4" />
          核心配置
        </button>
        <button
          type="button"
          disabled
          className={`${ACTION_BUTTON_CLASS_NAME} cursor-not-allowed opacity-70`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          模型配置
        </button>
        <span
          className={`${ACTION_BUTTON_CLASS_NAME} border-[var(--surface-brand-border)] bg-[var(--surface-brand-soft)] text-[var(--surface-brand-text)] shadow-none`}
        >
          AI员工总控台
        </span>
        <button
          type="button"
          onClick={onToggleFullscreen}
          className={`${ACTION_BUTTON_CLASS_NAME} h-10 w-10 justify-center px-0`}
          aria-label={isFullscreen ? "退出全屏" : "进入全屏"}
        >
          {isFullscreen ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}
