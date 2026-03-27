import assert from "node:assert/strict";
import { after, afterEach, before } from "node:test";
import test from "node:test";
import type { Agent } from "../types/agent";

const originalWindow = globalThis.window;

let useAgentStore: typeof import("./agentStore").useAgentStore;

before(async () => {
  Object.defineProperty(globalThis, "window", {
    value: {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    },
    configurable: true,
    writable: true,
  });

  ({ useAgentStore } = await import("./agentStore"));
});

afterEach(() => {
  useAgentStore.setState({
    agents: [],
    currentAgentId: "",
  });
});

after(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: Window }).window;
    return;
  }

  Object.defineProperty(globalThis, "window", {
    value: originalWindow,
    configurable: true,
    writable: true,
  });
});

void test("setCurrentAgent 会切换当前员工", () => {
  const agents: Agent[] = [
    {
      id: "dev",
      name: "小王",
      emoji: "🧑‍💻",
    },
    {
      id: "qa",
      name: "小李",
      emoji: "🧪",
    },
  ];

  useAgentStore.setState({
    agents,
    currentAgentId: "dev",
  });

  useAgentStore.getState().setCurrentAgent("qa");

  assert.equal(useAgentStore.getState().currentAgentId, "qa");
});
