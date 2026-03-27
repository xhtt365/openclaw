import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeRelayFallbackBudget,
  createSequentialRelayPlan,
  getRelayRemainingMemberIds,
  inspectSequentialRelayRequest,
  isSequentialRelayRequest,
  resolveAssistantRelayTargets,
  resolveRelayProgress,
} from "./groupRelay";

void test("isSequentialRelayRequest 能识别轮流接力任务", () => {
  assert.equal(isSequentialRelayRequest("@Main 你们轮流自我介绍", 3), true);
  assert.equal(isSequentialRelayRequest("@Main 帮我看下这个报错", 3), false);
});

void test("inspectSequentialRelayRequest 只把明确接力表达识别为接力模式", () => {
  assert.equal(inspectSequentialRelayRequest("@马老师 讲个笑话", 3).isRelayRequest, false);
  assert.equal(
    inspectSequentialRelayRequest("@Main 从你开始，每个人介绍一下自己", 3).isRelayRequest,
    true,
  );
  assert.equal(inspectSequentialRelayRequest("所有人说一下进度", 3).isRelayRequest, true);
  assert.equal(inspectSequentialRelayRequest("大家有什么想法？", 3).isRelayRequest, false);
  assert.equal(inspectSequentialRelayRequest("你们怎么看？", 3).isRelayRequest, false);
  assert.equal(inspectSequentialRelayRequest("接力介绍一下自己", 3).isRelayRequest, true);
});

void test("inspectSequentialRelayRequest 能命中每一个人都做完这类表达", () => {
  const inspection = inspectSequentialRelayRequest(
    "@Main 你先做一个自我介绍，然后随机艾特下一个人，确保我们群里边每一个人都做完自我介绍。",
    4,
  );

  assert.equal(inspection.isRelayRequest, true);
  assert.deepEqual(inspection.matchedSequentialKeywords, ["下一个", "艾特下一个"]);
  assert.deepEqual(inspection.matchedAllMemberKeywords, ["每一个人", "都做完"]);
  assert.deepEqual(inspection.matchedTaskKeywords, ["自我介绍", "介绍"]);
});

void test("createSequentialRelayPlan 会把初始目标排在前面，其余成员顺延", () => {
  const plan = createSequentialRelayPlan({
    text: "@Main 你们轮流自我介绍",
    memberIds: ["main", "lalala", "bob"],
    leaderId: "main",
    initialTargetIds: ["main"],
  });

  assert.ok(plan);
  assert.deepEqual(plan.participantIds, ["main", "lalala", "bob"]);
  assert.deepEqual(getRelayRemainingMemberIds(plan), ["main", "lalala", "bob"]);
});

void test("resolveRelayProgress 会优先尊重成员显式 @ 的下一位", () => {
  const plan = createSequentialRelayPlan({
    text: "@Main 你们轮流自我介绍",
    memberIds: ["main", "lalala", "bob"],
    leaderId: "main",
    initialTargetIds: ["main"],
  });

  assert.ok(plan);

  const decision = resolveRelayProgress({
    plan,
    currentMemberId: "main",
    mentionedMemberIds: ["lalala"],
  });

  assert.equal(decision.reason, "mentioned_next");
  assert.deepEqual(decision.nextMemberIds, ["lalala"]);
  assert.equal(decision.shouldNotifyLeader, false);
});

void test("resolveAssistantRelayTargets 会在非接力模式下忽略回复中的 @", () => {
  assert.deepEqual(
    resolveAssistantRelayTargets({
      isRelayMode: false,
      mentionedMemberIds: ["laoshi"],
    }),
    {
      isRelayMode: false,
      nextMemberIds: [],
    },
  );

  assert.deepEqual(
    resolveAssistantRelayTargets({
      isRelayMode: true,
      mentionedMemberIds: ["laoshi", "main", "laoshi"],
    }),
    {
      isRelayMode: true,
      nextMemberIds: ["laoshi", "main"],
    },
  );
});

void test("resolveRelayProgress 在普通成员断链时会触发群主兜底", () => {
  const plan = {
    leaderId: "main",
    participantIds: ["main", "lalala", "bob"],
    completedMemberIds: ["main"],
    fallbackCount: 0,
    fallbackLimit: 2,
    triggerText: "@Main 你们轮流自我介绍",
  };

  const decision = resolveRelayProgress({
    plan,
    currentMemberId: "lalala",
    mentionedMemberIds: [],
  });

  assert.equal(decision.reason, "leader_fallback");
  assert.equal(decision.shouldNotifyLeader, true);
  assert.equal(decision.nextPlan?.fallbackCount, 1);
});

void test("resolveRelayProgress 在群主兜底后仍会自动续到下一位成员", () => {
  const plan = {
    leaderId: "main",
    participantIds: ["main", "lalala", "bob"],
    completedMemberIds: ["main", "lalala"],
    fallbackCount: 1,
    fallbackLimit: 2,
    triggerText: "@Main 你们轮流自我介绍",
  };

  const decision = resolveRelayProgress({
    plan,
    currentMemberId: "main",
    mentionedMemberIds: [],
  });

  assert.equal(decision.reason, "leader_auto_continue");
  assert.deepEqual(decision.nextMemberIds, ["bob"]);
});

void test("resolveRelayProgress 超过兜底上限后会停止自动接力", () => {
  const plan = {
    leaderId: "main",
    participantIds: ["main", "lalala", "bob"],
    completedMemberIds: ["main"],
    fallbackCount: 2,
    fallbackLimit: 2,
    triggerText: "@Main 你们轮流自我介绍",
  };

  const decision = resolveRelayProgress({
    plan,
    currentMemberId: "lalala",
    mentionedMemberIds: [],
  });

  assert.equal(decision.reason, "fallback_limit");
  assert.equal(decision.nextPlan, null);
  assert.deepEqual(decision.nextMemberIds, []);
});

void test("consumeRelayFallbackBudget 会在超限前递增，超限后返回 null", () => {
  const plan = {
    leaderId: "main",
    participantIds: ["main", "lalala", "bob"],
    completedMemberIds: ["main"],
    fallbackCount: 1,
    fallbackLimit: 2,
    triggerText: "@Main 你们轮流自我介绍",
  };

  assert.equal(consumeRelayFallbackBudget(plan)?.fallbackCount, 2);
  assert.equal(
    consumeRelayFallbackBudget({
      ...plan,
      fallbackCount: 2,
    }),
    null,
  );
});
