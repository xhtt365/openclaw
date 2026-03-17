import assert from "node:assert/strict";
import test from "node:test";
import type { Group } from "../stores/groupStore";
import {
  buildGroupMemberAvatarCache,
  decorateGroupMarkdownMentions,
  getGroupMemberCount,
  renderGroupMentionPreviewHtml,
  resolveAvatarImage,
  resolveGroupAvatarUrl,
  resolveGroupMemberAvatarUrl,
  resolveGroupMembersForSurface,
} from "./groupSurface";

function createGroup(partial?: Partial<Group>): Group {
  return {
    id: "group-1",
    name: "发布项目组",
    members: [
      { id: "leader", name: "老王", emoji: "👑" },
      { id: "alice", name: "Alice" },
      { id: "bob", name: "Bob" },
    ],
    leaderId: "leader",
    createdAt: "2026-03-16T10:00:00.000Z",
    ...partial,
  };
}

void test("getGroupMemberCount 会对群主和成员去重计数", () => {
  const count = getGroupMemberCount(
    createGroup({
      members: [
        { id: "leader", name: "老王" },
        { id: "alice", name: "Alice" },
      ],
    }),
  );

  assert.equal(count, 2);
});

void test("resolveGroupMembersForSurface 会补齐群主并优先使用实时成员信息", () => {
  const members = resolveGroupMembersForSurface(
    createGroup({
      members: [{ id: "alice", name: "旧 Alice" }],
      leaderId: "leader",
    }),
    [
      { id: "leader", name: "项目经理", emoji: "🧭", avatarUrl: "leader.png", role: "PM" },
      { id: "alice", name: "Alice", emoji: "A", avatarUrl: "alice.png", role: "开发" },
    ],
  );

  assert.deepEqual(
    members.map((member) => ({
      id: member.id,
      name: member.name,
      avatarUrl: member.avatarUrl,
      role: member.role,
    })),
    [
      { id: "leader", name: "项目经理", avatarUrl: "leader.png", role: "PM" },
      { id: "alice", name: "Alice", avatarUrl: "alice.png", role: "开发" },
    ],
  );
});

void test("resolveAvatarImage 和 resolveGroupAvatarUrl 会兼容扩展头像字段", () => {
  assert.equal(
    resolveAvatarImage({ avatar: "https://cdn.example.com/alice.png" }),
    "https://cdn.example.com/alice.png",
  );
  assert.equal(resolveAvatarImage({ image: "/avatars/group.png" }), "/avatars/group.png");
  assert.equal(
    resolveAvatarImage({ icon: "https://cdn.example.com/alice-icon.png" }),
    "https://cdn.example.com/alice-icon.png",
  );
  assert.equal(
    resolveAvatarImage({ profileImage: "https://cdn.example.com/alice-profile.png" }),
    "https://cdn.example.com/alice-profile.png",
  );
  assert.equal(
    resolveAvatarImage({ profile_image: "https://cdn.example.com/alice-profile-2.png" }),
    "https://cdn.example.com/alice-profile-2.png",
  );
  assert.equal(
    resolveAvatarImage({ identity: { avatarUrl: "https://cdn.example.com/alice-identity.png" } }),
    "https://cdn.example.com/alice-identity.png",
  );
  assert.equal(
    resolveGroupAvatarUrl({ id: "group-1", image: "/avatars/group.png" }),
    "/avatars/group.png",
  );
});

void test("buildGroupMemberAvatarCache 和 resolveGroupMemberAvatarUrl 会复用群消息里的真实头像", () => {
  const avatarCache = buildGroupMemberAvatarCache([
    {
      id: "message-1",
      role: "assistant",
      content: "我来跟进一下",
      timestamp: 1,
      isNew: false,
      isHistorical: true,
      senderId: "alice",
      senderName: "Alice",
      senderAvatarUrl: "https://cdn.example.com/alice-real.png",
    },
  ]);

  assert.equal(
    resolveGroupMemberAvatarUrl({ id: "alice", name: "Alice", avatarUrl: undefined }, avatarCache),
    "https://cdn.example.com/alice-real.png",
  );
});

void test("renderGroupMentionPreviewHtml 会高亮提及并转义普通文本", () => {
  const html = renderGroupMentionPreviewHtml("请 @Alice 看一下 <script>alert(1)</script>", [
    "Alice",
  ]);

  assert.match(html, /<span class="group-input-mention">@Alice<\/span>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

void test("decorateGroupMarkdownMentions 只高亮正文里的提及，不改代码块", () => {
  const markdown = [
    "请 @Alice 先处理",
    "",
    "`@Bob 不应该高亮`",
    "",
    "```ts",
    "const text = '@Alice';",
    "```",
  ].join("\n");

  const decorated = decorateGroupMarkdownMentions(markdown, ["Alice", "Bob"]);

  assert.match(decorated, /<span class="group-message-mention">@Alice<\/span>/);
  assert.match(decorated, /`@Bob 不应该高亮`/);
  assert.match(decorated, /const text = '@Alice';/);
});
