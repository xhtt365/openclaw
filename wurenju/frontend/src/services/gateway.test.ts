import assert from "node:assert/strict";
import test from "node:test";
import { gateway, normalizeRestartGatewayError } from "./gateway";

void test("normalizeRestartGatewayError 把旧网关的 unknown method 翻译成中文提示", () => {
  const normalized = normalizeRestartGatewayError(new Error("unknown method: gateway.restart"));

  assert.equal(
    normalized.message,
    "当前 Gateway 版本还不支持页面内重启。请先手动重启一次 Gateway，加载最新版本后再试。",
  );
});

void test("normalizeRestartGatewayError 保留其他真实错误", () => {
  const normalized = normalizeRestartGatewayError(new Error("gateway connection closed"));

  assert.equal(normalized.message, "gateway connection closed");
});

void test("sendAgentTurn 会走 agent RPC 并携带 extraSystemPrompt", async () => {
  const originalSendRequest = gateway.sendRequest.bind(gateway);
  let captured:
    | {
        method: string;
        params: Record<string, unknown> | undefined;
        timeoutMs: number | undefined;
      }
    | undefined;

  gateway.sendRequest = (async (method, params, timeoutMs) => {
    captured = { method, params, timeoutMs };
    return { runId: "run-1", status: "accepted" };
  }) as typeof gateway.sendRequest;

  try {
    const result = await gateway.sendAgentTurn({
      agentId: "main",
      sessionKey: "agent:main:main",
      message: "你好",
      extraSystemPrompt: "【群公告】\n先看公告",
      deliver: false,
    });

    assert.equal(result.runId, "run-1");
    assert.equal(captured?.method, "agent");
    assert.equal(captured?.params?.agentId, "main");
    assert.equal(captured?.params?.sessionKey, "agent:main:main");
    assert.equal(captured?.params?.message, "你好");
    assert.equal(captured?.params?.extraSystemPrompt, "【群公告】\n先看公告");
    assert.equal(captured?.params?.deliver, false);
    assert.equal(typeof captured?.params?.idempotencyKey, "string");
  } finally {
    gateway.sendRequest = originalSendRequest;
  }
});

void test("waitForAgentRun 会用更长超时调用 agent.wait", async () => {
  const originalSendRequest = gateway.sendRequest.bind(gateway);
  let captured:
    | {
        method: string;
        params: Record<string, unknown> | undefined;
        timeoutMs: number | undefined;
      }
    | undefined;

  gateway.sendRequest = (async (method, params, timeoutMs) => {
    captured = { method, params, timeoutMs };
    return { runId: "run-2", status: "ok" };
  }) as typeof gateway.sendRequest;

  try {
    const result = await gateway.waitForAgentRun("run-2", 4567);

    assert.equal(result.status, "ok");
    assert.equal(captured?.method, "agent.wait");
    assert.deepEqual(captured?.params, {
      runId: "run-2",
      timeoutMs: 4567,
    });
    assert.equal(captured?.timeoutMs, 9567);
  } finally {
    gateway.sendRequest = originalSendRequest;
  }
});

void test("abortSession 会调用 chat.abort 并透传 sessionKey", async () => {
  const originalSendRequest = gateway.sendRequest.bind(gateway);
  let captured:
    | {
        method: string;
        params: Record<string, unknown> | undefined;
        timeoutMs: number | undefined;
      }
    | undefined;

  gateway.sendRequest = (async (method, params, timeoutMs) => {
    captured = { method, params, timeoutMs };
    return { ok: true, aborted: true, runIds: ["run-3"] };
  }) as typeof gateway.sendRequest;

  try {
    const result = await gateway.abortSession("agent:main:group:project-a");

    assert.equal(result.ok, true);
    assert.equal(result.aborted, true);
    assert.equal(captured?.method, "chat.abort");
    assert.deepEqual(captured?.params, {
      sessionKey: "agent:main:group:project-a",
    });
    assert.equal(captured?.timeoutMs, undefined);
  } finally {
    gateway.sendRequest = originalSendRequest;
  }
});
