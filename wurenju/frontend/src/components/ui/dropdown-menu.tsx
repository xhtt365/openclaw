"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type DropdownMenuSide = "top" | "right" | "bottom" | "left";
type DropdownMenuAlign = "start" | "center" | "end";

type DropdownMenuContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
};

const DropdownMenuContext = React.createContext<DropdownMenuContextValue | null>(null);

function useDropdownMenuContext() {
  const context = React.useContext(DropdownMenuContext);
  if (!context) {
    throw new Error("DropdownMenu 组件必须包在 <DropdownMenu> 内使用。");
  }

  return context;
}

function resolveDropdownPlacement({
  triggerRect,
  contentRect,
  side,
  align,
  collisionPadding,
}: {
  triggerRect: DOMRect;
  contentRect: DOMRect;
  side: DropdownMenuSide;
  align: DropdownMenuAlign;
  collisionPadding: number;
}) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const spaceTop = triggerRect.top - collisionPadding;
  const spaceBottom = viewportHeight - triggerRect.bottom - collisionPadding;
  const spaceLeft = triggerRect.left - collisionPadding;
  const spaceRight = viewportWidth - triggerRect.right - collisionPadding;
  let resolvedSide = side;
  let resolvedAlign = align;

  if (side === "bottom" && spaceBottom < contentRect.height && spaceTop > spaceBottom) {
    resolvedSide = "top";
  } else if (side === "top" && spaceTop < contentRect.height && spaceBottom > spaceTop) {
    resolvedSide = "bottom";
  } else if (side === "left" && spaceLeft < contentRect.width && spaceRight > spaceLeft) {
    resolvedSide = "right";
  } else if (side === "right" && spaceRight < contentRect.width && spaceLeft > spaceRight) {
    resolvedSide = "left";
  }

  if (resolvedSide === "left" || resolvedSide === "right") {
    if (align === "end" && spaceTop < contentRect.height && spaceBottom > spaceTop) {
      resolvedAlign = "start";
    } else if (align === "start" && spaceBottom < contentRect.height && spaceTop > spaceBottom) {
      resolvedAlign = "end";
    }
  } else if (resolvedSide === "top" || resolvedSide === "bottom") {
    if (align === "end" && spaceLeft < contentRect.width && spaceRight > spaceLeft) {
      resolvedAlign = "start";
    } else if (align === "start" && spaceRight < contentRect.width && spaceLeft > spaceRight) {
      resolvedAlign = "end";
    }
  }

  return {
    side: resolvedSide,
    align: resolvedAlign,
  };
}

function clampPosition(value: number, min: number, max: number) {
  if (min > max) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function resolveDropdownPosition({
  triggerRect,
  contentRect,
  side,
  align,
  sideOffset,
  collisionPadding,
}: {
  triggerRect: DOMRect;
  contentRect: DOMRect;
  side: DropdownMenuSide;
  align: DropdownMenuAlign;
  sideOffset: number;
  collisionPadding: number;
}) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let left = triggerRect.left;
  let top = triggerRect.bottom + sideOffset;

  if (side === "top") {
    top = triggerRect.top - contentRect.height - sideOffset;
  } else if (side === "left") {
    left = triggerRect.left - contentRect.width - sideOffset;
  } else if (side === "right") {
    left = triggerRect.right + sideOffset;
  }

  if (side === "top" || side === "bottom") {
    if (align === "center") {
      left = triggerRect.left + (triggerRect.width - contentRect.width) / 2;
    } else if (align === "end") {
      left = triggerRect.right - contentRect.width;
    }
  } else if (align === "center") {
    top = triggerRect.top + (triggerRect.height - contentRect.height) / 2;
  } else if (align === "end") {
    top = triggerRect.bottom - contentRect.height;
  } else {
    top = triggerRect.top;
  }

  return {
    left: clampPosition(
      left,
      collisionPadding,
      viewportWidth - collisionPadding - contentRect.width,
    ),
    top: clampPosition(
      top,
      collisionPadding,
      viewportHeight - collisionPadding - contentRect.height,
    ),
  };
}

