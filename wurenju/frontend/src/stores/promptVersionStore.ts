import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { gateway } from "@/services/gateway";
import { useAgentStore } from "@/stores/agentStore";
import type { AgentFile } from "@/types/agent";
import type { MetricSnapshot, PromptRollbackRecord, PromptVersion } from "@/types/promptVersion";
import { parseAgentIdentityContent } from "@/utils/agentIdentity";
import { createSafeStorageAdapter } from "@/utils/storage";

const PROMPT_VERSION_STORAGE_KEY = "xiaban.prompt-versions.v1";
const MAX_VERSIONS_PER_FILE = 20;

type PromptFileName = "IDENTITY.md" | "SOUL.md";

type PromptVersionState = {
  versions: PromptVersion[];
  rollbackRecords: PromptRollbackRecord[];
  activeVersionIdByKey: Record<string, string>;
  saveVersionedPrompt: (params: {
    agentId: string;
    fileName: PromptFileName;
    previousContent: string;
    nextContent: string;
    changeDescription: string;
    source: PromptVersion["source"];
    metrics: MetricSnapshot;
  }) => Promise<PromptVersion | null>;
  rollbackToVersion: (params: {
    agentId: string;
    fileName: PromptFileName;
    versionId: string;
    reason: string;
    metrics: MetricSnapshot;
  }) => Promise<PromptRollbackRecord | null>;
  getVersionsForAgent: (agentId: string) => PromptVersion[];
  getActiveVersionId: (agentId: string, fileName: PromptFileName) => string | null;
};

type PersistedPromptVersionState = Pick<
  PromptVersionState,
  "versions" | "rollbackRecords" | "activeVersionIdByKey"
>;

function resolvePromptVersionStorage() {
  return createSafeStorageAdapter();
}

function buildPromptKey(agentId: string, fileName: PromptFileName) {
  return `${agentId}:${fileName}`;
}

function parseVersionNumber(version: string) {
  const match = version.match(/^v(\d+)\.(\d+)$/);
  if (!match) {
    return { major: 1, minor: 0 };
  }

  return {
    major: Number(match[1]) || 1,
    minor: Number(match[2]) || 0,
  };
}

function formatVersionNumber(major: number, minor: number) {
  return `v${major}.${minor}`;
}

function nextVersion(lastVersion?: PromptVersion) {
  if (!lastVersion) {
    return "v1.0";
  }

  const parsed = parseVersionNumber(lastVersion.version);
  return formatVersionNumber(parsed.major, parsed.minor + 1);
}

function syncAgentPromptFile(agentId: string, fileName: PromptFileName, content: string) {
  const updatedAtMs = Date.now();
  const savedFile: AgentFile = {
    name: fileName,
    size: new TextEncoder().encode(content).length,
    updatedAtMs,
    content,
  };

  useAgentStore.setState((state) => {
    const currentFiles = state.agentFiles.get(agentId) ?? [];
    const exists = currentFiles.some((file) => file.name === fileName);
    const nextFiles = exists
      ? currentFiles.map((file) => (file.name === fileName ? savedFile : file))
      : [...currentFiles, savedFile];
    const nextAgentFiles = new Map(state.agentFiles);
    nextAgentFiles.set(agentId, nextFiles);

    const identityDetails =
      fileName === "IDENTITY.md" ? parseAgentIdentityContent(content) : undefined;

    return {
      agentFiles: nextAgentFiles,
      agents:
        fileName === "IDENTITY.md"
          ? state.agents.map((agent) =>
              agent.id === agentId
                ? {
                    ...agent,
                    name: identityDetails?.name?.trim() || agent.name,
                    role: identityDetails?.role?.trim() || agent.role,
                    description: identityDetails?.description?.trim() || agent.description,
                    emoji: identityDetails?.emoji?.trim() || agent.emoji,
                    createdAtMs: agent.createdAtMs ?? updatedAtMs,
                  }
                : agent,
            )
          : state.agents,
      fileContent:
        state.showDetailFor === agentId && state.activeFileName === fileName
          ? content
          : state.fileContent,
      fileDirty:
        state.showDetailFor === agentId && state.activeFileName === fileName
          ? false
          : state.fileDirty,
    };
  });
}

