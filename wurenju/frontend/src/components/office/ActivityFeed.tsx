import { AnimatePresence, motion } from "framer-motion";
import { memo } from "react";
import type { OfficeActivityItem, OfficeActivityType } from "@/stores/officeStore";

type ActivityFeedProps = {
  items: OfficeActivityItem[];
  connected: boolean;
};

function formatClock(time: number) {
  return new Date(time).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function resolveColor(type: OfficeActivityType) {
  if (type === "executing") {
    return "text-[var(--status-working)]";
  }

  if (type === "done") {
    return "text-[var(--status-online)]";
  }

  if (type === "error") {
    return "text-[var(--status-error)]";
  }

  if (type === "system") {
    return "text-[var(--info)]";
  }

  return "text-[var(--color-text-secondary)]";
}

function ActivityFeedInner({ items, connected }: ActivityFeedProps) {
  return (
    <section className="flex h-full min-h-0 flex-1 flex-col rounded-[24px] border border-[var(--modal-shell-border)] bg-[var(--surface-glass)] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-[var(--divider)] px-5 py-4">
        <h2 className="text-[22px] font-semibold tracking-tight text-[var(--color-text-primary)]">
          ✨ 动态 Activity
        </h2>
        <span
          className={connected ? "h-3 w-3 animate-pulse rounded-full" : "h-3 w-3 rounded-full"}
          style={{
            backgroundColor: connected ? "var(--status-online)" : "var(--status-idle)",
            boxShadow: connected ? "0 0 14px var(--surface-success-border)" : "none",
          }}
        />
      </div>

      <div className="im-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {items.length > 0 ? (
          <AnimatePresence initial={false}>
            <div className="space-y-3">
              {items.map((item) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="text-sm leading-6 text-[var(--color-text-primary)]"
                >
                  <span className="mr-3 text-[13px] tabular-nums text-[var(--color-text-secondary)]">
                    [{formatClock(item.time)}]
                  </span>
                  <span className={resolveColor(item.type)}>
                    {item.agentName} {item.text}
                  </span>
                </motion.div>
              ))}
            </div>
          </AnimatePresence>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-secondary)]">
            当前暂无动态日志
          </div>
        )}
      </div>
    </section>
  );
}

export const ActivityFeed = memo(ActivityFeedInner);
ActivityFeed.displayName = "ActivityFeed";
