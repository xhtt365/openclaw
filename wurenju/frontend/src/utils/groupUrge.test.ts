import assert from "node:assert/strict";
import test from "node:test";
import {
  GROUP_URGE_INTERVAL_OPTIONS,
  buildUrgeMessage,
  resolveUrgeNextDelayMs,
  resolveUrgeTargets,
} from "./groupUrge";

void test("GROUP_URGE_INTERVAL_OPTIONS 保持预设档位不变", () => {
  assert.deepEqual(GROUP_URGE_INTERVAL_OPTIONS, [1, 3, 5, 10, 30]);
});

void test("buildUrgeMessage 支持单人和多人督促文案", () => {
  assert.equal(buildUrgeMessage(["Eric"]), "@Eric 请汇报当前进度");
  assert.equal(buildUrgeMessage(["Eric", "Bob"]), "@Eric @Bob 请分别汇报当前进度");
});

void test("resolveUrgeNextDelayMs 会返回剩余等待时间", () => {
  const now = Date.now();

  assert.equal(
    resolveUrgeNextDelayMs({
      intervalMinutes: 10,
      lastCheckedAt: now - 4 * 60_000,
      now,
    }),
    6 * 60_000,
  );

  assert.equal(
    resolveUrgeNextDelayMs({
      intervalMinutes: 10,
      lastCheckedAt: now - 12 * 60_000,
      now,
    }),
    0,
  );
});

void test("resolveUrgeTargets 会排除群主和正在思考的成员", () => {
  const now = Date.now();

  const targets = resolveUrgeTargets({
    members: [
      { id: "main", name: "Main" },
      { id: "eric", name: "Eric" },
      { id: "bob", name: "Bob" },
    ],
    leaderId: "main",
    startedAt: now - 30 * 60_000,
    intervalMinutes: 10,
    now,
    thinkingAgentIds: ["bob"],
    lastSpokeAtByAgentId: {
      eric: now - 11 * 60_000,
      bob: now - 25 * 60_000,
    },
  });

  assert.deepEqual(
    targets.map((member) => member.id),
    ["eric"],
  );
});
