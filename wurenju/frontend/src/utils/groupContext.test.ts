import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGroupAgentRequestMessage,
  buildGroupAgentSystemPrompt,
  buildGroupAnnouncementSystemMessage,
  buildGroupContext,
  normalizeGroupAnnouncement,
} from "./groupContext";

void test("normalizeGroupAnnouncement 会把空白公告归一化为 undefined", () => {
  assert.equal(normalizeGroupAnnouncement("   \n  "), undefined);
  assert.equal(normalizeGroupAnnouncement(undefined), undefined);
});

void test("buildGroupAnnouncementSystemMessage 会生成注入到最前面的公告上下文", () => {
  const announcement = "第一条规范\n第二条规范";
  const message = buildGroupAnnouncementSystemMessage(announcement);

  assert.equal(
    message,
    `【群公告】

第一条规范
第二条规范

如果以上公告中出现本地文件路径（如 /Users/... 或 ~/...），请先用文件读取工具主动读取相关文件，并把文件内容作为后续执行任务和回复的依据；如果文件不存在或无法读取，请在回复中明确说明。

请在回复中参考以上公告内容。

`,
  );
});

void test("buildGroupAnnouncementSystemMessage 在公告为空时不返回任何内容", () => {
  assert.equal(buildGroupAnnouncementSystemMessage(""), "");
  assert.equal(buildGroupAnnouncementSystemMessage("   "), "");
});

void test("buildGroupAgentSystemPrompt 会把群公告放在群聊上下文最前面", () => {
  const prompt = buildGroupAgentSystemPrompt({
    groupName: "M12 项目组",
    announcement: "提交前先自检",
    members: [
      { id: "main", name: "Main", title: "群主" },
      { id: "dev", name: "小王", title: "前端" },
    ],
    leaderId: "main",
    targetAgentId: "dev",
  });

  assert.match(prompt, /^【群公告】/);
  assert.match(prompt, /提交前先自检/);
  assert.match(prompt, /\[群聊模式]/);
});

void test("buildGroupContext 会要求群主先完成自己的任务再继续协调", () => {
  const prompt = buildGroupContext({
    groupName: "接力组",
    members: [
      { id: "main", name: "Main", title: "群主" },
      { id: "writer", name: "Writer", title: "文案" },
    ],
    leaderId: "main",
    targetAgentId: "main",
    userSpecifiedTargets: true,
  });

  assert.match(prompt, /你必须先完成自己的部分，再继续协调其他成员/);
  assert.match(prompt, /你既是执行者也是协调者，不能只调度不干活/);
  assert.match(prompt, /【最高优先级指令】当用户给你分配了具体任务或问题时/);
});

void test("buildGroupAgentRequestMessage 会把群公告和群规则拼进真实消息体", () => {
  const message = buildGroupAgentRequestMessage({
    groupName: "公告链路验收",
    announcement: "每个人回复的第一句话必须是：收到公告",
    members: [
      { id: "main", name: "Main", title: "群主" },
      { id: "dev", name: "阿强", title: "前端" },
    ],
    leaderId: "main",
    targetAgentId: "main",
    userSpecifiedTargets: true,
    message: "@Main 请先做一句自我介绍，然后明确说明你已经读取了群公告。",
  });

  assert.match(message, /^【群公告】/);
  assert.match(message, /每个人回复的第一句话必须是：收到公告/);
  assert.match(message, /【最高优先级指令】/);
  assert.match(message, /@Main 请先做一句自我介绍/);
});
