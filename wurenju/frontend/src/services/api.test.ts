import assert from "node:assert/strict";
import { after, afterEach, before } from "node:test";
import test from "node:test";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;

let employeesApi: typeof import("./api").employeesApi;
let groupsApi: typeof import("./api").groupsApi;
let archivesApi: typeof import("./api").archivesApi;

before(async () => {
  Object.defineProperty(globalThis, "window", {
    value: {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    },
    configurable: true,
    writable: true,
  });

  ({ employeesApi, groupsApi, archivesApi } = await import("./api"));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

after(() => {
  globalThis.fetch = originalFetch;

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

void test("PUT 更新默认不再强制 keepalive，避免大请求体被浏览器拦截", async () => {
  const largeDataUrl = `data:image/png;base64,${"a".repeat(70_000)}`;
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

  globalThis.fetch = (async (input, init) => {
    calls.push({ input, init });

    if (String(input).includes("/employees/")) {
      return new Response(
        JSON.stringify({
          id: "dev",
          name: "小王",
          avatar: largeDataUrl,
          position: "前端",
          department: null,
          description: null,
          pinned: 0,
          sort_order: 0,
          created_at: "2026-03-21T10:00:00.000Z",
          updated_at: "2026-03-21T10:00:00.000Z",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    return new Response(
      JSON.stringify({
        id: "group-1",
        name: "测试项目组",
        icon: largeDataUrl,
        description: null,
        owner_agent_id: "lead",
        announcement: null,
        announcement_version: 0,
        urge_enabled: 0,
        urge_paused: 0,
        urge_interval: 10,
        urge_last_checked_at: null,
        max_rounds: 20,
        created_at: "2026-03-21T10:00:00.000Z",
        updated_at: "2026-03-21T10:00:00.000Z",
        members: [{ group_id: "group-1", agent_id: "lead", role: "owner" }],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  await employeesApi.update("dev", { avatar: largeDataUrl });
  await groupsApi.update("group-1", { icon: largeDataUrl, urgeEnabled: false });

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(calls[1]?.init?.method, "PUT");
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0]?.init ?? {}, "keepalive"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(calls[1]?.init ?? {}, "keepalive"), false);
});

void test("DELETE 默认启用 keepalive，刷新页面时也会尽量完成删除请求", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

  globalThis.fetch = (async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }) as typeof fetch;

  await employeesApi.remove("dev");
  await groupsApi.remove("group-1");
  await archivesApi.remove("archive-1");

  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.init?.method, "DELETE");
  assert.equal(calls[1]?.init?.method, "DELETE");
  assert.equal(calls[2]?.init?.method, "DELETE");
  assert.equal(calls[0]?.init?.keepalive, true);
  assert.equal(calls[1]?.init?.keepalive, true);
  assert.equal(calls[2]?.init?.keepalive, true);
});

void test("督促状态更新可显式开启 keepalive，但普通更新默认保持关闭", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

  globalThis.fetch = (async (input, init) => {
    calls.push({ input, init });

    return new Response(
      JSON.stringify({
        id: "group-1",
        name: "测试项目组",
        icon: null,
        description: null,
        owner_agent_id: "lead",
        announcement: null,
        announcement_version: 0,
        urge_enabled: 0,
        urge_paused: 0,
        urge_interval: 10,
        urge_last_checked_at: null,
        max_rounds: 20,
        created_at: "2026-03-21T10:00:00.000Z",
        updated_at: "2026-03-21T10:00:00.000Z",
        members: [{ group_id: "group-1", agent_id: "lead", role: "owner" }],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  await groupsApi.update("group-1", { urgeEnabled: false });
  await groupsApi.update("group-1", { urgeEnabled: true }, { keepalive: true });

  assert.equal(calls.length, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0]?.init ?? {}, "keepalive"), false);
  assert.equal(calls[1]?.init?.keepalive, true);
});
