import assert from "node:assert/strict";
import test from "node:test";
import { PROVIDER_PRESETS } from "./modelProviders";

void test("PROVIDER_PRESETS 使用新的供应商顺序和默认模型", () => {
  assert.deepEqual(
    PROVIDER_PRESETS.map((preset) => preset.providerId),
    ["minimax", "bailian", "volcengine", "deepseek", "openai", "google", "custom"],
  );

  assert.deepEqual(
    PROVIDER_PRESETS.map((preset) => ({
      providerId: preset.providerId,
      modelIds: preset.models.map((model) => model.id),
    })),
    [
      { providerId: "minimax", modelIds: ["MiniMax-M2.5"] },
      { providerId: "bailian", modelIds: ["qwen3-max"] },
      { providerId: "volcengine", modelIds: ["deepseek-v3.2"] },
      { providerId: "deepseek", modelIds: ["deepseek-chat"] },
      { providerId: "openai", modelIds: ["gpt-5.4"] },
      { providerId: "google", modelIds: ["gemini-2.5-pro"] },
      { providerId: "custom", modelIds: [] },
    ],
  );
});
