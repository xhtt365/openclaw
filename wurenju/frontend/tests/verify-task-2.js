const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const APP_URL = process.env.XIABAN_APP_URL || "http://localhost:5173";
const SCREENSHOT_PATH = path.join(__dirname, "screenshots", "task-2-mention-color.png");

async function seedGroupSnapshot(page) {
  await page.evaluate(() => {
    const now = Date.now();
    const groupId = "verify-group-task-2";

    localStorage.setItem(
      "wurenju.groups.v1",
      JSON.stringify({
        groups: [
          {
            id: groupId,
            name: "在垃",
            description: "任务2验证群聊",
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
              id: "user-1",
              role: "user",
              content: "@彬先 @小美 出来聊天了",
              timestamp: now,
              timestampLabel: "3:47",
            },
          ],
        },
        archives: [],
      }),
    );
  });
}

(async () => {
  fs.mkdirSync(path.dirname(SCREENSHOT_PATH), { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await seedGroupSnapshot(page);
  await page.reload({ waitUntil: "networkidle" });

  const mentions = page.locator(".group-message-mention");
  await mentions.first().waitFor({ state: "visible" });
  assert.equal(await mentions.count(), 2);

  const brandColor = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--brand-primary").trim(),
  );
  assert.equal(brandColor, "#dc2626");

  const mentionColor = await mentions
    .first()
    .evaluate((element) => getComputedStyle(element).color);
  const bubbleColor = await page
    .locator(".chat-bubble .chat-text")
    .first()
    .evaluate((element) => getComputedStyle(element).color);

  const normalizedMentionColor = await page.evaluate((color) => {
    const swatch = document.createElement("div");
    swatch.style.color = color;
    document.body.appendChild(swatch);
    const normalized = getComputedStyle(swatch).color;
    swatch.remove();
    return normalized;
  }, brandColor);

  assert.equal(mentionColor, normalizedMentionColor);
  assert.notEqual(mentionColor, bubbleColor, "普通文本颜色不应被一并改红");
  assert.equal(await mentions.first().textContent(), "@彬先");
  assert.equal(await mentions.nth(1).textContent(), "@小美");

  await page.screenshot({ path: SCREENSHOT_PATH });
  await browser.close();
  console.log("✅ 任务 2 验证通过");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
