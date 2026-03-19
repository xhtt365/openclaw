"use client";

import { Reorder } from "framer-motion";
import { GripVertical, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";
import { useAgentStore } from "@/stores/agentStore";
import { readAgentModelChain, writeAgentModelChain } from "@/utils/modelChain";
import {
  MODEL_PROVIDERS_UPDATED_EVENT,
  MODEL_PROVIDER_STATUS_UPDATED_EVENT,
  getProviderStatusBadge,
  readModelProviderStatusMap,
  readStoredProviderMetaMap,
} from "@/utils/modelProviders";
import {
  areModelRefArraysEqual,
  buildCandidateModelCatalog,
  buildVisibleCandidateModels,
  filterCandidateModels,
  formatContextWindow,
  formatPriorityIndex,
  normalizeUniqueModelRefs,
  reorderVisibleModelRefs,
  toggleCandidateModelSelection,
} from "@/utils/modelSelection";

function arePlainObjectsEqual(left: Record<string, unknown>, right: Record<string, unknown>) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function ModelSelectModal({
  open,
  onOpenChange,
  agentId,
  agentName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  agentName: string;
}) {
  const availableModels = useAgentStore((state) => state.availableModels);
  const modelLoading = useAgentStore((state) => state.modelLoading);
  const fetchModels = useAgentStore((state) => state.fetchModels);
  const fetchAgentModel = useAgentStore((state) => state.fetchAgentModel);

  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [hasLoadedSelection, setHasLoadedSelection] = useState(false);
  const [selectedModelRefs, setSelectedModelRefs] = useState<string[]>([]);
  const [providerMetaMap, setProviderMetaMap] = useState(() => readStoredProviderMetaMap());
  const [providerStatusMap, setProviderStatusMap] = useState(() => readModelProviderStatusMap());
  const availableModelsCountRef = useRef(availableModels.length);

  useEffect(() => {
    availableModelsCountRef.current = availableModels.length;
  }, [availableModels.length]);

  const catalog = useMemo(
    () => buildCandidateModelCatalog(availableModels, providerMetaMap),
    [availableModels, providerMetaMap],
  );
  const allCandidateModels = useMemo(
    () => buildVisibleCandidateModels(catalog, selectedModelRefs, providerMetaMap),
    [catalog, providerMetaMap, selectedModelRefs],
  );
  const selectedModelRefSet = useMemo(() => new Set(selectedModelRefs), [selectedModelRefs]);
  const filteredModels = useMemo(
    () => filterCandidateModels(allCandidateModels, searchQuery),
    [allCandidateModels, searchQuery],
  );
  const filteredSelectedModels = useMemo(
    () => filteredModels.filter((model) => selectedModelRefSet.has(model.modelRef)),
    [filteredModels, selectedModelRefSet],
  );
  const filteredUnselectedModels = useMemo(
    () => filteredModels.filter((model) => !selectedModelRefSet.has(model.modelRef)),
    [filteredModels, selectedModelRefSet],
  );
  const filteredSelectedModelRefs = useMemo(
    () => filteredSelectedModels.map((model) => model.modelRef),
    [filteredSelectedModels],
  );
  const chainValidationError =
    hasLoadedSelection && selectedModelRefs.length === 0 ? "至少勾选 1 个模型" : "";

  function resetModalState() {
    setLoadError("");
    setSaveError("");
    setSearchQuery("");
    setIsSaving(false);
    setHasLoadedSelection(false);
    setSelectedModelRefs([]);
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetModalState();
    }

    onOpenChange(nextOpen);
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    setProviderMetaMap((current) => {
      const next = readStoredProviderMetaMap();
      return arePlainObjectsEqual(current, next) ? current : next;
    });
    setProviderStatusMap((current) => {
      const next = readModelProviderStatusMap();
      return arePlainObjectsEqual(current, next) ? current : next;
    });

    function handleMetaRefresh() {
      setProviderMetaMap((current) => {
        const next = readStoredProviderMetaMap();
        return arePlainObjectsEqual(current, next) ? current : next;
      });
    }

    function handleStatusRefresh() {
      setProviderStatusMap((current) => {
        const next = readModelProviderStatusMap();
        return arePlainObjectsEqual(current, next) ? current : next;
      });
    }

    window.addEventListener(MODEL_PROVIDERS_UPDATED_EVENT, handleMetaRefresh);
    window.addEventListener(MODEL_PROVIDER_STATUS_UPDATED_EVENT, handleStatusRefresh);
    return () => {
      window.removeEventListener(MODEL_PROVIDERS_UPDATED_EVENT, handleMetaRefresh);
      window.removeEventListener(MODEL_PROVIDER_STATUS_UPDATED_EVENT, handleStatusRefresh);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let isActive = true;

    const loadModalData = async () => {
      setLoadError("");
      setHasLoadedSelection(false);

      try {
        if (availableModelsCountRef.current === 0) {
          await fetchModels();
        }

        const snapshot = await gateway.getConfig();
        const fallbackModelRef = useAgentStore.getState().currentAgentModel?.trim() || "";
        const chain = readAgentModelChain(snapshot.config, agentId, fallbackModelRef);
        const nextSelectedModelRefs = normalizeUniqueModelRefs(
          [chain.primary, ...chain.fallbacks].filter(Boolean),
        );

        if (!isActive) {
          return;
        }

        setSelectedModelRefs((current) =>
          areModelRefArraysEqual(current, nextSelectedModelRefs) ? current : nextSelectedModelRefs,
        );
        setHasLoadedSelection(true);
      } catch (error) {
        if (!isActive) {
          return;
        }

        console.error("[Model] 加载模型配置失败:", error);
        setLoadError("加载模型配置失败，请检查 Gateway 连接");
      }
    };

    void loadModalData();

    return () => {
      isActive = false;
    };
  }, [agentId, fetchModels, open]);

  function toggleModel(modelRef: string, checked: boolean) {
    setSelectedModelRefs((current) => toggleCandidateModelSelection(current, modelRef, checked));
    setSaveError("");
  }

  function reorderSelectedModels(nextVisibleModelRefs: string[]) {
    setSelectedModelRefs((current) =>
      reorderVisibleModelRefs(current, filteredSelectedModelRefs, nextVisibleModelRefs),
    );
  }

  async function handleSave() {
    const normalizedSelectedModelRefs = normalizeUniqueModelRefs(selectedModelRefs);
    if (normalizedSelectedModelRefs.length === 0) {
      setSaveError("至少勾选 1 个模型");
      return;
    }

    setSaveError("");
    setIsSaving(true);

    try {
      const snapshot = await gateway.getConfig();
      const nextConfig = structuredClone(snapshot.config ?? {});
      writeAgentModelChain(nextConfig, agentId, normalizedSelectedModelRefs);
      await gateway.setConfig(nextConfig as Record<string, unknown>, { baseHash: snapshot.hash });
      await fetchAgentModel(agentId);

      toast({
        title: "✅ 模型配置已保存",
        description: `${agentName} 的主模型和备用链已更新`,
      });
      handleDialogOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim() ? error.message : "保存失败，请重试";
      console.error("[Model] 保存模型配置失败:", error);
      setSaveError(message);
      toast({
        title: "❌ 保存失败，请重试",
        description: message,
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="overflow-hidden rounded-[20px] border-[var(--modal-shell-border)] bg-[var(--modal-shell-bg)] p-0 text-[var(--color-text-primary)] shadow-[var(--modal-shell-shadow)] backdrop-blur-xl sm:max-w-4xl">
        <div className="border-b border-border px-6 py-5">
          <DialogHeader className="gap-3 text-left">
            <DialogTitle className="text-xl">配置模型 — {agentName}</DialogTitle>
            <DialogDescription>
              为当前员工配置主模型和备用链。主模型不可用时，自动切换到下一个。
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="max-h-[75vh] overflow-y-auto px-6 py-5">
          <div className="space-y-5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索模型..."
                className="h-12 rounded-2xl border-[var(--color-border)] bg-[var(--color-bg-card)] pl-11"
              />
            </div>

            <div className="text-sm text-[var(--color-text-secondary)]">
              拖拽排序优先级。排第一的是主模型，后面的依次是备用模型。
            </div>

            {loadError ? (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {loadError}
              </div>
            ) : null}

            {saveError || chainValidationError ? (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {saveError || chainValidationError}
              </div>
            ) : null}

            {modelLoading ? (
              <div className="flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在加载模型列表...
              </div>
            ) : null}

            {!modelLoading && allCandidateModels.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-6 text-sm text-[var(--color-text-secondary)]">
                当前没有可选模型，请先在「添加模型供应商」里配置至少一个供应商和模型。
              </div>
            ) : null}

            {!modelLoading && allCandidateModels.length > 0 ? (
              <>
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                      已勾选的模型
                    </div>
                    <div className="text-xs text-[var(--color-text-secondary)]">
                      {selectedModelRefs.length} 个模型参与 fallback 链
                    </div>
                  </div>

                  {selectedModelRefs.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-5 text-sm text-[var(--color-text-secondary)]">
                      还没有启用任何模型，先从下方勾选一个。
                    </div>
                  ) : null}

                  <Reorder.Group
                    axis="y"
                    values={filteredSelectedModelRefs}
                    onReorder={reorderSelectedModels}
                    className="space-y-3"
                  >
                    {filteredSelectedModels.map((model) => {
                      const priorityIndex = selectedModelRefs.indexOf(model.modelRef);
                      const statusBadge = getProviderStatusBadge(
                        model.providerId,
                        providerStatusMap,
                      );

                      return (
                        <Reorder.Item
                          key={model.modelRef}
                          value={model.modelRef}
                          className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)]"
                        >
                          <div className="grid gap-3 px-4 py-4 md:grid-cols-[auto_auto_auto_minmax(0,1fr)] md:items-center">
                            <label className="inline-flex items-center gap-3 text-sm font-medium text-[var(--color-text-primary)]">
                              <input
                                type="checkbox"
                                checked
                                onChange={(event) =>
                                  toggleModel(model.modelRef, event.target.checked)
                                }
                                className="h-4 w-4 rounded border-[var(--color-border)]"
                              />
                            </label>

                            <div className="inline-flex items-center gap-2 text-[var(--color-text-secondary)]">
                              <GripVertical className="h-4 w-4 cursor-grab" />
                              <span className="text-sm font-semibold">
                                {formatPriorityIndex(priorityIndex)}
                              </span>
                            </div>

                            <div
                              className={cn(
                                "inline-flex items-center gap-1 text-xs font-medium",
                                statusBadge.toneClassName,
                              )}
                            >
                              <span>{statusBadge.icon}</span>
                              <span>{statusBadge.label}</span>
                            </div>

                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                                {model.modelDisplayName}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
                                <span>{model.providerDisplayName}</span>
                                {model.contextWindow ? (
                                  <span>{formatContextWindow(model.contextWindow)}</span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </Reorder.Item>
                      );
                    })}
                  </Reorder.Group>

                  {searchQuery.trim() &&
                  selectedModelRefs.length > 0 &&
                  filteredSelectedModels.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4 py-4 text-sm text-[var(--color-text-secondary)]">
                      当前搜索条件下，没有已勾选模型。
                    </div>
                  ) : null}
                </section>

                <section className="space-y-3">
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                    未勾选的模型
                  </div>

                  {filteredUnselectedModels.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-5 text-sm text-[var(--color-text-secondary)]">
                      {searchQuery.trim()
                        ? "没有匹配的未勾选模型。"
                        : "所有模型都已经加入 fallback 链。"}
                    </div>
                  ) : null}

                  {filteredUnselectedModels.map((model) => {
                    const statusBadge = getProviderStatusBadge(model.providerId, providerStatusMap);

                    return (
                      <div
                        key={model.modelRef}
                        className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)]"
                      >
                        <div className="grid gap-3 px-4 py-4 md:grid-cols-[auto_auto_minmax(0,1fr)] md:items-center">
                          <label className="inline-flex items-center gap-3 text-sm font-medium text-[var(--color-text-primary)]">
                            <input
                              type="checkbox"
                              checked={false}
                              onChange={(event) =>
                                toggleModel(model.modelRef, event.target.checked)
                              }
                              className="h-4 w-4 rounded border-[var(--color-border)]"
                            />
                          </label>

                          <div
                            className={cn(
                              "inline-flex items-center gap-1 text-xs font-medium",
                              statusBadge.toneClassName,
                            )}
                          >
                            <span>{statusBadge.icon}</span>
                            <span>{statusBadge.label}</span>
                          </div>

                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                              {model.modelDisplayName}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
                              <span>{model.providerDisplayName}</span>
                              {model.contextWindow ? (
                                <span>{formatContextWindow(model.contextWindow)}</span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </section>
              </>
            ) : null}
          </div>
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleDialogOpenChange(false)}
            disabled={isSaving}
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || selectedModelRefs.length === 0}
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
