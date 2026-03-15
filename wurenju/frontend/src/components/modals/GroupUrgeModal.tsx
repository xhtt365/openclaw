import { AlertTriangle, Clock3, Pause, Play, Square, Target, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { GROUP_URGE_INTERVAL_OPTIONS } from "@/utils/groupUrge";

type GroupUrgeModalProps = {
  open: boolean;
  groupName: string;
  leaderName: string;
  isUrging: boolean;
  isPaused: boolean;
  intervalMinutes: number;
  urgeCount: number;
  selectedInterval: number;
  onSelectInterval: (minutes: number) => void;
  onClose: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
};

export function GroupUrgeModal({
  open,
  groupName,
  leaderName,
  isUrging,
  isPaused,
  intervalMinutes,
  urgeCount,
  selectedInterval,
  onSelectInterval,
  onClose,
  onStart,
  onPause,
  onResume,
  onStop,
}: GroupUrgeModalProps) {
  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-3xl overflow-hidden rounded-[28px] border border-white/12 bg-[rgba(8,8,12,0.94)] p-0 text-[var(--color-text-primary)] shadow-[0_28px_120px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
      >
        <div className="relative">
          <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top_left,rgba(251,146,60,0.24),transparent_58%),radial-gradient(circle_at_top_right,rgba(239,68,68,0.12),transparent_42%)]" />

          <div className="relative flex items-start justify-between gap-4 border-b border-white/8 px-6 pb-5 pt-6">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-orange-300/20 bg-[linear-gradient(135deg,rgba(251,146,60,0.30),rgba(249,115,22,0.18))] text-orange-100 shadow-[0_16px_40px_rgba(249,115,22,0.18)]">
                <Target className="h-6 w-6" />
              </div>

              <div className="min-w-0">
                <div className="text-[22px] font-semibold tracking-tight text-white">督促模式</div>
                <p className="mt-1 truncate text-sm text-[var(--color-text-secondary)]">
                  {groupName}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[var(--color-text-secondary)] transition-all duration-200 hover:border-white/16 hover:bg-white/[0.08] hover:text-white"
              aria-label="关闭督促模式弹窗"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-5 px-6 py-5">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-4">
                <div className="text-xs text-[var(--color-text-secondary)]">当前状态</div>
                <div
                  className={cn(
                    "mt-2 text-base font-semibold",
                    isUrging
                      ? isPaused
                        ? "text-amber-200"
                        : "text-red-300"
                      : "text-[var(--color-text-primary)]",
                  )}
                >
                  {isUrging ? (isPaused ? "已暂停" : "督促中") : "未开启"}
                </div>
              </div>

              <div className="rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-4">
                <div className="text-xs text-[var(--color-text-secondary)]">检查间隔</div>
                <div className="mt-2 flex items-center gap-2 text-base font-semibold text-[var(--color-text-primary)]">
                  <Clock3 className="h-4 w-4 text-orange-200" />
                  {isUrging ? intervalMinutes : selectedInterval} 分钟
                </div>
              </div>

              <div className="rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-4">
                <div className="text-xs text-[var(--color-text-secondary)]">督促者</div>
                <div className="mt-2 text-base font-semibold text-[var(--color-text-primary)]">
                  {leaderName}
                </div>
              </div>
            </div>

            {!isUrging ? (
              <>
                <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
                  <div className="text-sm font-semibold text-white">检查间隔</div>
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {GROUP_URGE_INTERVAL_OPTIONS.map((minutes) => {
                      const active = selectedInterval === minutes;
                      return (
                        <button
                          key={minutes}
                          type="button"
                          onClick={() => onSelectInterval(minutes)}
                          className={cn(
                            "inline-flex h-12 items-center justify-center rounded-2xl border text-sm font-semibold transition-all duration-200",
                            active
                              ? "border-orange-300/40 bg-[linear-gradient(135deg,#fb923c,#f97316)] text-white shadow-[0_14px_30px_rgba(249,115,22,0.28)]"
                              : "border-white/10 bg-white/[0.04] text-[var(--color-text-primary)] hover:border-orange-300/20 hover:bg-orange-500/10",
                          )}
                        >
                          {minutes}分钟
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-xs leading-6 text-[var(--color-text-secondary)]">
                    推荐使用 10 分钟，轻量级的督促更有效
                  </p>
                </div>

                <div className="rounded-[24px] border border-orange-300/16 bg-[linear-gradient(135deg,rgba(255,247,237,0.95),rgba(255,237,213,0.88))] px-5 py-4 text-zinc-900">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <AlertTriangle className="h-4 w-4 text-orange-500" />
                    <span>督促模式是什么？</span>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-zinc-700">
                    督促者会定期检查项目进度，在卡点时推动团队，完成后汇报总结。
                  </p>
                  <ul className="mt-3 space-y-2 text-sm text-zinc-700">
                    <li>AI 判断：不是关键词匹配</li>
                    <li>拿不准就问：不确定就确认</li>
                    <li>简短汇报：不啰嗦</li>
                  </ul>
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-white/8 pt-5">
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-5 text-sm font-medium text-[var(--color-text-primary)] transition-all duration-200 hover:border-white/16 hover:bg-white/[0.08]"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={onStart}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#fb923c,#f97316)] px-5 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(249,115,22,0.32)] transition-all duration-200 hover:brightness-110 active:scale-[0.98]"
                  >
                    <Target className="h-4 w-4" />
                    开启督促
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-[24px] border border-white/10 bg-white/[0.03] px-5 py-4">
                    <div className="text-xs text-[var(--color-text-secondary)]">当前间隔</div>
                    <div className="mt-2 text-2xl font-semibold text-white">
                      {intervalMinutes} 分钟
                    </div>
                  </div>
                  <div className="rounded-[24px] border border-white/10 bg-white/[0.03] px-5 py-4">
                    <div className="text-xs text-[var(--color-text-secondary)]">已督促次数</div>
                    <div className="mt-2 text-2xl font-semibold text-white">{urgeCount}</div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/10 bg-white/[0.03] px-5 py-4 text-sm leading-7 text-[var(--color-text-secondary)]">
                  {isPaused
                    ? "当前已暂停，恢复后会从新的间隔周期重新开始检查。"
                    : "当前正在按设定间隔检查未发言成员，发现卡点时会由群主自动发起督促。"}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/8 pt-5">
                  <button
                    type="button"
                    onClick={onPause}
                    disabled={isPaused}
                    className={cn(
                      "inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-5 text-sm font-medium transition-all duration-200",
                      isPaused
                        ? "cursor-not-allowed border-white/10 bg-white/[0.03] text-[var(--color-text-secondary)] opacity-50"
                        : "border-white/10 bg-white/[0.04] text-[var(--color-text-primary)] hover:border-white/16 hover:bg-white/[0.08]",
                    )}
                  >
                    <Pause className="h-4 w-4" />
                    暂停
                  </button>
                  <button
                    type="button"
                    onClick={onResume}
                    disabled={!isPaused}
                    className={cn(
                      "inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-5 text-sm font-medium transition-all duration-200",
                      !isPaused
                        ? "cursor-not-allowed border-white/10 bg-white/[0.03] text-[var(--color-text-secondary)] opacity-50"
                        : "border-emerald-300/20 bg-emerald-500/10 text-emerald-100 hover:border-emerald-300/35 hover:bg-emerald-500/18",
                    )}
                  >
                    <Play className="h-4 w-4" />
                    恢复
                  </button>
                  <button
                    type="button"
                    onClick={onStop}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-red-300/20 bg-red-500/10 px-5 text-sm font-medium text-red-100 transition-all duration-200 hover:border-red-300/35 hover:bg-red-500/18"
                  >
                    <Square className="h-4 w-4" />
                    关闭督促
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
