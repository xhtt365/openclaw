import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHANNEL_STORAGE_KEY_PREFIX,
  createEmptyChannelConfigDraft,
  readAgentChannelConfig,
  saveAgentChannelConfig,
  saveAgentChannelSection,
} from "@/utils/channelConfig";

type MockWindow = Window & {
  localStorage: Storage;
};

function createMockStorage(): Storage {
  const store = new Map<string, string>();

  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    get length() {
      return store.size;
    },
  };
}

function createMockWindow() {
  return {
    localStorage: createMockStorage(),
    dispatchEvent() {
      return true;
    },
  } as unknown as MockWindow;
}

describe("channelConfig", () => {
  let mockWindow: MockWindow;

  beforeEach(() => {
    mockWindow = createMockWindow();
    vi.stubGlobal("window", mockWindow);
    vi.stubGlobal("localStorage", mockWindow.localStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("在没有存储数据时返回空白默认值", () => {
    expect(readAgentChannelConfig("agent-main")).toEqual(createEmptyChannelConfigDraft());
  });

  it("保存完整配置后会按员工维度落盘", () => {
    const saved = saveAgentChannelConfig("agent-main", {
      dingtalk: {
        appId: "ding-app",
        appSecret: "ding-secret",
        enabled: true,
      },
      feishu: {
        appId: "fei-app",
        appSecret: "fei-secret",
        enabled: false,
      },
      telegram: {
        botToken: "tg-token",
        enabled: true,
      },
    });

    expect(saved.telegram.botToken).toBe("tg-token");
    expect(readAgentChannelConfig("agent-main")).toEqual(saved);
    expect(mockWindow.localStorage.getItem(`${CHANNEL_STORAGE_KEY_PREFIX}agent-main`)).toContain(
      '"botToken":"tg-token"',
    );
  });

  it("只保存当前渠道时会保留其他渠道已保存内容", () => {
    saveAgentChannelConfig("agent-main", {
      dingtalk: {
        appId: "ding-app",
        appSecret: "ding-secret",
        enabled: true,
      },
      feishu: {
        appId: "",
        appSecret: "",
        enabled: false,
      },
      telegram: {
        botToken: "",
        enabled: false,
      },
    });

    const next = saveAgentChannelSection("agent-main", "telegram", {
      botToken: "tg-token",
      enabled: true,
    });

    expect(next.dingtalk.appId).toBe("ding-app");
    expect(next.telegram.botToken).toBe("tg-token");
    expect(readAgentChannelConfig("agent-main")).toEqual(next);
  });
});
