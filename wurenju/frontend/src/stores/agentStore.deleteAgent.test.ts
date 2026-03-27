import assert from "node:assert/strict";
import { after, afterEach, before } from "node:test";
import test from "node:test";
import { gateway } from "@/services/gateway";
import type { Agent } from "../types/agent";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const originalDeleteAgent = gateway.deleteAgent.bind(gateway);

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
    showDetailFor: null,
    agentFiles: new Map(),
    activeFileName: null,
    fileContent: "",
    fileDirty: false,
    fileSaving: false,
    fileLoading: false,
    currentAgentModel: null,
  });
  globalThis.fetch = originalFetch;
  gateway.deleteAgent = originalDeleteAgent;
});

after(() => {
  globalThis.fetch = originalFetch;
  gateway.deleteAgent = originalDeleteAgent;

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

void test("deleteAgent 在 Gateway 中不存在目标 Agent 时仍会删除本地员工记录", async () => {
  const agents: Agent[] = [
    {
      id: "ghost",
      name: "幽灵员工",
      emoji: "👻",
    },
    {
      id: "alive",
      name: "正常员工",
      emoji: "🙂",
    },
  ];
  const gatewayCalls: Array<{ agentId: string; deleteFiles: boolean }> = [];
  const fetchCalls: Array<{ url: string; method: string }> = [];

  useAgentStore.setState({
    agents,
    currentAgentId: "ghost",
  });

  gateway.deleteAgent = (async (agentId, deleteFiles = true) => {
    gatewayCalls.push({ agentId, deleteFiles });
    throw new Error(`agent "${agentId}" not found`);
  }) as typeof gateway.deleteAgent;

  globalThis.fetch = (async (input, init) => {
    fetchCalls.push({
      url: String(input),
      method: (init?.method ?? "GET").toUpperCase(),
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }) as typeof fetch;

  const result = await useAgentStore.getState().deleteAgent("ghost", true);

  assert.deepEqual(gatewayCalls, [{ agentId: "ghost", deleteFiles: true }]);
  assert.deepEqual(fetchCalls, [
    {
      url: "http://localhost:3001/api/employees/ghost",
      method: "DELETE",
    },
  ]);
  assert.deepEqual(
    useAgentStore.getState().agents.map((agent) => agent.id),
    ["alive"],
  );
  assert.equal(useAgentStore.getState().currentAgentId, "alive");
  assert.equal(result.nextAgentId, "alive");
});

void test("deleteAgent 在 SQLite 删除失败时不会假装删除成功", async () => {
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

  gateway.deleteAgent = (async () => ({
    ok: true,
    agentId: "dev",
    removedBindings: 1,
  })) as typeof gateway.deleteAgent;

  globalThis.fetch = (async (_input, init) => {
    return new Response(JSON.stringify({ error: "db locked" }), {
      status: (init?.method ?? "GET").toUpperCase() === "DELETE" ? 500 : 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }) as typeof fetch;

  await assert.rejects(
    useAgentStore.getState().deleteAgent("dev", true),
    /db locked|删除员工失败|请求失败/u,
  );

  assert.deepEqual(
    useAgentStore.getState().agents.map((agent) => agent.id),
    ["dev", "qa"],
  );
  assert.equal(useAgentStore.getState().currentAgentId, "dev");
});
