import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const themeProviderSource = readFileSync(
  new URL("../components/layout/ThemeProvider.tsx", import.meta.url),
  "utf8",
);
const indexCss = readFileSync(new URL("../index.css", import.meta.url), "utf8");

void test("ThemeProvider 在没有旧缓存时默认回到浅色主题", () => {
  assert.match(themeProviderSource, /return readStoredThemePreference\(\) \?\? "light";/);
  assert.match(
    themeProviderSource,
    /const resolvedTheme = theme === "system" \? systemTheme : theme;/,
  );
});

void test("index.css 的浅色主题恢复白底主面和中性灰 hover", () => {
  assert.match(indexCss, /--bg-main:\s*#ffffff;/);
  assert.match(indexCss, /--bg-hover:\s*#f3f2ee;/);
  assert.match(indexCss, /--text-primary:\s*#1f1c18;/);
  assert.match(indexCss, /--workbench-shell-bg:/);
  assert.match(indexCss, /--workbench-panel-bg:/);
  assert.match(indexCss, /--workbench-glass-bg:\s*rgba\(255,\s*252,\s*247,\s*0\.84\);/);
});

void test("index.css 的深色主题去掉紫调，改为中性深色面", () => {
  assert.match(indexCss, /--bg-main:\s*#1a1814;/);
  assert.match(indexCss, /--bg-hover:\s*#2a2721;/);
  assert.match(indexCss, /--bubble-agent-bg:\s*#221f1a;/);
  assert.match(
    indexCss,
    /--workbench-panel-bg:\s*linear-gradient\(180deg,\s*#211d18 0%,\s*#1a1713 100%\);/,
  );
  assert.match(indexCss, /--workbench-pill-border:\s*rgba\(255,\s*255,\s*255,\s*0\.08\);/);
});

void test("index.css 的聊天全屏会把左侧导航的 flex 宽度一起归零", () => {
  assert.match(indexCss, /\.app-layout__sidebar\s*\{[\s\S]*flex-basis:\s*var\(--sidebar-w\);/);
  assert.match(
    indexCss,
    /\.app-layout--chat-fullscreen \.app-layout__sidebar\s*\{[\s\S]*flex:\s*0 0 0;[\s\S]*flex-basis:\s*0;[\s\S]*max-width:\s*0;/,
  );
});

void test("主题切换时会临时关闭全局过渡，减少明暗切换卡顿", () => {
  assert.match(themeProviderSource, /data-theme-switching/);
  assert.match(
    indexCss,
    /html\[data-theme-switching="true"\] \*,[\s\S]*transition:\s*none !important;/,
  );
});
