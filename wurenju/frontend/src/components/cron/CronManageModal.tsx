"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GatewayCronJob } from "@/services/gateway";
import { type XiabanCronReplyMode } from "@/utils/cronTask";
import { CronTaskList } from "./CronTaskList";

type CronManageModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  jobs: GatewayCronJob[];
  emptyText: string;
  createLabel?: string;
  showAgent?: boolean;
  lockedAgentId?: string | null;
  defaultReplyMode?: XiabanCronReplyMode;
  defaultGroupId?: string | null;
};

export function CronManageModal({
  open,
  onOpenChange,
  title,
  description,
  jobs,
  emptyText,
  createLabel = "新建定时任务",
  showAgent = false,
  lockedAgentId = null,
  defaultReplyMode = "direct",
  defaultGroupId = null,
}: CronManageModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] w-[min(920px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[24px] border-[var(--modal-shell-border)] bg-[var(--modal-shell-bg)] p-0 text-[var(--color-text-primary)] shadow-[var(--modal-shell-shadow)] backdrop-blur-xl sm:max-w-[920px]">
        <div className="border-b border-[var(--modal-shell-border)] px-5 py-4">
          <DialogHeader className="gap-2 text-left">
            <DialogTitle className="text-xl">{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
        </div>

        <div className="min-h-0 flex-1 px-5 py-4">
          <CronTaskList
            jobs={jobs}
            emptyText={emptyText}
            createLabel={createLabel}
            showAgent={showAgent}
            lockedAgentId={lockedAgentId}
            defaultReplyMode={defaultReplyMode}
            defaultGroupId={defaultGroupId}
            className="h-full"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
