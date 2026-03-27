import assert from "node:assert/strict";
import test from "node:test";
import { buildAnnouncementDispatchPlan, isExecutableAnnouncement } from "./announcementDispatch";

const MEMBERS = [
  { id: "leader", name: "群主" },
  { id: "weige", name: "维哥" },
  { id: "wuye", name: "五爷" },
];

void test("buildAnnouncementDispatchPlan 在只点名成员时只派发给被 @ 的成员", () => {
  const plan = buildAnnouncementDispatchPlan(
    "@维哥 谈一下AI @五爷 分享一下最近看的书",
    MEMBERS,
    "leader",
  );

  assert.deepEqual(plan, {
    targetIds: ["weige", "wuye"],
    mode: "targeted",
  });
});

void test("buildAnnouncementDispatchPlan 在出现全员信号时派发给所有成员", () => {
  const plan = buildAnnouncementDispatchPlan("所有成员注意：明天上线", MEMBERS, "leader");

  assert.deepEqual(plan, {
    targetIds: ["leader", "weige", "wuye"],
    mode: "all",
  });
  assert.equal(isExecutableAnnouncement("所有成员注意：明天上线"), false);
});

void test("buildAnnouncementDispatchPlan 在全员动作公告时仍保持 all 模式且判定为执行型", () => {
  const plan = buildAnnouncementDispatchPlan("所有成员明天 12 点前回复已知悉", MEMBERS, "leader");

  assert.deepEqual(plan, {
    targetIds: ["leader", "weige", "wuye"],
    mode: "all",
  });
  assert.equal(isExecutableAnnouncement("所有成员明天 12 点前回复已知悉"), true);
});

void test("buildAnnouncementDispatchPlan 在执行型且未点名时默认只派给群主", () => {
  const plan = buildAnnouncementDispatchPlan(
    "接力：完成以下任务 main:讲美伊冲突 维哥:谈AI",
    MEMBERS,
    "leader",
  );

  assert.deepEqual(plan, {
    targetIds: ["leader"],
    mode: "leader-only",
  });
});

void test("buildAnnouncementDispatchPlan 在同步型公告时派发给所有成员", () => {
  const plan = buildAnnouncementDispatchPlan("本周五团建", MEMBERS, "leader");

  assert.deepEqual(plan, {
    targetIds: ["leader", "weige", "wuye"],
    mode: "all",
  });
});

void test("buildAnnouncementDispatchPlan 在空公告和纯空白公告时保持全员同步模式", () => {
  assert.deepEqual(buildAnnouncementDispatchPlan("", MEMBERS, "leader"), {
    targetIds: ["leader", "weige", "wuye"],
    mode: "all",
  });
  assert.deepEqual(buildAnnouncementDispatchPlan("   \n  ", MEMBERS, "leader"), {
    targetIds: ["leader", "weige", "wuye"],
    mode: "all",
  });
});
