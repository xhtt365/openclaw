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
});

void test("openclaw-chat.css 的群聊顶栏成员信息紧贴群名，群公告按钮无阴影", () => {
  assert.match(css, /\.surface-group-topbar__members\s*\{[\s\S]*gap:\s*4px;/);
  assert.match(css, /\.surface-chat-pill\s*\{[\s\S]*box-shadow:\s*none;/);
  assert.match(css, /\.surface-chat-pill--active\s*\{[\s\S]*box-shadow:\s*none;/);
  assert.match(
    css,
    /\.surface-chat-pill--announcement\s*\{[\s\S]*border-color:\s*var\(--brand-primary\);[\s\S]*color:\s*var\(--brand-primary\);/,
  );
  assert.match(
    css,
    /\.surface-chat-pill--urge\s*\{[\s\S]*background:\s*var\(--brand-primary\);[\s\S]*color:\s*var\(--text-inverse\);/,
  );
});

void test("openclaw-chat.css 的群聊输入区允许 @ 浮层外溢并保留快捷提及横向滚动", () => {
  assert.match(css, /\.agent-chat__input\s*\{[\s\S]*overflow:\s*visible;/);
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
  assert.match(css, /\.surface-group-more__item-icon\s*\{/);
});

void test("openclaw-chat.css 的群聊 @成员名 在浅色和深色主题里都保持高对比高亮", () => {
  assert.match(
    css,
    /\.group-message-mention\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--accent\)\s*22%,\s*transparent\);/,
  );
  assert.match(
    css,
    /\.group-message-mention\s*\{[\s\S]*color:\s*color-mix\(in srgb,\s*var\(--accent\)\s*70%,\s*var\(--text-strong\)\s*30%\);/,
  );
  assert.match(
    css,
    /\.group-message-mention\s*\{[\s\S]*box-shadow:\s*inset 0 0 0 1px color-mix\(in srgb,\s*var\(--accent\)\s*28%,\s*transparent\);/,
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
  assert.match(
    css,
    /\.chat-group\.user \.chat-bubble\s*\{[\s\S]*background:\s*var\(--bubble-user-bg\);/,
  );
});
