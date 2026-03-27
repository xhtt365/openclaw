import { create } from "zustand";
import { toast } from "@/hooks/use-toast";
import { archivesApi, type BackendArchive } from "@/services/api";
import {
  hydrateArchiveTitles,
  resolveArchiveTitle,
  sanitizeArchiveTitle,
} from "@/utils/archiveTitle";
import { adaptSidebarSyncMessage, type ChatMessage, type ChatUsage } from "@/utils/messageAdapter";

export type DirectArchive = {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  agentRole?: string;
  agentAvatarUrl?: string;
  agentAvatarText?: string;
  agentEmoji?: string;
  preview: string;
  archivedAt: string;
  messages: ChatMessage[];
};

type ArchiveState = {
  directArchives: DirectArchive[];
  selectedDirectArchiveId: string | null;
  loading: boolean;
  initialized: boolean;
  fetchDirectArchives: () => Promise<void>;
  initialize: () => Promise<void>;
  selectDirectArchive: (archiveId: string) => void;
  clearSelectedDirectArchive: () => void;
  createDirectArchive: (archive: DirectArchive) => Promise<DirectArchive>;
  deleteDirectArchive: (archiveId: string) => Promise<boolean>;
  renameDirectArchive: (archiveId: string, title: string) => Promise<boolean>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trimToString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function trimToOptionalString(value: unknown) {
  const normalized = trimToString(value);
  return normalized || undefined;
}

function normalizeUsage(value: unknown): ChatUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const readNumber = (input: unknown) =>
    typeof input === "number" && Number.isFinite(input) ? input : 0;
  const cost =
    isRecord(value.cost) &&
    typeof value.cost.total === "number" &&
    Number.isFinite(value.cost.total)
      ? { total: value.cost.total }
      : undefined;

  return {
    input: readNumber(value.input),
    output: readNumber(value.output),
    cacheRead: readNumber(value.cacheRead),
    cacheWrite: readNumber(value.cacheWrite),
    totalTokens: readNumber(value.totalTokens),
    cost,
  };
}

function normalizeMessages(messages: unknown) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.flatMap((item) => {
    const adapted = adaptSidebarSyncMessage(item);
    if (!adapted) {
      return [];
    }

    const rawThinking =
      item && typeof item === "object" && "thinking" in item && typeof item.thinking === "string"
        ? item.thinking.trim()
        : "";

    const normalizedMessage: ChatMessage = {
      ...adapted,
      thinking: adapted.thinking ?? (rawThinking || undefined),
      usage: normalizeUsage(adapted.usage) ?? undefined,
      isLoading: false,
      isNew: false,
      isHistorical: true,
    };

    return [normalizedMessage];
  });
}

function normalizeDirectArchive(archive: BackendArchive): DirectArchive | null {
  if (archive.type !== "direct") {
    return null;
  }

  const messages = normalizeMessages(archive.messages);
  const archiveId = trimToString(archive.id);
  const agentId = trimToString(archive.source_id);
  const agentName = trimToString(archive.source_name) || agentId;
  const archivedAt = trimToString(archive.archived_at) || trimToString(archive.created_at);
  if (!archiveId || !agentId || !agentName || !archivedAt) {
    return null;
  }

  const latestMessage = [...messages]
    .toReversed()
    .find((message) => message.content.trim().length > 0);
  const preview = latestMessage
    ? latestMessage.role === "user"
      ? `你：${latestMessage.content.replace(/\s+/g, " ").trim()}`
      : latestMessage.content.replace(/\s+/g, " ").trim()
    : "已归档，可稍后回看";
  const metadata = isRecord(archive.messages?.[0]) ? archive.messages?.[0] : null;

  return {
    id: archiveId,
    agentId,
    agentName,
    title: trimToString(archive.title),
    agentRole: metadata ? trimToOptionalString(metadata.agentRole) : undefined,
    agentAvatarUrl: metadata ? trimToOptionalString(metadata.agentAvatarUrl) : undefined,
    agentAvatarText: metadata ? trimToOptionalString(metadata.agentAvatarText) : undefined,
    agentEmoji: metadata ? trimToOptionalString(metadata.agentEmoji) : undefined,
    preview,
    archivedAt,
    messages,
  };
}

function sortDirectArchives(archives: DirectArchive[]) {
  return [...archives].toSorted(
    (left, right) => new Date(right.archivedAt).getTime() - new Date(left.archivedAt).getTime(),
  );
}

