"use client";

import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { ThemeContext, type ThemeMode } from "@/components/layout/useTheme";

const THEME_STORAGE_KEY = "theme";

function resolveInitialTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === "light" ? "light" : "dark";
}

function applyThemeClass(theme: ThemeMode) {
  const html = document.documentElement;
  const body = document.body;

  html.classList.remove("dark", "light");
  body.classList.remove("dark", "light");

  html.classList.add(theme);
  body.classList.add(theme);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => resolveInitialTheme());

  useLayoutEffect(() => {
    applyThemeClass(theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
      console.error("[Theme] 保存主题失败:", error);
    }
  }, [theme]);

  const setTheme = useCallback((nextTheme: ThemeMode) => {
    setThemeState(nextTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }, []);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme,
    }),
    [setTheme, theme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      <div className="min-h-screen bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
