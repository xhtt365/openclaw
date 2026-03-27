import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, afterEach, before } from "node:test";
import test from "node:test";

const originalHome = process.env.HOME;
const originalDateNow = Date.now;

let tempHomeDir = "";
let dbModule: typeof import("../db") | null = null;
let reviewService: typeof import("./reviewService") | null = null;
let experienceService: typeof import("./experienceService") | null = null;

before(async () => {
  tempHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "xiaban-review-service-"));
  process.env.HOME = tempHomeDir;

  dbModule = await import("../db");
  experienceService = await import("./experienceService");
  reviewService = await import("./reviewService");
});

afterEach(() => {
  Date.now = originalDateNow;
  dbModule?.db.exec(`
    DELETE FROM process_events;
    DELETE FROM experience_items;
    DELETE FROM settings;
  `);
});

after(async () => {
  Date.now = originalDateNow;

  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  if (tempHomeDir) {
    await fs.rm(tempHomeDir, { recursive: true, force: true });
  }
});

void test("checkAndRunReview(weekly) 会晋升符合条件的 pending 经验并记录执行时间", async () => {
  const now = 1_742_000_000_000;
  Date.now = () => now;

  experienceService?.upsertExperienceCandidate({
    id: "exp-weekly",
    kind: "lesson",
    rule: "先保存再继续处理",
    repeatedHits: 3,
    feedbackScore: 0.4,
    confidence: 0.8,
    createdAt: String(now - 1_000),
    updatedAt: String(now - 1_000),
    lastSeenAt: String(now - 1_000),
  });

  const didRun = await reviewService?.checkAndRunReview("weekly");

  assert.equal(didRun, true);
  assert.equal(experienceService?.getExperienceById("exp-weekly")?.status, "verified");

  const storedSetting = dbModule?.db
    .prepare<{ key: string }, { value: string }>("SELECT value FROM settings WHERE key = @key")
    .get({ key: "last_review_weekly_at" });
  assert.equal(storedSetting?.value, String(now));
});

void test("checkAndRunReview(weekly) 在窗口期内重复执行不会重复运行", async () => {
  const firstRunAt = 1_742_000_000_000;
  Date.now = () => firstRunAt;

  experienceService?.upsertExperienceCandidate({
    id: "exp-idempotent",
    kind: "lesson",
    rule: "先确认需求再执行",
    repeatedHits: 4,
    feedbackScore: 0.2,
    confidence: 0.85,
    createdAt: String(firstRunAt - 1_000),
    updatedAt: String(firstRunAt - 1_000),
  });

  const firstRun = await reviewService?.checkAndRunReview("weekly");
  assert.equal(firstRun, true);
  assert.equal(experienceService?.getExperienceById("exp-idempotent")?.status, "verified");

  Date.now = () => firstRunAt + 60 * 60 * 1000;
  const secondRun = await reviewService?.checkAndRunReview("weekly");
  assert.equal(secondRun, false);

  const storedSetting = dbModule?.db
    .prepare<{ key: string }, { value: string }>("SELECT value FROM settings WHERE key = @key")
    .get({ key: "last_review_weekly_at" });
  assert.equal(storedSetting?.value, String(firstRunAt));
});

void test("checkAndRunReview(weekly) 不会晋升命中次数不足的高置信度经验", async () => {
  const now = 1_742_000_000_000;
  Date.now = () => now;

  experienceService?.upsertExperienceCandidate({
    id: "exp-insufficient-hits",
    kind: "lesson",
    rule: "只有一次命中，不应晋升",
    repeatedHits: 1,
    feedbackScore: 0.9,
    confidence: 0.9,
    createdAt: String(now - 1_000),
    updatedAt: String(now - 1_000),
    lastSeenAt: String(now - 1_000),
  });

  const didRun = await reviewService?.checkAndRunReview("weekly");

  assert.equal(didRun, true);
  assert.equal(experienceService?.getExperienceById("exp-insufficient-hits")?.status, "pending");
});

void test("checkAndRunReview(monthly) 会降级超过 30 天未命中的 verified 经验", async () => {
  const now = 1_742_000_000_000;
  Date.now = () => now;

  experienceService?.upsertExperienceCandidate({
    id: "exp-monthly",
    status: "verified",
    kind: "lesson",
    rule: "先列出风险再给方案",
    repeatedHits: 5,
    feedbackScore: 0.9,
    createdAt: String(now - 40 * 24 * 60 * 60 * 1000),
    updatedAt: String(now - 40 * 24 * 60 * 60 * 1000),
    validFrom: String(now - 40 * 24 * 60 * 60 * 1000),
    lastSeenAt: String(now - 31 * 24 * 60 * 60 * 1000),
  });

  experienceService?.upsertExperienceCandidate({
    id: "exp-recent",
    status: "verified",
    kind: "lesson",
    rule: "最近还在用，不应降级",
    repeatedHits: 5,
    feedbackScore: 0.9,
    createdAt: String(now - 10 * 24 * 60 * 60 * 1000),
    updatedAt: String(now - 10 * 24 * 60 * 60 * 1000),
    validFrom: String(now - 10 * 24 * 60 * 60 * 1000),
  });

  const didRun = await reviewService?.checkAndRunReview("monthly");

  assert.equal(didRun, true);
  assert.equal(experienceService?.getExperienceById("exp-monthly")?.status, "deprecated");
  assert.equal(experienceService?.getExperienceById("exp-recent")?.status, "verified");

  const storedSetting = dbModule?.db
    .prepare<{ key: string }, { value: string }>("SELECT value FROM settings WHERE key = @key")
    .get({ key: "last_review_monthly_at" });
  assert.equal(storedSetting?.value, String(now));
});
