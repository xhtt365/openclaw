import { memo, type ReactNode } from "react";

type ZoneContainerProps = {
  title: string;
  count: number;
  emptyText: string;
  hasItems: boolean;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
};

function ZoneContainerInner({
  title,
  count,
  emptyText,
  hasItems,
  className = "",
  contentClassName = "",
  children,
}: ZoneContainerProps) {
  return (
    <section
      className={[
        "flex min-h-0 flex-col rounded-[24px] border border-[var(--modal-shell-border)] bg-[var(--surface-glass)] p-4 backdrop-blur-xl",
        className,
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[22px] font-semibold tracking-tight text-[var(--color-text-primary)]">
          {title}
        </h2>
        <span className="rounded-full bg-[var(--surface-soft-strong)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)]">
          {count}
        </span>
      </div>

      <div className="mt-4 min-h-0 flex-1">
        {hasItems ? (
          <div className={["im-scroll h-full overflow-y-auto", contentClassName].join(" ")}>
            {children}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-secondary)]">
            {emptyText}
          </div>
        )}
      </div>
    </section>
  );
}

export const ZoneContainer = memo(ZoneContainerInner);
ZoneContainer.displayName = "ZoneContainer";
