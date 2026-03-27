import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./toast.tsx", import.meta.url), "utf8");

void test("toast.tsx 让 Toast 跟随容器定位而不是固定到全局右上角", () => {
  assert.match(source, /pointer-events-auto relative flex/);
  assert.match(source, /absolute inset-x-0 top-0/);
  assert.doesNotMatch(source, /fixed top-4 right-4/);
});
