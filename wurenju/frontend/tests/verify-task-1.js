const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const APP_URL = process.env.XIABAN_APP_URL || "http://localhost:5173";
const SCREENSHOT_PATH = path.join(__dirname, "screenshots", "task-1-kebab-menu.png");
const FINAL_SCREENSHOT_PATH = path.join(__dirname, "screenshots", "kebab-menu-final.png");

function collectSourceFiles(rootDir) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function findSourceFilesContainingAll(tokens) {
  const srcRoot = path.join(__dirname, "..", "src");
  const files = collectSourceFiles(srcRoot);

  return files
    .filter((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      return tokens.every((token) => source.includes(token));
    })
    .map((filePath) => path.relative(path.join(__dirname, ".."), filePath));
}

async function seedGroupSnapshot(page) {
  await page.evaluate(() => {
    const now = Date.now();
    const groupId = "verify-group-task-1";

    localStorage.setItem(
      "wurenju.groups.v1",
      JSON.stringify({
        groups: [
          {
            id: groupId,
            name: "在垃",
            description: "任务1验证群聊",
            announcement: "群公告测试",
            notificationsEnabled: true,
            soundEnabled: false,
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
              timestamp: now - 1000,
              timestampLabel: "3:47",
            },
            {
              id: "assistant-1",
              role: "assistant",
              content: "嘿！来啦来啦~",
              senderId: "u5f6c-xian",
              senderName: "彬先",
              senderEmoji: "🤖",
              timestamp: now,
              timestampLabel: "3:47",
              model: "MiniMax-M2.5",
              usage: { input: 36, output: 58, cacheRead: 0, cacheWrite: 0, totalTokens: 94 },
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

  const browserEvidence = await page.evaluate(() => {
    const trigger = document.querySelector('[data-surface-group-more-trigger="true"]');
    const header = trigger?.closest('.content-header, header, [class*="header"]');
    const parentChain = [];
    let current = trigger?.parentElement ?? null;

    while (current && parentChain.length < 8) {
      parentChain.push({
        tag: current.tagName,
        className: current.className || "",
      });
      current = current.parentElement;
    }

    return {
      triggerClassName: trigger?.className ?? null,
      headerClassName: header?.className ?? null,
      parentChain,
    };
  });

  const domTemplateCandidates = findSourceFilesContainingAll([
    "surface-group-more__trigger",
    "surface-group-more__menu",
    "chat-controls--group",
  ]);
  const reactEntryCandidates = findSourceFilesContainingAll([
    "openclaw-chat-host",
    "renderLit(",
    "openclaw-chat-shell__content",
  ]);

  console.log("=== 浏览器反查：真实三点菜单 DOM 证据 ===");
  console.log(JSON.stringify(browserEvidence, null, 2));
  console.log("=== DOM 模板源码候选 ===");
  console.log(domTemplateCandidates);
  console.log("=== React 入口源码候选 ===");
  console.log(reactEntryCandidates);

  assert.equal(
    browserEvidence.triggerClassName,
    "btn btn--sm btn--icon surface-group-more__trigger",
  );
  assert.equal(browserEvidence.headerClassName, "content-header");
  assert.deepEqual(domTemplateCandidates, ["src/components/chat/original/chat-shell.ts"]);
  assert.deepEqual(reactEntryCandidates, ["src/components/chat/original/OpenClawChatSurface.tsx"]);

  const trigger = page.locator('[data-surface-group-more-trigger="true"]');
  await trigger.waitFor({ state: "visible" });

  const refreshButton = page.getByLabel("刷新聊天数据");
  const triggerBox = await trigger.boundingBox();
  const refreshBox = await refreshButton.boundingBox();
  assert.ok(triggerBox, "三点菜单按钮应存在");
  assert.ok(refreshBox, "刷新按钮应存在");
  assert.equal(Math.round(triggerBox.width), 32);
  assert.equal(Math.round(triggerBox.height), 32);
  assert.ok(Math.abs((triggerBox.y ?? 0) - (refreshBox.y ?? 0)) <= 3, "三点按钮应与其他图标同行");

  const dotStyles = await page.locator(".surface-group-more__dot").evaluateAll((elements) =>
    elements.map((element) => {
      const styles = window.getComputedStyle(element);
      return {
        width: styles.width,
        height: styles.height,
        radius: styles.borderRadius,
      };
    }),
  );
  assert.equal(dotStyles.length, 3);
  for (const dot of dotStyles) {
    assert.equal(dot.width, "3px");
    assert.equal(dot.height, "3px");
    assert.ok(dot.radius === "999px" || dot.radius === "9999px");
  }

  await trigger.click();
  const menu = page.locator(".surface-group-more__menu");
  await menu.waitFor({ state: "visible" });
  const labels = await page.locator(".surface-group-more__item-label").allInnerTexts();
  assert.deepEqual(labels, ["关闭消息提醒", "开启音效", "编辑项目组", "成员管理", "重置对话"]);

  // 菜单的点外关闭监听通过 setTimeout(0) 绑定，给一帧时间避免误判。
  await page.waitForTimeout(50);
  await page.mouse.click(40, 40);
  await page.waitForTimeout(300);
  assert.equal(await menu.isVisible().catch(() => false), false);

  await page.screenshot({ path: SCREENSHOT_PATH });
  await page.screenshot({ path: FINAL_SCREENSHOT_PATH });
  await browser.close();
  console.log("✅ 任务 1 验证通过");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
