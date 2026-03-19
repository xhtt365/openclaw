import assert from "node:assert/strict";
import { after, before } from "node:test";
import test from "node:test";
import { runGrowthTests } from "./growthTestRunner";

class MemoryStorage implements Storage {
  private storage = new Map<string, string>();

  get length() {
    return this.storage.size;
  }

  clear() {
    this.storage.clear();
  }

  getItem(key: string) {
    return this.storage.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.storage.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.storage.delete(key);
  }

  setItem(key: string, value: string) {
    this.storage.set(key, value);
  }
}

class MockWindow extends EventTarget {
  constructor(public localStorage: Storage) {
    super();
  }
}

const memoryStorage = new MemoryStorage();
const originalWindow = globalThis.window;

before(() => {
  Object.defineProperty(globalThis, "window", {
    value: new MockWindow(memoryStorage),
    configurable: true,
    writable: true,
  });
});

after(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: Window }).window;
  } else {
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
  }
});

void test("runGrowthTests 会完成 9 条成长验收并在结束后清理测试数据", async () => {
  const summary = await runGrowthTests();

  assert.equal(summary.passed, 9);
  assert.equal(summary.failed, 0);
  assert.deepEqual(summary.failedItems, []);
});
