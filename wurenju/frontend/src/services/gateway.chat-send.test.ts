import assert from "node:assert/strict";
import test from "node:test";
import { gateway } from "./gateway";

type GatewayPrivate = {
  ws: { readyState: number; send: (raw: string) => void; close: () => void } | null;
  isHandshakeComplete: boolean;
  pendingRequests: Map<string, unknown>;
  pendingChatRuns: Map<string, string>;
  reconnectTimer: number | null;
  connectPromise: Promise<void> | null;
  connectRequestId: string | null;
  connectNonce: string | null;
  grantedScopes: string[];
  gatewayStateDir: string | null;
  handleMessage: (frame: Record<string, unknown>) => void;
};

function setupGatewayHarness() {
  const internal = gateway as unknown as GatewayPrivate;
  const frames: Array<Record<string, unknown>> = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const openState = typeof WebSocket === "undefined" ? 1 : WebSocket.OPEN;
  Reflect.set(globalThis, "setTimeout", ((callback: TimerHandler) => {
    void callback;
    return 1;
  }) as typeof globalThis.setTimeout);
  Reflect.set(globalThis, "clearTimeout", (() => undefined) as typeof globalThis.clearTimeout);

  gateway.setHandlers(
    () => {},
    () => {},
  );
  internal.ws = {
    readyState: openState,
    send(raw: string) {
      frames.push(JSON.parse(raw) as Record<string, unknown>);
    },
    close() {},
  };
  internal.isHandshakeComplete = true;
  internal.pendingRequests = new Map();
  internal.pendingChatRuns = new Map();
  internal.reconnectTimer = null;
  internal.connectPromise = Promise.resolve();
  internal.connectRequestId = null;
  internal.connectNonce = null;
  internal.grantedScopes = [];
  internal.gatewayStateDir = null;

  return {
    frames,
    internal,
    restore() {
      internal.pendingRequests.clear();
      internal.pendingChatRuns.clear();
      internal.ws = null;
      internal.isHandshakeComplete = false;
      internal.reconnectTimer = null;
      internal.connectPromise = null;
      internal.connectRequestId = null;
      internal.connectNonce = null;
      internal.grantedScopes = [];
      internal.gatewayStateDir = null;
      Reflect.set(globalThis, "setTimeout", originalSetTimeout);
      Reflect.set(globalThis, "clearTimeout", originalClearTimeout);
    },
  };
}

void test("sendRequest(chat.send) 收到 accepted 回执后应立即 resolve", async () => {
  const harness = setupGatewayHarness();

  try {
    const promise = gateway.sendRequest<{ runId: string; status: string }>(
      "chat.send",
      {
        sessionKey: "agent:main:main",
        message: "你好",
      },
      1000,
    );

    await Promise.resolve();
    const requestId = harness.frames[0]?.id;
    assert.equal(typeof requestId, "string");

    harness.internal.handleMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: {
        runId: "run-accepted",
        status: "accepted",
      },
    });

    const result = await promise;
    assert.equal(result.runId, "run-accepted");
    assert.equal(result.status, "accepted");
    assert.equal(harness.internal.pendingRequests.size, 0);
    assert.equal(harness.internal.pendingChatRuns.size, 0);
  } finally {
    harness.restore();
  }
});

void test("sendChat 辅助方法仍然等待最终 chat 事件再结束", async () => {
  const harness = setupGatewayHarness();

  try {
    const promise = gateway.sendChat("你好", "agent:main:main");

    await Promise.resolve();
    const requestId = harness.frames[0]?.id;
    assert.equal(typeof requestId, "string");

    harness.internal.handleMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: {
        runId: "run-final",
        status: "accepted",
      },
    });

    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    assert.equal(settled, false);

    harness.internal.handleMessage({
      type: "event",
      event: "chat",
      payload: {
        runId: "run-final",
        sessionKey: "agent:main:main",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "收到" }],
          timestamp: Date.now(),
        },
      },
    });

    const result = await promise;
    assert.equal(result.ok, true);
    assert.equal(harness.internal.pendingRequests.size, 0);
    assert.equal(harness.internal.pendingChatRuns.size, 0);
  } finally {
    harness.restore();
  }
});

void test("sendChat 会把 dataUrl 附件转成 chat.send 所需的 image 附件 payload", async () => {
  const harness = setupGatewayHarness();

  try {
    const promise = gateway.sendChat("看下这张图", "agent:main:main", [
      {
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,ZmFrZS1pbWFnZQ==",
      },
    ]);

    await Promise.resolve();
    const params = harness.frames[0]?.params as Record<string, unknown> | undefined;
    assert.equal(Array.isArray(params?.attachments), true);
    assert.deepEqual(params?.attachments, [
      {
        type: "image",
        mimeType: "image/png",
        content: "ZmFrZS1pbWFnZQ==",
      },
    ]);

    harness.internal.handleMessage({
      type: "res",
      id: harness.frames[0]?.id,
      ok: true,
      payload: {
        runId: "run-attachment",
        status: "accepted",
      },
    });

    harness.internal.handleMessage({
      type: "event",
      event: "chat",
      payload: {
        runId: "run-attachment",
        sessionKey: "agent:main:main",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "收到附件" }],
          timestamp: Date.now(),
        },
      },
    });

    const result = await promise;
    assert.equal(result.ok, true);
  } finally {
    harness.restore();
  }
});
