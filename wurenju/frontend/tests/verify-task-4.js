const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const APP_URL = process.env.XIABAN_APP_URL || "http://localhost:5173";
const SCREENSHOT_PATH = path.join(__dirname, "screenshots", "task-4-profile-no-whitescreen.png");
const AVATAR_FIXTURE_PATH = path.join(__dirname, "fixtures", "avatar-upload.svg");
const PROFILE_NAME = `白屏修复验证-${Date.now().toString(36)}`;

async function ensureUserAvatarButton(page) {
  const avatarButtons = page.locator("[data-user-avatar]");
  if (await avatarButtons.count()) {
    return avatarButtons.last();
  }

  await page.locator("textarea").fill("任务4白屏验证消息");
  await page.locator(".chat-send-btn").first().click();
  await page.waitForTimeout(5000);

  const nextButtons = page.locator("[data-user-avatar]");
  await assert.doesNotReject(async () => {
    await nextButtons.first().waitFor({ state: "visible", timeout: 10_000 });
  });
  return nextButtons.last();
}

(async () => {
  fs.mkdirSync(path.dirname(SCREENSHOT_PATH), { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
  const page = await context.newPage();
  const pageErrors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      pageErrors.push(`console:${msg.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(`pageerror:${error.message}`);
  });

  await page.goto(APP_URL, { waitUntil: "networkidle" });

  const avatarButton = await ensureUserAvatarButton(page);
  await avatarButton.click();
  await page.locator(".chat-user-profile-popover").waitFor({ state: "visible" });

  const nameInput = page
    .locator("#xiaban-user-profile-name-input, #xiaban-user-name-input")
    .first();
  await nameInput.fill(PROFILE_NAME);
  await page.waitForTimeout(400);
  assert.equal(
    await page
      .locator(".app-layout__main")
      .innerText()
      .then((text) => text.length > 0),
    true,
  );

  const fileInput = page.locator("#xiaban-user-profile-file-input");
  await fileInput.setInputFiles(AVATAR_FIXTURE_PATH);
  await page.waitForTimeout(800);
  const storedAvatar = await page.evaluate(() => localStorage.getItem("xiaban_user_avatar"));
  assert.ok(
    storedAvatar && storedAvatar.startsWith("data:image/"),
    "头像应写入 xiaban_user_avatar",
  );
  assert.equal(
    await page
      .locator(".app-layout__main")
      .innerText()
      .then((text) => text.length > 0),
    true,
  );

  await page.getByRole("button", { name: "完成" }).click();
  await page.locator(".chat-user-profile-popover").waitFor({ state: "hidden" });

  const storedName = await page.evaluate(() => localStorage.getItem("xiaban_user_name"));
  assert.equal(storedName, PROFILE_NAME);
  assert.equal(pageErrors.length, 0, `出现未捕获错误: ${pageErrors.join("\n")}`);

  await page.screenshot({ path: SCREENSHOT_PATH });
  await browser.close();
  console.log("✅ 任务 4 验证通过");
})().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