function pruneVersions(versions: PromptVersion[]) {
  const grouped = new Map<string, PromptVersion[]>();

  for (const version of versions) {
    const key = buildPromptKey(version.agentId, version.fileName);
    const current = grouped.get(key) ?? [];
    grouped.set(key, [...current, version]);
  }

  return Array.from(grouped.values())
    .flatMap((items) =>
      items
        .toSorted((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
        .slice(0, MAX_VERSIONS_PER_FILE),
    )
    .toSorted((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
}

function buildVersionsForWrite(params: {
  existingVersions: PromptVersion[];
  agentId: string;
  fileName: PromptFileName;
  previousContent: string;
  nextContent: string;
  changeDescription: string;
  source: PromptVersion["source"];
  metrics: MetricSnapshot;
}) {
  const baseTimestamp = new Date().toISOString();
  const scopedVersions = params.existingVersions.filter(
    (version) => version.agentId === params.agentId && version.fileName === params.fileName,
  );
  const latestVersion = scopedVersions
    .toSorted((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .at(0);

  const nextVersions: PromptVersion[] = [];

  if (
    !latestVersion &&
    params.previousContent.trim() &&
    params.previousContent !== params.nextContent
  ) {
    nextVersions.push({
      id: crypto.randomUUID(),
      version: "v1.0",
      agentId: params.agentId,
      fileName: params.fileName,
      timestamp: baseTimestamp,
      changeDescription: "初始基线版本",
      content: params.previousContent,
      source: "manual",
      metrics: params.metrics,
    });
  }

  const lastEffectiveVersion = nextVersions.at(-1) ?? latestVersion;
  nextVersions.push({
    id: crypto.randomUUID(),
    version: nextVersion(lastEffectiveVersion),
    agentId: params.agentId,
    fileName: params.fileName,
    timestamp: baseTimestamp,
    changeDescription: params.changeDescription,
    content: params.nextContent,
    source: params.source,
    metrics: params.metrics,
  });

  return nextVersions;
}

export const usePromptVersionStore = create<PromptVersionState>()(
  persist(
    (set, get) => ({
      versions: [],
      rollbackRecords: [],
      activeVersionIdByKey: {},

      saveVersionedPrompt: async (params) => {
        console.log(
          `[PromptVer] 保存提示词版本: agent=${params.agentId}, file=${params.fileName}, source=${params.source}`,
        );

        await gateway.saveAgentFile(params.agentId, params.fileName, params.nextContent);
        syncAgentPromptFile(params.agentId, params.fileName, params.nextContent);

        const createdVersions = buildVersionsForWrite({
          existingVersions: get().versions,
          agentId: params.agentId,
          fileName: params.fileName,
          previousContent: params.previousContent,
          nextContent: params.nextContent,
          changeDescription: params.changeDescription,
          source: params.source,
          metrics: params.metrics,
        });
        const newestVersion = createdVersions.at(-1) ?? null;

        set((state) => ({
          versions: pruneVersions([...createdVersions, ...state.versions]),
          activeVersionIdByKey: newestVersion
            ? {
                ...state.activeVersionIdByKey,
                [buildPromptKey(params.agentId, params.fileName)]: newestVersion.id,
              }
            : state.activeVersionIdByKey,
        }));

        return newestVersion;
      },

      rollbackToVersion: async (params) => {
        const target = get().versions.find((version) => version.id === params.versionId);
        if (!target) {
          return null;
        }

        const key = buildPromptKey(params.agentId, params.fileName);
        const currentActiveId = get().activeVersionIdByKey[key];
        if (!currentActiveId || currentActiveId === target.id) {
          return null;
        }

        console.log(
          `[PromptVer] 回滚提示词: agent=${params.agentId}, file=${params.fileName}, to=${target.version}`,
        );
        await gateway.saveAgentFile(params.agentId, params.fileName, target.content);
        syncAgentPromptFile(params.agentId, params.fileName, target.content);

        const rollbackRecord: PromptRollbackRecord = {
          id: crypto.randomUUID(),
          agentId: params.agentId,
          fileName: params.fileName,
          fromVersionId: currentActiveId,
          toVersionId: target.id,
          reason: params.reason,
          createdAt: Date.now(),
          metricsBeforeRollback: params.metrics,
        };

        set((state) => ({
          activeVersionIdByKey: {
            ...state.activeVersionIdByKey,
            [key]: target.id,
          },
          rollbackRecords: [rollbackRecord, ...state.rollbackRecords].slice(0, 80),
        }));

        return rollbackRecord;
      },

      getVersionsForAgent: (agentId) => {
        return get()
          .versions.filter((version) => version.agentId === agentId)
          .toSorted((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
      },

      getActiveVersionId: (agentId, fileName) => {
        return get().activeVersionIdByKey[buildPromptKey(agentId, fileName)] ?? null;
      },
    }),
    {
      name: PROMPT_VERSION_STORAGE_KEY,
      storage: createJSONStorage(resolvePromptVersionStorage),
      partialize: (state): PersistedPromptVersionState => ({
        versions: state.versions,
        rollbackRecords: state.rollbackRecords,
        activeVersionIdByKey: state.activeVersionIdByKey,
      }),
    },
  ),
);
