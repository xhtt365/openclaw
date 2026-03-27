const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const APP_URL = process.env.XIABAN_APP_URL || "http://localhost:5173";
const SCREENSHOT_PATH = path.join(__dirname, "screenshots", "task-5-sidebar-avatar-sync.png");
const BIAN_XIAN_AVATAR = "/avatars/preset/female_01.jpg";
const XIAO_MEI_AVATAR = "/avatars/preset/female_02.jpg";

async function seedAvatarScenario(page) {
  await page.evaluate(
    ({ bianXianAvatar, xiaoMeiAvatar }) => {
      const now = Date.now();
      const groupId = "verify-group-task-5";

      localStorage.setItem(
        "xiaban_agent_avatars",
        JSON.stringify({
          "u5f6c-xian": bianXianAvatar,
          xiaomei: xiaoMeiAvatar,
        }),
      );

      localStorage.setItem(
        "wurenju.groups.v1",
        JSON.stringify({
          groups: [
            {
              id: groupId,
              name: "在垃",
              description: "任务5验证群聊",
              announcement: "",
              notificationsEnabled: true,
              soundEnabled: true,
              members: [
                { id: "u5f6c-xian", name: "彬先", emoji: "🤖" },
                { id: "xiaomei", name: "小美", emoji: "🌸" },
              ],
              leaderId: "u5f6c-xian",
              createdAt: new Date(now).toISOString(),
            },
          ],
          selectedGroupId: groupId,
          selectedArchiveId: null,
          messagesByGroupId: {
            [groupId]: [
              {
                id: "assistant-1",
                role: "assistant",
                content: "头像同步验证",
                senderId: "u5f6c-xian",
                senderName: "彬先",
                senderEmoji: "🤖",
                timestamp: now,
                timestampLabel: "3:47",
              },
            ],
          },
          archives: [],
        }),
      );
    },
    {
      bianXianAvatar: BIAN_XIAN_AVATAR,
      xiaoMeiAvatar: XIAO_MEI_AVATAR,
    },
  );
}

(async () => {
  fs.mkdirSync(path.dirname(SCREENSHOT_PATH), { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await seedAvatarScenario(page);
  await page.reload({ waitUntil: "networkidle" });

  const bianXianRow = page
    .locator(".workspace-sidebar__row")
    .filter({ has: page.locator(".workspace-sidebar__row-name", { hasText: "彬先" }) })
    .first();
  const xiaoMeiRow = page
    .locator(".workspace-sidebar__row")
    .filter({ has: page.locator(".workspace-sidebar__row-name", { hasText: "小美" }) })
    .first();
  const youkeRow = page
    .locator(".workspace-sidebar__row")
    .filter({ has: page.locator(".workspace-sidebar__row-name", { hasText: "youke" }) })
    .first();

  await bianXianRow.scrollIntoViewIfNeeded();
  await xiaoMeiRow.scrollIntoViewIfNeeded();
  await youkeRow.scrollIntoViewIfNeeded();

  const sidebarBianXianAvatar = bianXianRow.locator("img").first();
  const sidebarXiaoMeiAvatar = xiaoMeiRow.locator("img").first();
  await sidebarBianXianAvatar.waitFor({ state: "visible" });
  await sidebarXiaoMeiAvatar.waitFor({ state: "visible" });

  assert.equal(await sidebarBianXianAvatar.getAttribute("src"), BIAN_XIAN_AVATAR);
  assert.equal(await sidebarXiaoMeiAvatar.getAttribute("src"), XIAO_MEI_AVATAR);

  const chatBubbleAvatar = page.locator("img.chat-avatar.assistant").first();
  await chatBubbleAvatar.waitFor({ state: "visible" });
  assert.equal(await chatBubbleAvatar.getAttribute("src"), BIAN_XIAN_AVATAR);

  const topbarMemberAvatars = page.locator("img.surface-group-topbar__member-avatar");
  await topbarMemberAvatars.nth(0).waitFor({ state: "visible" });
  assert.equal(await topbarMemberAvatars.nth(0).getAttribute("src"), BIAN_XIAN_AVATAR);
  assert.equal(await topbarMemberAvatars.nth(1).getAttribute("src"), XIAO_MEI_AVATAR);

  const youkeImageCount = await youkeRow.locator("img").count();
  assert.equal(youkeImageCount, 0, "未映射员工应继续走 emoji / 字母 fallback");
  const youkeAvatarText = await youkeRow.locator(".workspace-sidebar__row-avatar").innerText();
  assert.ok(youkeAvatarText.trim().length > 0, "未映射员工应保留 fallback 显示");

  await page.screenshot({ path: SCREENSHOT_PATH });
  await browser.close();
  console.log("✅ 任务 5 验证通过");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
