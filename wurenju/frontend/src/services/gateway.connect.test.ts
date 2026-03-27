import assert from "node:assert/strict";
import test from "node:test";
import { gateway } from "./gateway";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener() {}

  removeEventListener() {}

  send() {}

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
}

void test("connect 使用 mock WebSocket，不触发真实 Gateway 连接", () => {
  const originalWebSocket = globalThis.WebSocket;
  const statuses: Array<"connecting" | "connected" | "disconnected"> = [];

  MockWebSocket.instances = [];
  gateway.disconnect();
  gateway.setHandlers(
    () => {},
    (status) => {
      statuses.push(status);
    },
  );
  Reflect.set(globalThis, "WebSocket", MockWebSocket);

  try {
    gateway.connect();

    assert.equal(MockWebSocket.instances.length, 1);
    assert.equal(MockWebSocket.instances[0]?.url, "ws://localhost:18789");
    assert.deepEqual(statuses, ["connecting"]);
  } finally {
    Reflect.set(gateway as object, "connectPromise", null);
    Reflect.set(gateway as object, "resolveConnectPromise", null);
    Reflect.set(gateway as object, "rejectConnectPromise", null);
    gateway.disconnect();
    if (originalWebSocket) {
      Reflect.set(globalThis, "WebSocket", originalWebSocket);
    } else {
      Reflect.deleteProperty(globalThis, "WebSocket");
    }
  }
});