function DropdownMenu({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  children,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const open = openProp ?? internalOpen;
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (openProp === undefined) {
        setInternalOpen(nextOpen);
      }

      onOpenChange?.(nextOpen);
    },
    [onOpenChange, openProp],
  );

  React.useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || contentRef.current?.contains(target)) {
        return;
      }

      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      setOpen(false);
      triggerRef.current?.focus();
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, setOpen]);

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen, triggerRef, contentRef }}>
      <div className="relative">{children}</div>
    </DropdownMenuContext.Provider>
  );
}

function DropdownMenuTrigger({
  className,
  onClick,
  children,
  ...props
}: React.ComponentProps<"button">) {
  const { open, setOpen, triggerRef } = useDropdownMenuContext();

  return (
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      data-state={open ? "open" : "closed"}
      className={className}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          setOpen(!open);
        }
      }}
      {...props}
    >
      {children}
    </button>
  );
}

function DropdownMenuContent({
  className,
  side = "bottom",
  align = "center",
  sideOffset = 6,
  collisionPadding = 8,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  side?: DropdownMenuSide;
  align?: DropdownMenuAlign;
  sideOffset?: number;
  collisionPadding?: number;
}) {
  const { open, triggerRef, contentRef } = useDropdownMenuContext();
  const [placement, setPlacement] = React.useState(() => ({
    side,
    align,
  }));
  const [position, setPosition] = React.useState<{
    left: number;
    top: number;
  } | null>(null);

  React.useLayoutEffect(() => {
    if (!open || !triggerRef.current || !contentRef.current) {
      return;
    }

    const updatePlacement = () => {
      if (!triggerRef.current || !contentRef.current) {
        return;
      }

      const triggerRect = triggerRef.current.getBoundingClientRect();
      const contentRect = contentRef.current.getBoundingClientRect();
      const nextPlacement = resolveDropdownPlacement({
        triggerRect,
        contentRect,
        side,
        align,
        collisionPadding,
      });
      setPlacement(nextPlacement);
      setPosition(
        resolveDropdownPosition({
          triggerRect,
          contentRect,
          side: nextPlacement.side,
          align: nextPlacement.align,
          sideOffset,
          collisionPadding,
        }),
      );
    };

    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [align, collisionPadding, open, side, sideOffset, triggerRef]);

  React.useEffect(() => {
    if (!open) {
      setPosition(null);
    }
  }, [open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={contentRef}
      role="menu"
      className={cn(
        "fixed z-[200] min-w-[176px] rounded-[14px] border border-[rgba(15,23,42,0.08)] bg-white p-2 shadow-[0_16px_40px_rgba(15,23,42,0.14),0_2px_8px_rgba(15,23,42,0.08)]",
        className,
      )}
      style={{
        left: position?.left ?? -9999,
        top: position?.top ?? -9999,
        visibility: position ? "visible" : "hidden",
      }}
      data-side={placement.side}
      data-align={placement.align}
      {...props}
    >
      {children}
    </div>,
    document.body,
  );
}

function DropdownMenuItem({
  className,
  inset = false,
  onClick,
  onSelect,
  children,
  ...props
}: React.ComponentProps<"button"> & {
  inset?: boolean;
  onSelect?: () => void;
}) {
  const { setOpen } = useDropdownMenuContext();

  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-[var(--color-text-primary)] outline-none transition-colors duration-150 hover:bg-[rgba(15,23,42,0.06)] focus-visible:bg-[rgba(15,23,42,0.06)]",
        inset ? "pl-8" : "",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) {
          return;
        }

        onSelect?.();
        setOpen(false);
      }}
      {...props}
    >
      {children}
    </button>
  );
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="separator"
      className={cn("my-1 h-px bg-[var(--color-border)]", className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
