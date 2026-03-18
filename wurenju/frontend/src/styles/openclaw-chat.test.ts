import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./openclaw-chat.css", import.meta.url), "utf8");

void test("openclaw-chat.css 保留迁移聊天区的关键样式", () => {
  assert.match(css, /\.agent-chat__file-input\s*\{/);
  assert.match(css, /\.chat-focus-exit\s*\{/);
  assert.match(css, /\.chat-tool-msg-summary__icon\s*\{/);
  assert.match(css, /\.chat-tools-summary__icon\s*\{/);
});

void test("openclaw-chat.css 的发送按钮跟随虾班主红色变量", () => {
  assert.match(css, /--openclaw-chat-send-accent:\s*var\(--brand-primary\);/);
  assert.match(css, /background:\s*var\(--openclaw-chat-send-accent,\s*var\(--accent\)\);/);
  assert.match(css, /color:\s*var\(--text-inverse\);/);
});

void test("openclaw-chat.css 的顶部三个下拉框使用等宽网格布局", () => {
  assert.match(
    css,
    /\.chat-controls__session-row\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/,
  );
  assert.match(css, /\.chat-controls__dropdown select\s*\{/);
  assert.match(
    css,
    /\.field input,[\s\S]*\.field select\s*\{[\s\S]*min-height:\s*var\(--chat-workbench-control-height\);/,
  );
});

void test("openclaw-chat.css 的群聊顶栏成员信息紧贴群名，群公告按钮走工作台控件风格", () => {
  assert.match(css, /\.surface-group-topbar__members\s*\{[\s\S]*gap:\s*4px;/);
  assert.match(
    css,
    /\.surface-chat-pill\s*\{[\s\S]*border:\s*1px solid var\(--chat-workbench-control-border\);/,
  );
  assert.match(css, /\.surface-chat-pill\s*\{[\s\S]*box-shadow:\s*var\(--shadow-sm\);/);
  assert.match(
    css,
    /\.surface-chat-pill--active\s*\{[\s\S]*box-shadow:\s*var\(--chat-workbench-control-shadow\);/,
  );
  assert.match(
    css,
    /\.surface-chat-pill--announcement\s*\{[\s\S]*border-color:\s*var\(--brand-primary\);[\s\S]*color:\s*var\(--brand-primary\);/,
  );
  assert.match(
    css,
    /\.surface-chat-pill--urge\s*\{[\s\S]*background:\s*var\(--brand-primary\);[\s\S]*color:\s*var\(--text-inverse\);/,
  );
});

void test("openclaw-chat.css 的群聊输入区保留快捷提及横向滚动，并沿用工作台输入面板底色", () => {
  assert.match(
    css,
    /\.agent-chat__input\s*\{[\s\S]*overflow:\s*visible;[\s\S]*background:\s*var\(--workbench-panel-bg-strong\);/,
  );
  assert.match(
    css,
    /\.surface-group-quick-mentions\s*\{[\s\S]*flex:\s*1 1 auto;[\s\S]*overflow-x:\s*auto;/,
  );
  assert.match(
    css,
    /\.surface-group-quick-mentions__chip\s*\{[\s\S]*background:\s*transparent;[\s\S]*font-size:\s*12px;/,
  );
});

void test("openclaw-chat.css 的群聊三点菜单使用细点触发器和 180px 下拉面板", () => {
  assert.match(css, /\.surface-group-more__dot\s*\{[\s\S]*width:\s*3px;[\s\S]*height:\s*3px;/);
  assert.match(css, /\.surface-group-more__menu\s*\{[\s\S]*z-index:\s*1000;/);
  assert.match(css, /\.surface-group-more__menu\s*\{[\s\S]*width:\s*180px;/);
  assert.match(
    css,
    /\.surface-group-more__menu\s*\{[\s\S]*background:\s*var\(--chat-workbench-control-bg-strong\);/,
  );
  assert.match(css, /\.surface-group-more__item-icon\s*\{/);
});

void test("openclaw-chat.css 的群聊 @成员名 在浅色和深色主题里都保持更高对比高亮", () => {
  assert.match(
    css,
    /\.group-input-mention\s*\{[\s\S]*border:\s*1px solid color-mix\(in srgb,\s*var\(--accent\)\s*20%,\s*transparent\);/,
  );
  assert.match(
    css,
    /\.group-message-mention\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*#ffffff\s*88%,\s*var\(--workbench-panel-bg-strong\)\s*12%\);/,
  );
  assert.match(
    css,
    /\.group-message-mention\s*\{[\s\S]*color:\s*color-mix\(in srgb,\s*var\(--accent\)\s*74%,\s*var\(--text-strong\)\s*26%\);/,
  );
  assert.match(
    css,
    /\.group-message-mention\s*\{[\s\S]*box-shadow:\s*inset 0 0 0 1px color-mix\(in srgb,\s*var\(--accent\)\s*22%,\s*transparent\);/,
  );
  assert.match(
    css,
    /\.chat-group\.user \.group-message-mention\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*#ffffff\s*20%,\s*transparent\);/,
  );
  assert.match(
    css,
    /\.chat-group\.user \.group-message-mention\s*\{[\s\S]*color:\s*color-mix\(in srgb,\s*#ffffff\s*94%,\s*var\(--text-inverse\)\s*6%\);/,
  );
});

void test("openclaw-chat.css 为删除确认浮层补齐原版样式", () => {
  assert.match(css, /\.chat-delete-confirm\s*\{/);
  assert.match(css, /\.chat-delete-confirm__yes\s*\{/);
  assert.match(css, /@keyframes openclaw-scale-in/);
});

void test("openclaw-chat.css 为资料浮窗完成按钮和顶栏头像回退保留样式", () => {
  assert.match(css, /\.chat-user-profile-popover-overlay\s*\{/);
  assert.match(css, /\.chat-user-profile-popover__done\s*\{/);
  assert.match(css, /\.surface-group-identity-avatar\s*\{/);
  assert.doesNotMatch(css, /\.agent-chat__textarea--group\s*\{/);
});

void test("openclaw-chat.css 的消息气泡使用主题变量", () => {
  assert.match(css, /\.chat-bubble\s*\{[\s\S]*background:\s*var\(--bubble-agent-bg\);/);
  assert.match(css, /\.chat-bubble\s*\{[\s\S]*box-shadow:\s*var\(--workbench-card-shadow\);/);
  assert.match(
    css,
    /\.chat-group\.user \.chat-bubble\s*\{[\s\S]*background:\s*var\(--bubble-user-bg\);/,
  );
});

void test("openclaw-chat.css 为系统分隔线和消息 meta 统一工作台视觉 token", () => {
  assert.match(css, /\.chat-divider__label\s*\{[\s\S]*background:\s*var\(--workbench-pill-bg\);/);
  assert.match(
    css,
    /\.chat-divider__label\s*\{[\s\S]*box-shadow:\s*var\(--workbench-card-shadow\);/,
  );
  assert.match(
    css,
    /\.msg-meta__model\s*\{[\s\S]*border:\s*1px solid var\(--workbench-pill-border\);/,
  );
  assert.match(
    css,
    /\.msg-meta__model\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--workbench-pill-bg\)\s*94%,\s*transparent\);/,
  );
});

void test("openclaw-chat.css 的顶部栏和输入区开始使用 workbench 视觉 token", () => {
  assert.match(css, /\.openclaw-chat-shell\s*\{[\s\S]*background:\s*var\(--workbench-shell-bg\);/);
  assert.match(css, /\.topbar\s*\{[\s\S]*background:\s*var\(--workbench-glass-bg\);/);
  assert.match(
    css,
    /\.content-header\s*\{[\s\S]*background:\s*var\(--chat-workbench-control-bg\);/,
  );
  assert.match(
    css,
    /\.agent-chat__quick-action\s*\{[\s\S]*background:\s*var\(--workbench-pill-bg\);/,
  );
  assert.match(css, /\.chat-send-btn\s*\{[\s\S]*width:\s*36px;[\s\S]*height:\s*36px;/);
});

void test("openclaw-chat.css 的全屏模式用轻量顶部渐变和更克制的退出按钮收住顶部突兀感", () => {
  assert.match(
    css,
    /\.openclaw-chat-shell--focus \.chat::before\s*\{[\s\S]*height:\s*52px;[\s\S]*background:\s*linear-gradient\(/,
  );
  assert.match(
    css,
    /\.chat-focus-exit\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--workbench-panel-bg-strong\)\s*90%,\s*transparent\);/,
  );
  assert.match(css, /\.openclaw-chat-shell--focus \.chat-thread\s*\{[\s\S]*padding-top:\s*8px;/);
});

void test("openclaw-chat.css 把聊天名字字重收回，并找回浅色模式下的轻微气泡 hover 染色", () => {
  assert.match(
    css,
    /\.dashboard-header__title\s*\{[\s\S]*font-weight:\s*600;[\s\S]*font-size:\s*16px;/,
  );
  assert.match(
    css,
    /\.surface-group-topbar__name\s*\{[\s\S]*font-size:\s*16px;[\s\S]*font-weight:\s*600;/,
  );
  assert.match(css, /\.chat-sender-name\s*\{[\s\S]*font-weight:\s*500;/);
  assert.match(
    css,
    /:root\[data-theme-mode="light"\] \.chat-bubble:hover\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--bubble-agent-bg\)\s*94%,\s*var\(--brand-primary\)\s*6%\);/,
  );
  assert.match(
    css,
    /:root\[data-theme-mode="light"\] \.chat-bubble:hover\s*\{[\s\S]*border-color:\s*color-mix\(in srgb,\s*var\(--brand-primary\)\s*12%,\s*var\(--workbench-panel-border-strong\)\);/,
  );
});
