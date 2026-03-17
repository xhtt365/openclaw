"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ThemeContext, type ResolvedThemeMode, type ThemeMode } from "@/components/layout/useTheme";

const THEME_STORAGE_KEY = "xiaban_theme";
const LEGACY_THEME_STORAGE_KEY = "theme";

function readStoredThemePreference(): ThemeMode | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storedTheme =
    window.localStorage.getItem(THEME_STORAGE_KEY) ??
    window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
  return storedTheme === "system" || storedTheme === "light" || storedTheme === "dark"
    ? storedTheme
    : null;
}

function resolveSystemTheme(): ResolvedThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveInitialTheme(): ThemeMode {
  return readStoredThemePreference() ?? "dark";
}

function resolveThemeMode(mode: ThemeMode): ResolvedThemeMode {
  return mode === "system" ? resolveSystemTheme() : mode;
}

function applyThemeClass(theme: ResolvedThemeMode) {
  const html = document.documentElement;
  const body = document.body;

  html.classList.remove("dark", "light");
  body.classList.remove("dark", "light");

  html.classList.add(theme);
  body.classList.add(theme);
  html.dataset.theme = theme;
  html.dataset.themeMode = theme;
  body.dataset.theme = theme;
  html.style.colorScheme = theme;
  body.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => resolveInitialTheme());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedThemeMode>(() =>
    resolveThemeMode(resolveInitialTheme()),
  );

  useEffect(() => {
    if (typeof window === "undefined" || theme !== "system") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setResolvedTheme(event.matches ? "dark" : "light");
    };

    media.addEventListener("change", handleChange);
    return () => {
      media.removeEventListener("change", handleChange);
    };
  }, [theme]);

  useEffect(() => {
    setResolvedTheme(resolveThemeMode(theme));
  }, [theme]);

  useLayoutEffect(() => {
    applyThemeClass(resolvedTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    } catch (error) {
      console.error("[Theme] 保存主题失败:", error);
    }
  }, [resolvedTheme, theme]);

  const setTheme = useCallback((nextTheme: ThemeMode) => {
    setThemeState(nextTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((currentTheme) => {
      const currentResolved = resolveThemeMode(currentTheme);
      return currentResolved === "dark" ? "light" : "dark";
    });
  }, []);

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      toggleTheme,
    }),
    [resolvedTheme, setTheme, theme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      <div className="min-h-screen bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
