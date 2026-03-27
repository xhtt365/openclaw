import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "./index.js";

function createApi(overrides: Record<string, unknown> = {}) {
  const on = vi.fn();
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const api = {
    id: "hooks-experience",
    name: "Hooks Experience",
    description: "Hooks Experience",
    source: "test",
    config: {},
    pluginConfig: undefined,
    runtime: {} as never,
    logger,
    registerTool() {},
    registerHook() {},
    registerHttpRoute() {},
    registerChannel() {},
    registerGatewayMethod() {},
    registerCli() {},
    registerService() {},
    registerProvider() {},
    registerCommand() {},
    registerContextEngine() {},
    resolvePath(input: string) {
      return input;
    },
    on,
    ...overrides,
  };

  return { api, on, logger };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("hooks-experience plugin", () => {
  it("registers a before_prompt_build hook", () => {
    const { api, on } = createApi();

    plugin.register(api as never);

    expect(on).toHaveBeenCalledTimes(1);
    expect(on.mock.calls[0]?.[0]).toBe("before_prompt_build");
  });

  it("injects verified experience into prependSystemContext and recent items into prependContext", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        verified: [{ kind: "lesson", trigger: "介绍产品", rule: "先给一句结论，再展开细节" }],
        recent: [{ kind: "anti_pattern", trigger: "复盘", anti_pattern: "不要先争辩责任归属" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { api, on } = createApi();
    plugin.register(api as never);

    const handler = on.mock.calls[0]?.[1] as
      | ((
          event: { prompt: string; messages: unknown[] },
          ctx: Record<string, unknown>,
        ) => Promise<unknown>)
      | undefined;
    const result = (await handler?.(
      { prompt: "帮我回复", messages: [] },
      { sessionKey: "agent:agent-1:group:team%2Falpha" },
    )) as
      | {
          prependSystemContext?: string;
          prependContext?: string;
        }
      | undefined;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [rawUrl, init] = fetchMock.mock.calls[0] ?? [];
    const url = new URL(String(rawUrl));
    expect(url.origin + url.pathname).toBe("http://localhost:3001/api/experience/inject");
    expect(url.searchParams.get("groupId")).toBe("team/alpha");
    expect(url.searchParams.get("agentId")).toBe("agent-1");
    expect(url.searchParams.get("limit")).toBe("6");
    expect(init).toMatchObject({
      signal: expect.any(AbortSignal),
    });
    expect(result?.prependSystemContext).toContain("【已验证经验】");
    expect(result?.prependSystemContext).toContain("先给一句结论");
    expect(result?.prependContext).toContain("【近期候选经验】");
    expect(result?.prependContext).toContain("待验证");
    expect(result?.prependContext).toContain("不要先争辩责任归属");
  });

  it("skips injection when the session key does not encode a group scope", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { api, on } = createApi();
    plugin.register(api as never);

    const handler = on.mock.calls[0]?.[1] as
      | ((
          event: { prompt: string; messages: unknown[] },
          ctx: Record<string, unknown>,
        ) => Promise<unknown>)
      | undefined;
    const result = await handler?.(
      { prompt: "hello", messages: [] },
      { sessionKey: "agent:main:main" },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("fails open when the inject request throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("boom"));
    vi.stubGlobal("fetch", fetchMock);

    const { api, on, logger } = createApi();
    plugin.register(api as never);

    const handler = on.mock.calls[0]?.[1] as
      | ((
          event: { prompt: string; messages: unknown[] },
          ctx: Record<string, unknown>,
        ) => Promise<unknown>)
      | undefined;
    const result = await handler?.(
      { prompt: "hello", messages: [] },
      { agentId: "agent-1", sessionKey: "agent:agent-1:group:group-1" },
    );

    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("hooks-experience: inject request failed:"),
    );
  });
});
