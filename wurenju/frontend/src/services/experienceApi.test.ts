import assert from "node:assert/strict";
import { after, afterEach, before } from "node:test";
import test from "node:test";

const originalCrypto = globalThis.crypto;
const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;

let experienceApi: typeof import("./experienceApi").experienceApi;
let createExperienceApi: typeof import("./experienceApi").createExperienceApi;

before(async () => {
  ({ experienceApi, createExperienceApi } = await import("./experienceApi"));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;

  if (originalCrypto === undefined) {
    delete (globalThis as { crypto?: Crypto }).crypto;
    return;
  }

  Object.defineProperty(globalThis, "crypto", {
    value: originalCrypto,
    configurable: true,
  });
});

after(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;

  if (originalCrypto === undefined) {
    delete (globalThis as { crypto?: Crypto }).crypto;
    return;
  }

  Object.defineProperty(globalThis, "crypto", {
    value: originalCrypto,
    configurable: true,
  });
});

function resolveRequestUrl(input: RequestInfo | URL | undefined) {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  if (input instanceof Request) {
    return input.url;
  }

  return "";
}

function resolveRequestBody(body: BodyInit | null | undefined) {
  if (typeof body === "string") {
    return body;
  }

  if (body === null || body === undefined) {
    return "";
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  throw new Error(`Unexpected request body type: ${Object.prototype.toString.call(body)}`);
}

void test("writeProcessEvent 会补齐默认 id 与时间戳并序列化 taskTypeJson", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

  Object.defineProperty(globalThis, "crypto", {
    value: {
      randomUUID: () => "11111111-1111-4111-8111-111111111111",
    } satisfies Pick<Crypto, "randomUUID">,
    configurable: true,
  });
  Date.now = () => 1_700_000_000_000;

  globalThis.fetch = (async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ success: true }), {
      status: 201,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }) as typeof fetch;

  await experienceApi.writeProcessEvent({
    sessionKey: "agent:agent-1:group:group-1",
    groupId: "group-1",
    targetAgentId: "agent-1",
    feedbackType: "negative_explicit",
    senderId: "user-1",
    content: "错了，应该先保存",
    taskTypeJson: ["介绍"],
  });

  assert.equal(calls.length, 1);
  assert.equal(resolveRequestUrl(calls[0]?.input), "http://localhost:3001/api/experience/events");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(resolveRequestBody(calls[0]?.init?.body)), {
    id: "11111111-1111-4111-8111-111111111111",
    sessionKey: "agent:agent-1:group:group-1",
    groupId: "group-1",
    targetAgentId: "agent-1",
    type: "feedback",
    feedbackType: "negative_explicit",
    senderId: "user-1",
    content: "错了，应该先保存",
    taskTypeJson: '["介绍"]',
    createdAt: "1700000000000",
  });
});

void test("listProcessEvents、getLastFeedbackEvent 和 getExperiencesForInject 会用 URLSearchParams 拼接查询参数", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const api = createExperienceApi("http://localhost:3001/api/experience");

  globalThis.fetch = (async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }) as typeof fetch;

  await api.listProcessEvents({
    groupId: "group-1",
    targetAgentId: "agent-1",
    sessionKey: "agent:agent-1:group:group-1",
    limit: 10,
  });
  await api.getLastFeedbackEvent({
    groupId: "group-1",
    targetAgentId: "agent-1",
    sessionKey: "agent:agent-1:group:group-1",
  });
  await api.getExperiencesForInject({
    groupId: "group-1",
    agentId: "agent-1",
    taskType: "介绍",
    limit: 5,
  });

  assert.equal(
    resolveRequestUrl(calls[0]?.input),
    "http://localhost:3001/api/experience/events?groupId=group-1&targetAgentId=agent-1&sessionKey=agent%3Aagent-1%3Agroup%3Agroup-1&limit=10",
  );
  assert.equal(
    resolveRequestUrl(calls[1]?.input),
    "http://localhost:3001/api/experience/events/last?groupId=group-1&targetAgentId=agent-1&sessionKey=agent%3Aagent-1%3Agroup%3Agroup-1",
  );
  assert.equal(
    resolveRequestUrl(calls[2]?.input),
    "http://localhost:3001/api/experience/inject?groupId=group-1&agentId=agent-1&taskType=%E4%BB%8B%E7%BB%8D&limit=5",
  );
});

void test("upsertExperienceItem 在后端报错时会抛出有意义的 Error", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "保存经验失败" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    })) as unknown as typeof fetch;

  await assert.rejects(
    experienceApi.upsertExperienceItem({
      rule: "先给结论再补充细节",
    }),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.equal((error as Error).message, "保存经验失败");
      return true;
    },
  );
});

void test("upsertExperienceCandidate 复用 items 接口", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

  globalThis.fetch = (async (input, init) => {
    calls.push({ input, init });
    return new Response(
      JSON.stringify({
        id: "candidate-1",
        status: "pending",
        kind: "lesson",
        task_type_json: null,
        trigger: "错",
        rule: "先保存再继续",
        anti_pattern: "错了",
        group_id: "group-1",
        session_key: "agent:agent-1:group:group-1",
        feedback_score: 0.8,
        repeated_hits: 1,
        confidence: 0.8,
        conflict_with: null,
        superseded_by: null,
        created_at: "1700000000000",
        updated_at: "1700000000000",
        last_seen_at: null,
        valid_from: null,
        expires_at: null,
        risk: "medium",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  await experienceApi.upsertExperienceCandidate({
    id: "candidate-1",
    kind: "lesson",
    rule: "先保存再继续",
    groupId: "group-1",
    sessionKey: "agent:agent-1:group:group-1",
  });

  assert.equal(calls.length, 1);
  assert.equal(resolveRequestUrl(calls[0]?.input), "http://localhost:3001/api/experience/items");
  assert.equal(calls[0]?.init?.method, "POST");
});

void test("promoteExperience 和 deprecateExperience 会命中对应状态路由", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const api = createExperienceApi("http://localhost:3001/api/experience");

  globalThis.fetch = (async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ id: "exp-1", status: "verified" }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }) as typeof fetch;

  await api.promoteExperience("exp-1");
  await api.deprecateExperience("exp-1");

  assert.equal(
    resolveRequestUrl(calls[0]?.input),
    "http://localhost:3001/api/experience/items/exp-1/promote",
  );
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(
    resolveRequestUrl(calls[1]?.input),
    "http://localhost:3001/api/experience/items/exp-1/deprecate",
  );
  assert.equal(calls[1]?.init?.method, "POST");
});
