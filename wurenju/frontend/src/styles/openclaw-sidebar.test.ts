import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./openclaw-sidebar.css", import.meta.url), "utf8");
const employeeListSource = readFileSync(
  new URL("../components/layout/EmployeeList.tsx", import.meta.url),
  "utf8",
);

void test("openclaw-sidebar.css 为员工行保留稳定的 shell、按钮显隐和纯边框选中态", () => {
  assert.match(css, /\.workspace-sidebar__row-shell\s*\{/);
  assert.match(css, /--sidebar-shell-bg:\s*var\(--workbench-shell-bg\);/);
  assert.match(css, /--sidebar-card-bg:\s*var\(--workbench-panel-bg\);/);
  assert.match(
    css,
    /\.workspace-sidebar__row-shell:hover \.workspace-sidebar__row-menu-button,[\s\S]*\.workspace-sidebar__row-shell:focus-within \.workspace-sidebar__row-menu-button,/,
  );
  assert.match(
    css,
    /\.workspace-sidebar__row--selected\s*\{[\s\S]*background:\s*var\(--sidebar-row-bg\);/,
  );
  assert.doesNotMatch(css, /\.workspace-sidebar__row--selected::before\s*\{/);
  assert.match(
    css,
    /\.workspace-sidebar__row-menu-button\s*\{[\s\S]*background:\s*var\(--sidebar-button-bg\);/,
  );
});

void test("openclaw-sidebar.css 让头像状态点半内半外显示且不再被裁切", () => {
  assert.match(css, /\.workspace-sidebar__row-avatar\s*\{[\s\S]*overflow:\s*visible;/);
  assert.match(css, /\.workspace-sidebar__row-avatar-media\s*\{[\s\S]*overflow:\s*hidden;/);
  assert.match(
    css,
    /\.workspace-sidebar__row-avatar-badge\s*\{[\s\S]*right:\s*-4px;[\s\S]*bottom:\s*-4px;/,
  );
});

void test("EmployeeList 员工行使用 shell 和独立头像媒体层，职位与未读徽标走稳定行内布局", () => {
  assert.match(employeeListSource, /className=\{cn\("workspace-sidebar__row-shell"/);
  assert.match(employeeListSource, /className="workspace-sidebar__row-avatar-media"/);
  assert.match(employeeListSource, /workspace-sidebar__row-labels--with-role/);
  assert.match(employeeListSource, /workspace-sidebar__row-labels--with-unread/);
  assert.match(
    css,
    /\.workspace-sidebar__row-labels--with-role\s*\{[\s\S]*grid-template-columns:\s*fit-content\(48%\)\s*minmax\(0,\s*1fr\);/,
  );
  assert.match(
    css,
    /\.workspace-sidebar__row-labels--with-role\.workspace-sidebar__row-labels--with-unread\s*\{[\s\S]*display:\s*flex;[\s\S]*gap:\s*4px;/,
  );
  assert.match(
    css,
    /\.workspace-sidebar__row-labels--with-unread \.workspace-sidebar__unread-badge\s*\{[\s\S]*margin-left:\s*2px;/,
  );
});

void test("EmployeeList 侧栏头部改为官网龙虾动画和中文 slogan", () => {
  assert.match(employeeListSource, /function SidebarLobsterMark\(\)/);
  assert.match(employeeListSource, /workspace-sidebar-lobster-gradient/);
  assert.match(employeeListSource, /workspace-sidebar__brand-lobster-eye-glow/);
  assert.match(employeeListSource, /workspace-sidebar__brand-slogan-brand/);
  assert.match(employeeListSource, /上/);
  assert.match(employeeListSource, /当董事长/);
  assert.match(employeeListSource, /你的 AI 团队，永不下班/);
  assert.match(employeeListSource, /虾班办公室/);
  assert.match(employeeListSource, /window\.open\(targetUrl, "_blank", "noopener,noreferrer"\)/);
  assert.match(css, /\.workspace-sidebar__brand-mark\s*\{/);
  assert.match(css, /\.workspace-sidebar__brand-slogan\s*\{/);
  assert.match(css, /\.workspace-sidebar__brand-slogan-brand\s*\{/);
  assert.match(css, /\.workspace-sidebar__office-badge\s*\{/);
  assert.match(css, /\.workspace-sidebar__group-avatar\s*\{/);
  assert.match(css, /@keyframes workspace-sidebar-lobster-float/);
  assert.match(
    css,
    /\.workspace-sidebar__brand-lobster \.workspace-sidebar__brand-lobster-claw-left\s*\{/,
  );
});

void test("归档分区默认折叠并使用紧凑单行归档样式", () => {
  assert.match(
    employeeListSource,
    /const DEFAULT_COLLAPSED_SECTIONS = \{[\s\S]*SECTION_KEYS\.groupArchives]: true,[\s\S]*SECTION_KEYS\.directArchives]: true,[\s\S]*\} satisfies SidebarCollapsedSections;/,
  );
  assert.match(employeeListSource, /function mergeCollapsedSectionDefaults\(/);
  assert.match(employeeListSource, /variant="archive"/);
  assert.match(employeeListSource, /data-archive-kind={icon}/);
  assert.match(css, /\.workspace-sidebar__section-header--archive\s*\{/);
  assert.match(css, /\.workspace-sidebar__section-count--inline\s*\{/);
  assert.match(css, /\.workspace-sidebar__section-items--archive\s*\{/);
  assert.match(css, /\.workspace-sidebar__archive-row\s*\{[\s\S]*min-height:\s*36px;/);
  assert.match(css, /\.workspace-sidebar__archive-row-icon\s*\{/);
  assert.match(css, /\.workspace-sidebar__archive-row-name\s*\{/);
  assert.match(css, /\.workspace-sidebar__archive-row-time\s*\{/);
});
