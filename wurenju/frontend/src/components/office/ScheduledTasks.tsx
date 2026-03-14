import { memo } from "react"
import type { OfficeTaskItem, OfficeTaskStatus } from "@/stores/officeStore"

type ScheduledTasksProps = {
  tasks: OfficeTaskItem[]
}

function resolveStatusPill(status: OfficeTaskStatus) {
  if (status === "RUNNING") {
    return "bg-emerald-500/16 text-emerald-300"
  }

  if (status === "PAUSED") {
    return "bg-gray-500/16 text-gray-300"
  }

  return "bg-red-500/16 text-red-300"
}

function ScheduledTasksInner({ tasks }: ScheduledTasksProps) {
  const countText = `${tasks.length}/${tasks.length}`

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[24px] border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
        <h2 className="text-[22px] font-semibold tracking-tight text-[var(--color-text-primary)]">
          ⏰ 定时任务 Tasks
        </h2>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-[var(--color-text-secondary)]">
          {countText}
        </span>
      </div>

      <div className="im-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tasks.length > 0 ? (
          <div className="space-y-3">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                    {task.name}
                  </div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
                    {task.id}
                  </div>
                </div>
                <span
                  className={[
                    "rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide",
                    resolveStatusPill(task.status),
                  ].join(" ")}
                >
                  {task.status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-500/80">
            当前无定时任务
          </div>
        )}
      </div>
    </section>
  )
}

export const ScheduledTasks = memo(ScheduledTasksInner)
ScheduledTasks.displayName = "ScheduledTasks"
