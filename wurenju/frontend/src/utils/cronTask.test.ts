import assert from "node:assert/strict";
import test from "node:test";
import type { GatewayCronJob } from "@/services/gateway";
import {
  buildCronMirrorMessageId,
  buildCronScheduleFromDraft,
  createDefaultCronScheduleDraft,
  decodeXiabanCronMeta,
  encodeXiabanCronDescription,
  extractCronJobIdFromSessionKey,
  filterCronJobsByGroup,
  resolveCronDisplayStatus,
  resolveCronScheduleDraft,
} from "./cronTask";

void test("encodeXiabanCronDescription / decodeXiabanCronMeta 可以稳定往返", () => {
  const encoded = encodeXiabanCronDescription({
    version: 1,
    replyMode: "group",
    groupId: "team-alpha",
  });

  assert.deepEqual(decodeXiabanCronMeta(encoded), {
    version: 1,
    replyMode: "group",
    groupId: "team-alpha",
  });
  assert.equal(decodeXiabanCronMeta("not-meta"), null);
});

void test("extractCronJobIdFromSessionKey 能识别 direct 和 agent cron session", () => {
  assert.equal(extractCronJobIdFromSessionKey("cron:daily-report"), "daily-report");
  assert.equal(extractCronJobIdFromSessionKey("agent:xiaomei:cron:daily-report"), "daily-report");
  assert.equal(extractCronJobIdFromSessionKey("agent:xiaomei:cron:ops%3Adaily"), "ops:daily");
  assert.equal(extractCronJobIdFromSessionKey("agent:xiaomei:main"), null);
});

void test("daily / weekly / intervalHours 预设可以生成并回填 schedule", () => {
  const daily = buildCronScheduleFromDraft({
    ...createDefaultCronScheduleDraft(),
    mode: "daily",
    time: "09:30",
  });
  assert.deepEqual(daily, {
    kind: "cron",
    expr: "30 9 * * *",
    tz: daily.kind === "cron" ? daily.tz : "",
  });

  const weekly = buildCronScheduleFromDraft({
    ...createDefaultCronScheduleDraft(),
    mode: "weekly",
    time: "18:05",
    weekday: "5",
  });
  assert.equal(weekly.kind, "cron");
  assert.equal(weekly.expr, "5 18 * * 5");

  const interval = buildCronScheduleFromDraft({
    ...createDefaultCronScheduleDraft(),
    mode: "intervalHours",
    time: "08:15",
    intervalHours: 6,
  });
  assert.equal(interval.kind, "every");
  assert.equal(interval.everyMs, 6 * 60 * 60 * 1000);

  const parsedDaily = resolveCronScheduleDraft({
    kind: "cron",
    expr: "30 9 * * *",
    tz: "Asia/Shanghai",
  });
  assert.equal(parsedDaily.mode, "daily");
  assert.equal(parsedDaily.time, "09:30");

  const parsedWeekly = resolveCronScheduleDraft({
    kind: "cron",
    expr: "5 18 * * 5",
    tz: "Asia/Shanghai",
  });
  assert.equal(parsedWeekly.mode, "weekly");
  assert.equal(parsedWeekly.weekday, "5");

  const parsedInterval = resolveCronScheduleDraft({
    kind: "every",
    everyMs: 6 * 60 * 60 * 1000,
    anchorMs: new Date("2026-03-19T08:15:00+08:00").getTime(),
  });
  assert.equal(parsedInterval.mode, "intervalHours");
  assert.equal(parsedInterval.intervalHours, 6);
});

void test("resolveCronDisplayStatus 优先返回暂停和异常状态", () => {
  const pausedJob = {
    id: "a",
    name: "暂停任务",
    enabled: false,
  } satisfies GatewayCronJob;
  assert.equal(resolveCronDisplayStatus(pausedJob), "STOPPED");

  const errorJob = {
    id: "b",
    name: "异常任务",
    enabled: true,
    state: {
      lastRunStatus: "error",
    },
  } satisfies GatewayCronJob;
  assert.equal(resolveCronDisplayStatus(errorJob), "ERROR");

  const runningJob = {
    id: "c",
    name: "正常任务",
    enabled: true,
  } satisfies GatewayCronJob;
  assert.equal(resolveCronDisplayStatus(runningJob), "RUNNING");
});

void test("filterCronJobsByGroup 只返回绑定到目标群聊的任务", () => {
  const jobs: GatewayCronJob[] = [
    {
      id: "g1",
      name: "群日报",
      agentId: "leader-1",
      description: encodeXiabanCronDescription({
        version: 1,
        replyMode: "group",
        groupId: "group-1",
      }),
    },
    {
      id: "g2",
      name: "其他群任务",
      agentId: "leader-1",
      description: encodeXiabanCronDescription({
        version: 1,
        replyMode: "group",
        groupId: "group-2",
      }),
    },
  ];

  assert.deepEqual(
    filterCronJobsByGroup(jobs, "group-1", "leader-1").map((job) => job.id),
    ["g1"],
  );
});

void test("buildCronMirrorMessageId 对同一条消息输出稳定 id", () => {
  const left = buildCronMirrorMessageId({
    jobId: "daily-report",
    timestamp: 123,
    content: "hello",
  });
  const right = buildCronMirrorMessageId({
    jobId: "daily-report",
    timestamp: 123,
    content: "hello",
  });
  assert.equal(left, right);
});