function hydrateDirectArchives(archives: DirectArchive[]) {
  return sortDirectArchives(
    hydrateArchiveTitles(archives, {
      getTitle: (archive) => archive.title,
      getSourceName: (archive) => archive.agentName,
      getArchivedAt: (archive) => archive.archivedAt,
      setTitle: (archive, title) => ({
        ...archive,
        title,
      }),
    }),
  );
}

function buildPersistedMessages(archive: DirectArchive) {
  return archive.messages.map((message, index) => ({
    ...message,
    agentRole: index === 0 ? archive.agentRole : undefined,
    agentAvatarUrl: index === 0 ? archive.agentAvatarUrl : undefined,
    agentAvatarText: index === 0 ? archive.agentAvatarText : undefined,
    agentEmoji: index === 0 ? archive.agentEmoji : undefined,
  }));
}

export const useArchiveStore = create<ArchiveState>((set, get) => ({
  directArchives: [],
  selectedDirectArchiveId: null,
  loading: false,
  initialized: false,

  fetchDirectArchives: async () => {
    set({ loading: true });

    try {
      const archives = await archivesApi.list("direct");
      const directArchives = hydrateDirectArchives(
        archives
          .map(normalizeDirectArchive)
          .filter((archive): archive is DirectArchive => archive !== null),
      );
      console.log(`[Store] 归档初始化完成: direct=${directArchives.length}`);
      set((state) => ({
        directArchives,
        loading: false,
        initialized: true,
        selectedDirectArchiveId:
          state.selectedDirectArchiveId &&
          directArchives.some((archive) => archive.id === state.selectedDirectArchiveId)
            ? state.selectedDirectArchiveId
            : null,
      }));
    } catch (error) {
      console.warn("[Store] 拉取 1v1 归档失败:", error);
      toast({
        title: "归档加载失败",
        description: error instanceof Error && error.message.trim() ? error.message : "请稍后重试",
        variant: "destructive",
      });
      set({ loading: false, initialized: true });
    }
  },

  initialize: async () => {
    if (get().loading || get().initialized) {
      return;
    }

    await get().fetchDirectArchives();
  },

  selectDirectArchive: (archiveId) => {
    console.log(`[Store] 选中 1v1 归档: ${archiveId}`);
    set({ selectedDirectArchiveId: archiveId });
  },

  clearSelectedDirectArchive: () => {
    set({ selectedDirectArchiveId: null });
  },

  createDirectArchive: async (archive) => {
    const archivedAt = archive.archivedAt.trim() || new Date().toISOString();
    const title = resolveArchiveTitle({
      title: sanitizeArchiveTitle(archive.title),
      sourceName: archive.agentName,
      archivedAt,
      siblingArchives: get().directArchives.map((item) => ({
        title: item.title,
        sourceName: item.agentName,
        archivedAt: item.archivedAt,
      })),
    });
    const payload = await archivesApi.create({
      id: archive.id,
      type: "direct",
      source_id: archive.agentId,
      source_name: archive.agentName,
      title,
      archived_at: archivedAt,
      messages: buildPersistedMessages({
        ...archive,
        title,
        archivedAt,
      }),
      message_count: archive.messages.length,
    });
    const created = normalizeDirectArchive(payload);
    if (!created) {
      throw new Error("归档创建失败");
    }

    set((state) => ({
      directArchives: hydrateDirectArchives([created, ...state.directArchives]),
    }));
    return created;
  },

  deleteDirectArchive: async (archiveId) => {
    const normalizedArchiveId = archiveId.trim();
    if (!normalizedArchiveId) {
      return false;
    }

    await archivesApi.remove(normalizedArchiveId);
    set((state) => ({
      directArchives: state.directArchives.filter((archive) => archive.id !== normalizedArchiveId),
      selectedDirectArchiveId:
        state.selectedDirectArchiveId === normalizedArchiveId
          ? null
          : state.selectedDirectArchiveId,
    }));
    return true;
  },

  renameDirectArchive: async (archiveId, title) => {
    const normalizedArchiveId = archiveId.trim();
    const nextTitle = sanitizeArchiveTitle(title);
    if (!normalizedArchiveId || !nextTitle) {
      return false;
    }

    const payload = await archivesApi.update(normalizedArchiveId, {
      title: nextTitle,
    });
    const renamed = normalizeDirectArchive(payload);
    if (!renamed) {
      return false;
    }

    set((state) => ({
      directArchives: hydrateDirectArchives(
        state.directArchives.map((archive) =>
          archive.id === normalizedArchiveId
            ? {
                ...archive,
                title: renamed.title,
              }
            : archive,
        ),
      ),
    }));
    return true;
  },
}));
