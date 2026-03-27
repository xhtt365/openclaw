import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentNamesById,
  mergeSessionsWithKnownAgents,
  parseAgentSessionKey,
  resolveSessionAgentId,
} from "./chat-sessions";

void test("mergeSessionsWithKnownAgents 会补齐已创建员工的默认 1v1 会话", () => {
  const result = mergeSessionsWithKnownAgents(
    {
      defaults: {
        model: "MiniMax-M2.5",
      },
      sessions: [
        {
          key: "group:office-test",
          label: "office-test",
          updatedAt: 10,
        },
        {
          key: "agent:main:main",
          label: "main",
          updatedAt: 20,
        },
      ],
    },
    [
      { id: "main", name: "虾班" },
      { id: "zhoujielun", name: "周杰伦" },
    ],
    "main",
  );

  assert.deepEqual(
    result?.sessions?.map((row) => row.key),
    ["agent:main:main", "group:office-test", "agent:zhoujielun:main"],
  );
  assert.equal(
    result?.sessions?.find((row) => row.key === "agent:zhoujielun:main")?.displayName,
    "周杰伦",
  );
});

void test("parseAgentSessionKey 和 resolveSessionAgentId 能识别 1v1 会话", () => {
  assert.deepEqual(parseAgentSessionKey("agent:zhoujielun:main"), {
    agentId: "zhoujielun",
    rest: "main",
  });
  assert.equal(resolveSessionAgentId("agent:zhoujielun:main"), "zhoujielun");
  assert.equal(resolveSessionAgentId("group:office-test"), null);
});

void test("buildAgentNamesById 会优先使用员工显示名", () => {
  assert.deepEqual(
    buildAgentNamesById([
      { id: "main", name: "虾班" },
      { id: "zhoujielun", name: "周杰伦" },
    ]),
    {
      main: "虾班",
      zhoujielun: "周杰伦",
    },
  );
});
