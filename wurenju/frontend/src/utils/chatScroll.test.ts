import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_AUTO_SCROLL_THRESHOLD_PX,
  getScrollBottomTop,
  getShouldStickToBottomOnWheel,
  isScrollNearBottom,
} from "./chatScroll";

void test("isScrollNearBottom 会识别接近底部的滚动位置", () => {
  assert.equal(
    isScrollNearBottom({
      scrollTop: 552,
      clientHeight: 400,
      scrollHeight: 1000,
    }),
    true,
  );
});

void test("isScrollNearBottom 会识别正在查看历史消息的滚动位置", () => {
  assert.equal(
    isScrollNearBottom({
      scrollTop: 400,
      clientHeight: 400,
      scrollHeight: 1000,
    }),
    false,
  );
});

void test("getScrollBottomTop 会返回滚到底部需要的 scrollTop", () => {
  assert.equal(
    getScrollBottomTop({
      clientHeight: 400,
      scrollHeight: 1000,
    }),
    600,
  );
});

void test("getScrollBottomTop 会对短内容做 0 钳制", () => {
  assert.equal(
    getScrollBottomTop({
      clientHeight: 400,
      scrollHeight: 220,
    }),
    0,
  );
  assert.equal(CHAT_AUTO_SCROLL_THRESHOLD_PX > 0, true);
});

void test("getShouldStickToBottomOnWheel 会在向上滚动时立即解除贴底锁", () => {
  assert.equal(
    getShouldStickToBottomOnWheel(
      {
        scrollTop: 600,
        clientHeight: 400,
        scrollHeight: 1000,
      },
      -120,
    ),
    false,
  );
});

void test("getShouldStickToBottomOnWheel 会在底部附近向下滚动时保持贴底", () => {
  assert.equal(
    getShouldStickToBottomOnWheel(
      {
        scrollTop: 552,
        clientHeight: 400,
        scrollHeight: 1000,
      },
      120,
    ),
    true,
  );
});
