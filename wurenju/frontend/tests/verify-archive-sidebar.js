const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const APP_URL = process.env.XIABAN_APP_URL || "http://127.0.0.1:5173";
const SCREENSHOT_PATH = path.join(__dirname, "screenshots", "archive-sidebar-redesign.png");

async function seedArchiveScenario(page) {
  await page.evaluate(() => {
    const now = Date.now();
    localStorage.clear();

    localStorage.setItem(
      "wurenju.groups.v1",
      JSON.stringify({
        groups: [],
        selectedGroupId: null,
        selectedArchiveId: null,
        messagesByGroupId: {},
        archives: [
          {
            id: "verify-group-archive",
            groupId: "verify-group",
            groupName: "一个人",
            createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
            messages: [
              {
                id: "group-msg-1",
                role: "assistant",
                content: "项目组归档消息",
                senderId: "group-lead",
                senderName: "群主",
                timestamp: now - 2 * 24 * 60 * 60 * 1000,
                timestampLabel: "3/17",
              },
            ],
          },
        ],
      }),
    );

    localStorage.setItem(
      "xiaban.sidebar.directArchives",
      JSON.stringify([
        {
          id: "verify-direct-archive",
          agentId: "verify-agent",
          agentName: "王八蛋",
          agentRole: "测试",
          preview: "1v1 归档消息",
          archivedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
          messages: [
            {
              id: "direct-msg-1",
              role: "assistant",
              content: "1v1 归档消息",
              timestamp: now - 2 * 24 * 60 * 60 * 1000,
              timestampLabel: "3/17",
            },
          ],
        },
      ]),
    );

    localStorage.removeItem("xiaban.sidebar.collapsedSections.v2");
  });
}

(async () => {
  fs.mkdirSync(path.dirname(SCREENSHOT_PATH), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await seedArchiveScenario(page);
  await page.reload({ waitUntil: "networkidle" });

  const groupArchiveHeader = page.getByRole("button", { name: "项目组归档 (1)" });
  const directArchiveHeader = page.getByRole("button", { name: "1v1 归档 (1)" });
  const groupArchiveRow = page.locator('[data-archive-kind="group"]');
  const directArchiveRow = page.locator('[data-archive-kind="direct"]');
  const employeeRow = page.locator(".workspace-sidebar__row").first();

  await groupArchiveHeader.waitFor({ state: "visible" });
  await directArchiveHeader.waitFor({ state: "visible" });
  await employeeRow.waitFor({ state: "visible" });

  assert.equal(await groupArchiveRow.count(), 0, "项目组归档默认应折叠");
  assert.equal(await directArchiveRow.count(), 0, "1v1 归档默认应折叠");

  await groupArchiveHeader.click();
  await groupArchiveRow.waitFor({ state: "visible" });

  const archiveMetrics = await groupArchiveRow.evaluate((element) => {
    const row = element;
    const rowName = row.querySelector(".workspace-sidebar__archive-row-name");
    const preview = row.querySelector(".workspace-sidebar__row-preview");
    const styles = rowName ? window.getComputedStyle(rowName) : null;

    return {
      height: Math.round(row.getBoundingClientRect().height),
      iconSvgCount: row.querySelectorAll("svg").length,
      imageCount: row.querySelectorAll("img").length,
      previewCount: preview ? 1 : 0,
      textColor: styles?.color ?? "",
    };
  });

  const employeeMetrics = await employeeRow.evaluate((element) => {
    const row = element;
    const rowName = row.querySelector(".workspace-sidebar__row-name");
    const styles = rowName ? window.getComputedStyle(rowName) : null;

    return {
      height: Math.round(row.getBoundingClientRect().height),
      textColor: styles?.color ?? "",
    };
  });

  assert.ok(archiveMetrics.height <= 40, "归档行高度应明显小于活跃成员卡片");
  assert.ok(archiveMetrics.height < employeeMetrics.height, "归档行高度应小于活跃成员卡片高度");
  assert.equal(archiveMetrics.imageCount, 0, "归档行不应显示头像图片");
  assert.equal(archiveMetrics.previewCount, 0, "归档行不应显示消息预览");
  assert.ok(archiveMetrics.iconSvgCount >= 1, "归档行应显示紧凑图标");
  assert.notEqual(archiveMetrics.textColor, employeeMetrics.textColor, "归档文字应弱于活跃成员");

  await groupArchiveRow.click();
  await page.getByText("此为归档对话，仅供回顾查看，无法继续发送消息。").waitFor({
    state: "visible",
  });
  await page.locator(".chat-thread").getByText("项目组归档消息").waitFor({
    state: "visible",
  });

  await directArchiveHeader.click();
  await directArchiveRow.waitFor({ state: "visible" });
  await directArchiveRow.click();
  await page.getByText("此为 1v1 归档对话，仅供回顾查看，无法继续发送消息。").waitFor({
    state: "visible",
  });
  await page.locator(".chat-thread").getByText("1v1 归档消息").waitFor({
    state: "visible",
  });

  await page.getByRole("switch", { name: "切换明暗主题" }).click({ force: true });
  await directArchiveRow.waitFor({ state: "visible" });

  const lightThemeMetrics = await directArchiveRow.evaluate((element) => {
    const rowName = element.querySelector(".workspace-sidebar__archive-row-name");
    const styles = rowName ? window.getComputedStyle(rowName) : null;
    return {
      color: styles?.color ?? "",
    };
  });

  assert.ok(lightThemeMetrics.color.length > 0, "浅色主题下归档行仍应正常渲染");

  await groupArchiveHeader.click();
  assert.equal(await groupArchiveRow.count(), 0, "再次点击后项目组归档应折叠回去");

  await page.screenshot({ path: SCREENSHOT_PATH });
  await browser.close();
  console.log("✅ 归档侧栏验证通过");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
