import assert from "node:assert/strict";
import test from "node:test";
import {
  handleUserProfileNameInputKeydown,
  handleUserProfilePopoverActionEvent,
} from "./userProfilePopoverDom";

void test("handleUserProfileNameInputKeydown 会拦截回车并触发保存关闭流程", () => {
  let prevented = false;
  let blurred = false;
  let committed = false;

  const handled = handleUserProfileNameInputKeydown(
    {
      key: "Enter",
      preventDefault: () => {
        prevented = true;
      },
    },
    () => {
      blurred = true;
    },
    () => {
      committed = true;
    },
  );

  assert.equal(handled, true);
  assert.equal(prevented, true);
  assert.equal(blurred, true);
  assert.equal(committed, true);
});

void test("handleUserProfileNameInputKeydown 遇到非回车键不会触发保存", () => {
  let prevented = false;
  let blurred = false;
  let committed = false;

  const handled = handleUserProfileNameInputKeydown(
    {
      key: "Escape",
      preventDefault: () => {
        prevented = true;
      },
    },
    () => {
      blurred = true;
    },
    () => {
      committed = true;
    },
  );

  assert.equal(handled, false);
  assert.equal(prevented, false);
  assert.equal(blurred, false);
  assert.equal(committed, false);
});

void test("handleUserProfilePopoverActionEvent 会阻止默认行为并执行关闭逻辑", () => {
  let prevented = false;
  let stopped = false;
  let committed = false;

  handleUserProfilePopoverActionEvent(
    {
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {
        stopped = true;
      },
    },
    () => {
      committed = true;
    },
  );

  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(committed, true);
});
