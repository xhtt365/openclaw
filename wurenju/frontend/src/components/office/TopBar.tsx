import { ArrowLeft, Expand, RefreshCw, Settings2, Shrink, SlidersHorizontal } from "lucide-react"

type TopBarProps = {
  isFullscreen: boolean
  isRestarting: boolean
  restartDisabled?: boolean
  onBack: () => void
  onRestart: () => void
  onToggleFullscreen: () => void
}

const ACTION_BUTTON_CLASS_NAME =
  "inline-flex h-11 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-[var(--color-text-primary)] shadow-[0_12px_30px_rgba(15,23,42,0.12)] transition-all duration-150"

export function TopBar({
  isFullscreen,
  isRestarting,
  restartDisabled = false,
  onBack,
  onRestart,
  onToggleFullscreen,
}: TopBarProps) {
  return (
    <header className="flex h-20 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-6">
      <div className="flex min-w-0 items-center gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors hover:bg-white/6 hover:text-[var(--color-text-primary)]"
          aria-label="返回主聊天页"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <div className="brand-gradient flex h-12 w-12 items-center justify-center rounded-2xl text-xl shadow-[0_12px_32px_var(--color-shadow-avatar)]">
          <span aria-hidden="true">🦞</span>
        </div>

        <div className="min-w-0">
          <div className="truncate text-[28px] font-bold tracking-tight text-[var(--color-text-primary)]">
            龙虾办公室 Lobster Office
          </div>
          <div className="mt-1 truncate text-sm text-[var(--color-text-secondary)]">
            🦞 AI 员工总控台
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onRestart}
          disabled={restartDisabled}
          className={`${ACTION_BUTTON_CLASS_NAME} ${restartDisabled ? "cursor-not-allowed opacity-70" : "hover:border-white/20 hover:bg-white/[0.08]"}`}
        >
          <RefreshCw className={`h-4 w-4 ${isRestarting ? "animate-spin" : ""}`} />
          {isRestarting ? "重启中…" : "重启网关"}
        </button>
        <button type="button" disabled className={`${ACTION_BUTTON_CLASS_NAME} cursor-not-allowed opacity-70`}>
          <Settings2 className="h-4 w-4" />
          核心配置
        </button>
        <button type="button" disabled className={`${ACTION_BUTTON_CLASS_NAME} cursor-not-allowed opacity-70`}>
          <SlidersHorizontal className="h-4 w-4" />
          模型配置
        </button>
        <div className="mx-1 h-8 w-px bg-white/10" />
        <button
          type="button"
          onClick={onToggleFullscreen}
          className={`${ACTION_BUTTON_CLASS_NAME} px-3`}
          aria-label={isFullscreen ? "退出全屏" : "进入全屏"}
        >
          {isFullscreen ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
        </button>
      </div>
    </header>
  )
}
