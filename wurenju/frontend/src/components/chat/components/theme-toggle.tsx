// 复制自 openclaw 3.13 原版 ui/src/ui/app-render.helpers.ts 中的主题切换控件，用于二开定制

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/layout/useTheme";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn("theme-toggle", className)}
      aria-label="切换明暗主题"
      aria-checked={resolvedTheme === "dark"}
      role="switch"
    >
      <span className="theme-toggle__track">
        <Moon className="theme-toggle__icon theme-toggle__icon--moon" />
        <Sun className="theme-toggle__icon theme-toggle__icon--sun" />
        <span className="theme-toggle__thumb" />
      </span>
    </button>
  );
}
