const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const APP_URL = process.env.XIABAN_APP_URL || "http://localhost:5173";
const SCREENSHOT_PATH = path.join(__dirname, "screenshots", "task-3-create-employee-reset.png");

function uniqueName(index) {
  return `任务3验证员工-${index}-${Date.now().toString(36)}`;
}

async function openCreateModal(page) {
  await page.getByRole("button", { name: "新增员工" }).click();
  await page.getByRole("dialog").waitFor({ state: "visible" });
}

async function assertBlankForm(page) {
  await page.locator("#employee-display-name").waitFor({ state: "visible" });
  assert.equal(await page.locator("#employee-display-name").inputValue(), "");
  assert.equal(await page.locator("#employee-role").inputValue(), "");
  assert.equal(await page.locator("#employee-bio").inputValue(), "");
}

async function createEmployee(page, name) {
  await page.locator("#employee-display-name").fill(name);
  await page.locator("#employee-role").fill("自动化验证");
  await page.locator("#employee-bio").fill("用于验证新增员工弹窗重置逻辑。");
  await page.getByRole("button", { name: /^下一步$/ }).click();
  await page.getByRole("button", { name: /^下一步$/ }).click();
  await page.getByRole("button", { name: "确认创建" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 30_000 });

  await assert.doesNotReject(async () => {
    await page.waitForFunction(
      (expectedName) => {
        const main = document.querySelector(".app-layout__main");
        return Boolean(main?.textContent?.includes(expectedName));
      },
      name,
      { timeout: 30_000 },
    );
  });
}

(async () => {
  fs.mkdirSync(path.dirname(SCREENSHOT_PATH), { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });

  await page.goto(APP_URL, { waitUntil: "networkidle" });

  const createdNames = [];
  for (let index = 1; index <= 3; index += 1) {
    const name = uniqueName(index);
    await openCreateModal(page);
    await assertBlankForm(page);
    await createEmployee(page, name);
    createdNames.push(name);
  }

  const mainText = await page.locator(".app-layout__main").innerText();
  assert.ok(mainText.includes(createdNames.at(-1)), "创建成功后应跳转到新员工聊天页");

  await openCreateModal(page);
  await assertBlankForm(page);

  await page.screenshot({ path: SCREENSHOT_PATH });
  await browser.close();
  console.log("✅ 任务 3 验证通过");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
