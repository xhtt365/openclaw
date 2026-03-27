import { memo } from "react";
import { CronTaskList } from "@/components/cron/CronTaskList";
import { useCronStore } from "@/stores/cronStore";

function ScheduledTasksInner() {
  const jobs = useCronStore((state) => state.jobs);

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[24px] border border-[var(--modal-shell-border)] bg-[var(--surface-glass)] px-5 py-4 backdrop-blur-xl">
      <CronTaskList
        jobs={jobs}
        title="定时任务 Tasks"
        description={`当前共 ${jobs.length} 条任务，可在这里直接创建、暂停、恢复和删除。`}
        createLabel="新建定时任务"
        emptyText="当前无定时任务"
        showAgent
        className="h-full"
      />
    </section>
  );
}

export const ScheduledTasks = memo(ScheduledTasksInner);
ScheduledTasks.displayName = "ScheduledTasks";
