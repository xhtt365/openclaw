"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ThemeContext, type ResolvedThemeMode, type ThemeMode } from "@/components/layout/useTheme";
import {
  readLocalStorageItem,
  removeLocalStorageItem,
  writeLocalStorageItem,
} from "@/utils/storage";

const THEME_STORAGE_KEY = "xiaban_theme";
const LEGACY_THEME_STORAGE_KEY = "theme";
const THEME_SWITCHING_ATTRIBUTE = "data-theme-switching";

function readStoredThemePreference(): ThemeMode | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storedTheme =
    readLocalStorageItem(THEME_STORAGE_KEY) ?? readLocalStorageItem(LEGACY_THEME_STORAGE_KEY);
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
  // 新用户首次进入默认使用浅色白底，旧缓存主题保持原样。
  return readStoredThemePreference() ?? "light";
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

function suppressThemeTransitions() {
  if (typeof window === "undefined") {
    return () => {};
  }

  const html = document.documentElement;
  html.setAttribute(THEME_SWITCHING_ATTRIBUTE, "true");

  let cleared = false;
  const clear = () => {
    if (cleared) {
      return;
    }

    cleared = true;
    html.removeAttribute(THEME_SWITCHING_ATTRIBUTE);
  };

  const frameId = window.requestAnimationFrame(() => {
    window.setTimeout(clear, 160);
  });

  return () => {
    window.cancelAnimationFrame(frameId);
    clear();
  };
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => resolveInitialTheme());
  const [systemTheme, setSystemTheme] = useState<ResolvedThemeMode>(() => resolveSystemTheme());
  const resolvedTheme = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    if (typeof window === "undefined" || theme !== "system") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? "dark" : "light");
    };

    media.addEventListener("change", handleChange);
    return () => {
      media.removeEventListener("change", handleChange);
    };
  }, [theme]);

  useLayoutEffect(() => {
    const restoreTransitions = suppressThemeTransitions();
    applyThemeClass(resolvedTheme);
    return restoreTransitions;
  }, [resolvedTheme]);

  useEffect(() => {
    if (!writeLocalStorageItem(THEME_STORAGE_KEY, theme)) {
      console.error("[Theme] 保存主题失败");
      return;
    }
    removeLocalStorageItem(LEGACY_THEME_STORAGE_KEY);
  }, [theme]);

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
