import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  USER_AVATAR_STORAGE_KEY,
  USER_NAME_STORAGE_KEY,
  getUserProfile,
  saveUserAvatar,
  saveUserName,
  subscribeToUserProfile,
} from "@/utils/userProfile";

type MockWindow = Window & {
  __listeners?: Record<string, Set<EventListenerOrEventListenerObject>>;
};

function createMockStorage() {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
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
  };
}

function createMockWindow() {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const localStorage = createMockStorage();

  const mockWindow = {
    localStorage,
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const bucket = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event: Event) {
      const bucket = listeners.get(event.type);
      if (!bucket) {
        return true;
      }

      for (const listener of bucket) {
        if (typeof listener === "function") {
          listener(event);
        } else {
          listener.handleEvent(event);
        }
      }
      return true;
    },
  } as MockWindow;

  return mockWindow;
}

describe("userProfile", () => {
  let mockWindow: MockWindow;

  beforeEach(() => {
    mockWindow = createMockWindow();
    vi.stubGlobal("window", mockWindow);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads normalized avatar and name from xiaban storage keys", () => {
    mockWindow.localStorage.setItem(USER_AVATAR_STORAGE_KEY, " data:image/jpeg;base64,abc ");
    mockWindow.localStorage.setItem(USER_NAME_STORAGE_KEY, "  小龙虾  ");

    expect(getUserProfile()).toEqual({
      avatar: "data:image/jpeg;base64,abc",
      name: "小龙虾",
    });
  });

  it("migrates legacy userAvatar into xiaban storage", () => {
    mockWindow.localStorage.setItem("userAvatar", "data:image/jpeg;base64,legacy");

    expect(getUserProfile()).toEqual({
      avatar: "data:image/jpeg;base64,legacy",
      name: null,
    });
    expect(mockWindow.localStorage.getItem(USER_AVATAR_STORAGE_KEY)).toBe(
      "data:image/jpeg;base64,legacy",
    );
  });

  it("publishes profile updates to subscribers", () => {
    const profiles: Array<ReturnType<typeof getUserProfile>> = [];
    const unsubscribe = subscribeToUserProfile((profile) => {
      profiles.push(profile);
    });

    saveUserAvatar("data:image/jpeg;base64,next");
    saveUserName("  虾班用户  ");

    expect(profiles.at(-1)).toEqual({
      avatar: "data:image/jpeg;base64,next",
      name: "虾班用户",
    });

    unsubscribe();
  });
});
