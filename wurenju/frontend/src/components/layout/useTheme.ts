"use client";

import { createContext, useContext } from "react";

export type ResolvedThemeMode = "dark" | "light";
export type ThemeMode = "system" | ResolvedThemeMode;

export interface ThemeContextValue {
  theme: ThemeMode;
  resolvedTheme: ResolvedThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme 必须在 ThemeProvider 内使用");
  }

  return context;
}
