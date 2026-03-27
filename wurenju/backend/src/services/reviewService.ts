import { db, nowIso, type SettingRow } from "../db";
import {
  deprecateExperience,
  getExperienceItemsByStatus,
  promoteExperience,
} from "./experienceService";

type ReviewFrequency = "weekly" | "monthly";

type SettingMutationParams = {
  key: string;
  value: string | null;
  created_at: string;
  updated_at: string;
};

const REVIEW_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const REVIEW_WINDOW_MS: Record<ReviewFrequency, number> = {
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

const getSettingStmt = db.prepare<{ key: string }, SettingRow>(`
  SELECT
    key,
    value,
    created_at,
    updated_at
  FROM settings
  WHERE key = @key
`);

const upsertSettingStmt = db.prepare<SettingMutationParams>(`
  INSERT INTO settings (
    key,
    value,
    created_at,
    updated_at
  ) VALUES (
    @key,
    @value,
    @created_at,
    @updated_at
  )
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = excluded.updated_at
`);

let reviewSchedulerTimer: ReturnType<typeof setInterval> | null = null;

function currentTimestampText() {
  const candidate = nowIso();
  return /^\d+$/.test(candidate) ? candidate : String(Date.now());
}

function getSetting(key: string) {
  return getSettingStmt.get({ key })?.value ?? null;
}

function setSetting(key: string, value: string) {
  const existing = getSettingStmt.get({ key });
  const timestamp = currentTimestampText();

  upsertSettingStmt.run({
    key,
    value,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
  });
}

function readTimestampSetting(key: string) {
  const rawValue = getSetting(key);
  if (!rawValue) {
    return null;
  }

  const normalized = rawValue.trim();
  if (!/^\d+$/.test(normalized)) {
    console.warn(`[Review] 忽略非法设置时间戳: key=${key}, value=${rawValue}`);
    return null;
  }

  return Number(normalized);
}

async function runReviewTick() {
  await checkAndRunReview("weekly");
  await checkAndRunReview("monthly");
}

export function startReviewScheduler(): void {
  if (reviewSchedulerTimer) {
    return;
  }

  reviewSchedulerTimer = setInterval(() => {
    runReviewTick().catch((error) => {
      console.error("[Review] 定时复盘失败:", error);
    });
  }, REVIEW_CHECK_INTERVAL_MS);

  runReviewTick().catch((error) => {
    console.error("[Review] 启动复盘失败:", error);
  });
}

export async function checkAndRunReview(frequency: ReviewFrequency): Promise<boolean> {
  const settingKey = `last_review_${frequency}_at`;
  const lastRun = readTimestampSetting(settingKey);
  const now = Date.now();

  if (lastRun !== null && now - lastRun < REVIEW_WINDOW_MS[frequency]) {
    return false;
  }

  if (frequency === "weekly") {
    await runWeeklyReview();
  } else {
    await runMonthlyReview();
  }

  setSetting(settingKey, String(now));
  return true;
}

export async function runWeeklyReview(): Promise<void> {
  const pendingItems = getExperienceItemsByStatus("pending");

  for (const item of pendingItems) {
    if (item.repeated_hits >= 3 && item.confidence >= 0.75) {
      promoteExperience(item.id);
    }
  }
}

export async function runMonthlyReview(): Promise<void> {
  const verifiedItems = getExperienceItemsByStatus("verified");
  const now = Date.now();

  for (const item of verifiedItems) {
    const lastActivity = Number(
      item.last_seen_at ?? item.valid_from ?? item.updated_at ?? item.created_at,
    );
    const daysSinceLastSeen = (now - lastActivity) / (24 * 60 * 60 * 1000);

    if (daysSinceLastSeen > 30) {
      deprecateExperience(item.id);
    }
  }
}
