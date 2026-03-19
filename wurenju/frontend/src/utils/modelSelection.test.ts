import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProviderGroup } from "../types/model";
import {
  buildCandidateModelCatalog,
  buildVisibleCandidateModels,
  filterCandidateModels,
  normalizeUniqueModelRefs,
  reorderVisibleModelRefs,
  toggleCandidateModelSelection,
  type CandidateModel,
} from "./modelSelection";

const GROUPS: ModelProviderGroup[] = [
  {
    provider: "minimax",
    models: [
      { id: "MiniMax-M2.5", name: "MiniMax-M2.5", contextWindow: 200000 },
      { id: "MiniMax-M2.1", name: "MiniMax-M2.1", contextWindow: 198000 },
    ],
  },
  {
    provider: "bailian",
    models: [{ id: "qwen3-max", name: "qwen3-max", contextWindow: 131072 }],
  },
];

void test("normalizeUniqueModelRefs 会去重并忽略空值", () => {
  assert.deepEqual(
    normalizeUniqueModelRefs([" minimax/MiniMax-M2.5 ", "", "minimax/MiniMax-M2.5"]),
    ["minimax/MiniMax-M2.5"],
  );
});

void test("buildCandidateModelCatalog 会按供应商元数据构建模型目录", () => {
  const catalog = buildCandidateModelCatalog(GROUPS);

  assert.deepEqual(
    catalog.map((item) => ({
      providerId: item.providerId,
      modelId: item.modelId,
      providerDisplayName: item.providerDisplayName,
      modelDisplayName: item.modelDisplayName,
    })),
    [
      {
        providerId: "minimax",
        modelId: "MiniMax-M2.5",
        providerDisplayName: "MiniMax",
        modelDisplayName: "MiniMax M2.5",
      },
      {
        providerId: "minimax",
        modelId: "MiniMax-M2.1",
        providerDisplayName: "MiniMax",
        modelDisplayName: "MiniMax-M2.1",
      },
      {
        providerId: "bailian",
        modelId: "qwen3-max",
        providerDisplayName: "阿里云百炼",
        modelDisplayName: "Qwen3-Max",
      },
    ],
  );
});

void test("buildVisibleCandidateModels 会保留已选但目录里不存在的模型", () => {
  const catalog = buildCandidateModelCatalog(GROUPS);
  const visible = buildVisibleCandidateModels(catalog, [
    "custom/proxy-model",
    "minimax/MiniMax-M2.5",
  ]);

  assert.equal(visible[0]?.modelRef, "custom/proxy-model");
  assert.equal(visible[1]?.modelRef, "minimax/MiniMax-M2.5");
});

void test("filterCandidateModels 支持按模型名和供应商名搜索", () => {
  const models: CandidateModel[] = buildCandidateModelCatalog(GROUPS);

  assert.deepEqual(
    filterCandidateModels(models, "百炼").map((item) => item.modelRef),
    ["bailian/qwen3-max"],
  );
  assert.deepEqual(
    filterCandidateModels(models, "m2.5").map((item) => item.modelRef),
    ["minimax/MiniMax-M2.5"],
  );
});

void test("toggleCandidateModelSelection 勾选追加到末尾，取消后移除", () => {
  const selected = toggleCandidateModelSelection(
    ["minimax/MiniMax-M2.5"],
    "bailian/qwen3-max",
    true,
  );
  assert.deepEqual(selected, ["minimax/MiniMax-M2.5", "bailian/qwen3-max"]);

  assert.deepEqual(toggleCandidateModelSelection(selected, "minimax/MiniMax-M2.5", false), [
    "bailian/qwen3-max",
  ]);
});

void test("reorderVisibleModelRefs 在搜索结果重排时会保留隐藏模型位置", () => {
  const reordered = reorderVisibleModelRefs(
    ["a/model-1", "b/model-2", "c/model-3", "d/model-4"],
    ["a/model-1", "c/model-3", "d/model-4"],
    ["d/model-4", "a/model-1", "c/model-3"],
  );

  assert.deepEqual(reordered, ["d/model-4", "b/model-2", "a/model-1", "c/model-3"]);
});
