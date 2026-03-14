import test from "node:test"
import assert from "node:assert/strict"
import { normalizeRestartGatewayError } from "./gateway"

test("normalizeRestartGatewayError 把旧网关的 unknown method 翻译成中文提示", () => {
  const normalized = normalizeRestartGatewayError(new Error("unknown method: gateway.restart"))

  assert.equal(
    normalized.message,
    "当前 Gateway 版本还不支持页面内重启。请先手动重启一次 Gateway，加载最新版本后再试。"
  )
})

test("normalizeRestartGatewayError 保留其他真实错误", () => {
  const normalized = normalizeRestartGatewayError(new Error("gateway connection closed"))

  assert.equal(normalized.message, "gateway connection closed")
})
