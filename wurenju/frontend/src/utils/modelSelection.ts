import type { ModelProviderGroup } from "../types/model";
import {
  buildModelRef,
  getModelDisplayName,
  getProviderDisplayName,
  normalizeProviderId,
  readStoredProviderMetaMap,
  splitModelRef,
} from "./modelProviders";

export interface CandidateModel {
  providerId: string;
  providerDisplayName: string;
  modelId: string;
  modelDisplayName: string;
  modelRef: string;
  contextWindow?: number;
}

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeUniqueModelRefs(modelRefs: string[]) {
  const seen = new Set<string>();
  const normalizedRefs: string[] = [];

  for (const modelRef of modelRefs) {
    const normalized = modelRef.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    normalizedRefs.push(normalized);
  }

  return normalizedRefs;
}

export function buildCandidateModelCatalog(
  groups: ModelProviderGroup[],
  providerMetaMap = readStoredProviderMetaMap(),
) {
  const seen = new Set<string>();
  const catalog: CandidateModel[] = [];

  for (const group of groups) {
    const providerId = normalizeProviderId(group.provider) || group.provider.trim();
    if (!providerId) {
      continue;
    }

    for (const model of group.models) {
      const modelId = model.id.trim();
      if (!modelId) {
        continue;
      }

      const modelRef = buildModelRef(providerId, modelId);
      if (seen.has(modelRef)) {
        continue;
      }

      seen.add(modelRef);
      catalog.push({
        providerId,
        providerDisplayName: getProviderDisplayName(providerId, providerMetaMap),
        modelId,
        modelDisplayName: getModelDisplayName(providerId, modelId, providerMetaMap),
        modelRef,
        contextWindow: model.contextWindow,
      });
    }
  }

  return catalog.toSorted((left, right) => {
    const providerCompare = left.providerDisplayName.localeCompare(right.providerDisplayName);
    if (providerCompare !== 0) {
      return providerCompare;
    }

    return left.modelDisplayName.localeCompare(right.modelDisplayName);
  });
}

export function resolveCandidateModel(
  modelRef: string,
  catalog: CandidateModel[],
  providerMetaMap = readStoredProviderMetaMap(),
) {
  const matched = catalog.find((item) => item.modelRef === modelRef);
  if (matched) {
    return matched;
  }

  const { providerId, modelId } = splitModelRef(modelRef);
  return {
    providerId,
    providerDisplayName: getProviderDisplayName(providerId, providerMetaMap),
    modelId,
    modelDisplayName: getModelDisplayName(providerId, modelId, providerMetaMap),
    modelRef,
    contextWindow: undefined,
  } satisfies CandidateModel;
}

export function buildVisibleCandidateModels(
  catalog: CandidateModel[],
  selectedModelRefs: string[],
  providerMetaMap = readStoredProviderMetaMap(),
) {
  const selected = normalizeUniqueModelRefs(selectedModelRefs);
  const merged: CandidateModel[] = [];
  const seen = new Set<string>();

  for (const modelRef of selected) {
    const item = resolveCandidateModel(modelRef, catalog, providerMetaMap);
    if (seen.has(item.modelRef)) {
      continue;
    }

    seen.add(item.modelRef);
    merged.push(item);
  }

  for (const item of catalog) {
    if (seen.has(item.modelRef)) {
      continue;
    }

    seen.add(item.modelRef);
    merged.push(item);
  }

  return merged;
}

export function filterCandidateModels(models: CandidateModel[], query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return models;
  }

  return models.filter((model) =>
    [model.modelDisplayName, model.modelId, model.providerDisplayName, model.providerId].some(
      (value) => value.toLowerCase().includes(normalizedQuery),
    ),
  );
}

export function toggleCandidateModelSelection(
  selectedModelRefs: string[],
  modelRef: string,
  checked: boolean,
) {
  const normalizedModelRef = modelRef.trim();
  if (!normalizedModelRef) {
    return normalizeUniqueModelRefs(selectedModelRefs);
  }

  if (checked) {
    return normalizeUniqueModelRefs([...selectedModelRefs, normalizedModelRef]);
  }

  return normalizeUniqueModelRefs(
    selectedModelRefs.filter((currentModelRef) => currentModelRef.trim() !== normalizedModelRef),
  );
}

export function reorderVisibleModelRefs(
  allSelectedModelRefs: string[],
  visibleSelectedModelRefs: string[],
  nextVisibleModelRefs: string[],
) {
  const normalizedAll = normalizeUniqueModelRefs(allSelectedModelRefs);
  const visibleOrder = normalizeUniqueModelRefs(visibleSelectedModelRefs).filter((modelRef) =>
    normalizedAll.includes(modelRef),
  );
  const nextVisibleOrder = normalizeUniqueModelRefs(nextVisibleModelRefs).filter((modelRef) =>
    visibleOrder.includes(modelRef),
  );

  if (visibleOrder.length <= 1 || visibleOrder.length !== nextVisibleOrder.length) {
    return normalizedAll;
  }

  const visibleSet = new Set(visibleOrder);
  let visibleIndex = 0;

  return normalizedAll.map((modelRef) => {
    if (!visibleSet.has(modelRef)) {
      return modelRef;
    }

    const nextModelRef = nextVisibleOrder[visibleIndex];
    visibleIndex += 1;
    return nextModelRef ?? modelRef;
  });
}

export function areModelRefArraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

export function formatCompactNumber(value: number) {
  if (value >= 1_000_000) {
    return `${Number((value / 1_000_000).toFixed(1)).toString()}M`;
  }

  if (value >= 1_000) {
    return `${Number((value / 1_000).toFixed(1)).toString()}K`;
  }

  return String(value);
}

export function formatContextWindow(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return `${formatCompactNumber(value)} context`;
}

export function formatPriorityIndex(index: number) {
  const symbols = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
  return symbols[index] ?? `${index + 1}.`;
}
