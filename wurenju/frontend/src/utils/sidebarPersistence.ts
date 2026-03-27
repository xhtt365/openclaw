"use client";

import { ApiError, archivesApi, type BackendArchive } from "@/services/api";
import { hydrateArchiveTitles, sanitizeArchiveTitle } from "@/utils/archiveTitle";
import { adaptSidebarSyncMessage, type ChatMessage, type ChatUsage } from "@/utils/messageAdapter";
import { readLocalStorageItem, writeLocalStorageItem } from "@/utils/storage";

export type SidebarDepartment = {
  id: string;
  name: string;
  icon: string;
  sortOrder: number;
};

export type SidebarAgentMeta = {
  departmentId?: string;
  pinned?: boolean;
};

export type SidebarAgentMetaMap = Record<string, SidebarAgentMeta>;

export type SidebarDirectArchive = {
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

export type SidebarCollapsedSections = Record<string, boolean>;

export type SidebarUnreadState = {
  directByAgentId: Record<string, number>;
  groupById: Record<string, number>;
};

export type SidebarVisualPreset = "default" | "compact" | "comfort";

export const SIDEBAR_DEPARTMENTS_STORAGE_KEY = "xiaban.sidebar.departments";
export const SIDEBAR_AGENT_META_STORAGE_KEY = "xiaban.sidebar.agentMeta";
export const EMPLOYEE_DEPARTMENT_MAP_STORAGE_KEY = "employeeDepartmentMap";
export const PINNED_EMPLOYEES_STORAGE_KEY = "pinnedEmployees";
export const SIDEBAR_COLLAPSED_SECTIONS_STORAGE_KEY = "xiaban.sidebar.collapsedSections.v2";
export const SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY = "xiaban.sidebar.directArchives";
const SIDEBAR_DIRECT_ARCHIVE_PENDING_DELETE_STORAGE_KEY =
  "xiaban.sidebar.directArchives.pendingDelete";
export const SIDEBAR_UNREAD_STORAGE_KEY = "xiaban.sidebar.unreadState";
export const SIDEBAR_VISUAL_PRESET_STORAGE_KEY = "xiaban.sidebar.visualPreset";
const SIDEBAR_STORAGE_CHANGE_EVENT = "xiaban:sidebar-storage-change";

let cachedDirectArchives: SidebarDirectArchive[] | null = null;
let directArchiveHydrationPromise: Promise<SidebarDirectArchive[]> | null = null;
let directArchiveSyncChain: Promise<void> = Promise.resolve();
let directArchiveSnapshotVersion = 0;
const DIRECT_ARCHIVE_SYNC_ATTEMPTS = 3;
const DIRECT_ARCHIVE_SYNC_RETRY_DELAY_MS = 1_000;

// 侧栏数据统一从这里管理：本地缓存优先保证响应速度，部分能力再向后端 hydrate / sync。
function readStorageItem(key: string) {
  if (typeof window === "undefined") {
    return null;
  }

  return readLocalStorageItem(key);
}

function writeStorageItem(key: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }

  if (!writeLocalStorageItem(key, value)) {
    console.warn(`[Storage] 侧栏缓存写入失败: ${key}`);
  }
}

function emitStorageChange(key: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<{ key: string }>(SIDEBAR_STORAGE_CHANGE_EVENT, {
      detail: { key },
    }),
  );
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function parseStorageValue(key: string) {
  const raw = readStorageItem(key);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    console.error(`[Sidebar] 读取本地缓存失败: ${key}`, error);
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function cloneArchivedMessages(messages: ChatMessage[]) {
  return messages.map((message) => ({
    ...message,
    usage: message.usage
      ? {
          ...message.usage,
          cost: message.usage.cost ? { ...message.usage.cost } : undefined,
        }
      : undefined,
    isLoading: false,
    isNew: false,
    isHistorical: true,
  }));
}

function normalizeArchivedMessages(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalizedMessages: Array<ChatMessage | null> = value.map((item) => {
    const adapted = adaptSidebarSyncMessage(item);
    if (!adapted) {
      return null;
    }

    const rawThinking =
      item && typeof item === "object" && "thinking" in item && typeof item.thinking === "string"
        ? item.thinking.trim()
        : "";

    return {
      ...adapted,
      thinking: adapted.thinking ?? (rawThinking || undefined),
      usage: normalizeUsage(adapted.usage) ?? undefined,
      isLoading: false,
      isNew: false,
      isHistorical: true,
    } satisfies ChatMessage;
  });

  return normalizedMessages.filter((message): message is ChatMessage => message !== null);
}

function readTrimmedString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function pickArchiveMessages(record: Record<string, unknown>) {
  const candidates = [record.messages, record.history, record.items, record.session];
  return candidates.find(Array.isArray);
}

function resolveArchivedAt(record: Record<string, unknown>, messages: ChatMessage[]) {
  const explicitTime = readTrimmedString(record, ["archivedAt", "createdAt", "updatedAt"]);
  if (explicitTime) {
    return explicitTime;
  }

  const latestTimestamp = [...messages]
    .map((message) => message.timestamp)
    .filter(
      (timestamp): timestamp is number =>
        typeof timestamp === "number" && Number.isFinite(timestamp),
    )
    .reduce<number | null>(
      (latest, current) => (latest === null || current > latest ? current : latest),
      null,
    );

  return latestTimestamp !== null
    ? new Date(latestTimestamp).toISOString()
    : new Date(0).toISOString();
}

function sortDirectArchivesByNewest(archives: SidebarDirectArchive[]) {
  return [...archives].toSorted(
    (left, right) => new Date(right.archivedAt).getTime() - new Date(left.archivedAt).getTime(),
  );
}

function normalizeUnreadMap(value: unknown) {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, count]) => {
      const normalizedKey = key.trim();
      if (!normalizedKey) {
        return [];
      }

      const normalizedCount =
        typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
      if (normalizedCount <= 0) {
        return [];
      }

      return [[normalizedKey, normalizedCount]];
    }),
  );
}

function normalizeSidebarDepartments(value: SidebarDepartment[]) {
  return value
    .map((item) => {
      const id = typeof item.id === "string" ? item.id.trim() : "";
      const name = typeof item.name === "string" ? item.name.trim() : "";
      if (!id || !name) {
        return null;
      }

      return {
        id,
        name,
        icon: typeof item.icon === "string" && item.icon.trim() ? item.icon.trim() : "🏢",
        sortOrder: 0,
      } satisfies SidebarDepartment;
    })
    .filter((department): department is SidebarDepartment => department !== null)
    .map((department, index) => ({
      ...department,
      sortOrder: index,
    }));
}

function normalizeSidebarAgentMetaMap(value: SidebarAgentMetaMap) {
  return Object.fromEntries(
    Object.entries(value).flatMap(([agentId, meta]) => {
      const normalizedAgentId = agentId.trim();
      if (!normalizedAgentId || !isRecord(meta)) {
        return [];
      }

      const departmentId =
        typeof meta.departmentId === "string" && meta.departmentId.trim()
          ? meta.departmentId.trim()
          : undefined;
      const pinned = meta.pinned === true;

      if (!departmentId && !pinned) {
        return [];
      }

      return [[normalizedAgentId, { departmentId, pinned } satisfies SidebarAgentMeta]];
    }),
  );
}

function normalizeEmployeeDepartmentMap(value: Record<string, unknown>) {
  const normalizedDepartmentMap: Record<string, string | null> = {};

  for (const [agentId, departmentId] of Object.entries(value)) {
    const normalizedAgentId = agentId.trim();
    if (!normalizedAgentId) {
      continue;
    }

    if (typeof departmentId === "string" && departmentId.trim()) {
      normalizedDepartmentMap[normalizedAgentId] = departmentId.trim();
      continue;
    }

    if (departmentId === null) {
      normalizedDepartmentMap[normalizedAgentId] = null;
    }
  }

  return normalizedDepartmentMap;
}

function normalizePinnedEmployees(value: unknown[]) {
  const pinnedEmployees = value.flatMap((agentId) => {
    if (typeof agentId !== "string" || !agentId.trim()) {
      return [];
    }

    return [agentId.trim()];
  });

  return Array.from(new Set(pinnedEmployees));
}

function buildSidebarAgentMetaMapFromStorage(
  departmentMap: Record<string, string | null>,
  pinnedEmployees: string[],
) {
  const pinnedEmployeeSet = new Set(pinnedEmployees);
  const agentIds = new Set([...Object.keys(departmentMap), ...pinnedEmployees]);

  return Object.fromEntries(
    Array.from(agentIds).flatMap((agentId) => {
      const departmentId = departmentMap[agentId];
      const pinned = pinnedEmployeeSet.has(agentId);
      const normalizedDepartmentId =
        typeof departmentId === "string" && departmentId.trim() ? departmentId.trim() : undefined;

      if (!normalizedDepartmentId && !pinned) {
        return [];
      }

      return [
        [agentId, { departmentId: normalizedDepartmentId, pinned } satisfies SidebarAgentMeta],
      ];
    }),
  );
}

export function readSidebarDepartments(): SidebarDepartment[] {
  const parsed = parseStorageValue(SIDEBAR_DEPARTMENTS_STORAGE_KEY);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((item, index) => {
      if (!isRecord(item)) {
        return null;
      }

      const id = typeof item.id === "string" ? item.id.trim() : "";
      const name = typeof item.name === "string" ? item.name.trim() : "";
      if (!id || !name) {
        return null;
      }

      const icon = typeof item.icon === "string" && item.icon.trim() ? item.icon.trim() : "🏢";
      const sortOrder =
        typeof item.sortOrder === "number" && Number.isFinite(item.sortOrder)
          ? item.sortOrder
          : index;

      return {
        id,
        name,
        icon,
        sortOrder,
      };
    })
    .filter((department): department is SidebarDepartment => department !== null)
    .toSorted(
      (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
    );
}

export function readSidebarAgentMetaMap(): SidebarAgentMetaMap {
  const hasEmployeeDepartmentMap = readStorageItem(EMPLOYEE_DEPARTMENT_MAP_STORAGE_KEY) !== null;
  const hasPinnedEmployees = readStorageItem(PINNED_EMPLOYEES_STORAGE_KEY) !== null;

  // 新结构优先，旧结构只作为兼容回退，避免菜单迁移后丢失历史分组和置顶数据。
  if (hasEmployeeDepartmentMap || hasPinnedEmployees) {
    const parsedDepartmentMap = parseStorageValue(EMPLOYEE_DEPARTMENT_MAP_STORAGE_KEY);
    const parsedPinnedEmployees = parseStorageValue(PINNED_EMPLOYEES_STORAGE_KEY);

    const departmentMap = isRecord(parsedDepartmentMap)
      ? normalizeEmployeeDepartmentMap(parsedDepartmentMap)
      : {};
    const pinnedEmployees = Array.isArray(parsedPinnedEmployees)
      ? normalizePinnedEmployees(parsedPinnedEmployees)
      : [];

    return buildSidebarAgentMetaMapFromStorage(departmentMap, pinnedEmployees);
  }

  const parsedLegacyMeta = parseStorageValue(SIDEBAR_AGENT_META_STORAGE_KEY);
  if (!isRecord(parsedLegacyMeta)) {
    return {};
  }

  return normalizeSidebarAgentMetaMap(parsedLegacyMeta as SidebarAgentMetaMap);
}

export function writeSidebarDepartments(value: SidebarDepartment[]) {
  const normalized = normalizeSidebarDepartments(value);
  writeStorageItem(SIDEBAR_DEPARTMENTS_STORAGE_KEY, JSON.stringify(normalized));
  emitStorageChange(SIDEBAR_DEPARTMENTS_STORAGE_KEY);
  return normalized;
}

export function writeSidebarAgentMetaMap(value: SidebarAgentMetaMap) {
  const normalized = normalizeSidebarAgentMetaMap(value);
  const employeeDepartmentMap = Object.fromEntries(
    Object.entries(normalized).map(([agentId, meta]) => [agentId, meta.departmentId ?? null]),
  );
  const pinnedEmployees = Object.entries(normalized).flatMap(([agentId, meta]) =>
    meta.pinned ? [agentId] : [],
  );

  writeStorageItem(EMPLOYEE_DEPARTMENT_MAP_STORAGE_KEY, JSON.stringify(employeeDepartmentMap));
  emitStorageChange(EMPLOYEE_DEPARTMENT_MAP_STORAGE_KEY);

  writeStorageItem(PINNED_EMPLOYEES_STORAGE_KEY, JSON.stringify(pinnedEmployees));
  emitStorageChange(PINNED_EMPLOYEES_STORAGE_KEY);

  writeStorageItem(SIDEBAR_AGENT_META_STORAGE_KEY, JSON.stringify(normalized));
  emitStorageChange(SIDEBAR_AGENT_META_STORAGE_KEY);
  return normalized;
}

export function clearSidebarDepartmentAssignments(
  departmentId: string,
  currentValue: SidebarAgentMetaMap = readSidebarAgentMetaMap(),
) {
  const trimmedDepartmentId = departmentId.trim();
  if (!trimmedDepartmentId) {
    return currentValue;
  }

  const nextValue = Object.fromEntries(
    Object.entries(currentValue).map(([agentId, meta]) => {
      if (meta.departmentId !== trimmedDepartmentId) {
        return [agentId, meta];
      }

      return [
        agentId,
        {
          ...meta,
          departmentId: undefined,
        } satisfies SidebarAgentMeta,
      ];
    }),
  );

  return writeSidebarAgentMetaMap(nextValue);
}

export function removeSidebarAgentMeta(agentId: string) {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    return readSidebarAgentMetaMap();
  }

  const currentValue = readSidebarAgentMetaMap();
  if (!(normalizedAgentId in currentValue)) {
    return currentValue;
  }

  const nextValue = { ...currentValue };
  delete nextValue[normalizedAgentId];
  return writeSidebarAgentMetaMap(nextValue);
}

export function subscribeSidebarStorage(listener: () => void, keys?: string[]) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const keySet = new Set(keys ?? []);

  const shouldNotify = (key?: string | null) => {
    if (!keySet.size) {
      return true;
    }

    return !key || keySet.has(key);
  };

  const handleStorageChange = (event: Event) => {
    const key = (event as CustomEvent<{ key?: string }>).detail?.key;
    if (shouldNotify(key)) {
      listener();
    }
  };

  const handleStorageEvent = (event: StorageEvent) => {
    if (shouldNotify(event.key)) {
      listener();
    }
  };

  window.addEventListener(SIDEBAR_STORAGE_CHANGE_EVENT, handleStorageChange);
  window.addEventListener("storage", handleStorageEvent);

  return () => {
    window.removeEventListener(SIDEBAR_STORAGE_CHANGE_EVENT, handleStorageChange);
    window.removeEventListener("storage", handleStorageEvent);
  };
}

export function readSidebarCollapsedSections(): SidebarCollapsedSections {
  const parsed = parseStorageValue(SIDEBAR_COLLAPSED_SECTIONS_STORAGE_KEY);
  if (!isRecord(parsed)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(parsed).flatMap(([key, value]) => {
      if (!key.trim() || typeof value !== "boolean") {
        return [];
      }

      return [[key, value]];
    }),
  );
}

export function writeSidebarCollapsedSections(value: SidebarCollapsedSections) {
  writeStorageItem(SIDEBAR_COLLAPSED_SECTIONS_STORAGE_KEY, JSON.stringify(value));
}

export function readSidebarVisualPreset(): SidebarVisualPreset {
  const raw = readStorageItem(SIDEBAR_VISUAL_PRESET_STORAGE_KEY);
  if (raw === "compact" || raw === "comfort" || raw === "default") {
    return raw;
  }

  return "default";
}

export function writeSidebarVisualPreset(value: SidebarVisualPreset) {
  writeStorageItem(SIDEBAR_VISUAL_PRESET_STORAGE_KEY, value);
  emitStorageChange(SIDEBAR_VISUAL_PRESET_STORAGE_KEY);
  return value;
}

function computeDirectArchivePreview(messages: ChatMessage[]) {
  const latestVisibleMessage = [...messages]
    .toReversed()
    .find((message) => message.content.trim().length > 0);

  if (!latestVisibleMessage) {
    return "已归档，可稍后回看";
  }

  const previewText = latestVisibleMessage.content.replace(/\s+/g, " ").trim();
  return latestVisibleMessage.role === "user" ? `你：${previewText}` : previewText;
}

function normalizeDirectArchivesFromParsed(parsed: unknown) {
  if (!Array.isArray(parsed)) {
    return [];
  }

  const normalized = parsed.map((item): SidebarDirectArchive | null => {
    if (!isRecord(item)) {
      return null;
    }

    const messages = normalizeArchivedMessages(pickArchiveMessages(item));
    const agentId = readTrimmedString(item, ["agentId", "employeeId", "targetAgentId"]);
    const id = readTrimmedString(item, ["id", "archiveId"]) || `direct-archive:${agentId}`;
    const agentName = readTrimmedString(item, ["agentName", "employeeName", "name"]) || agentId;
    const preview = readTrimmedString(item, ["preview", "summary"]);
    const archivedAt = resolveArchivedAt(item, messages);
    const agentRole = readTrimmedString(item, ["agentRole", "role"]) || undefined;
    const agentAvatarUrl =
      readTrimmedString(item, ["agentAvatarUrl", "avatarUrl", "avatar"]) || undefined;
    const agentAvatarText = readTrimmedString(item, ["agentAvatarText", "avatarText"]) || undefined;
    const agentEmoji = readTrimmedString(item, ["agentEmoji", "emoji"]) || undefined;
    const title = readTrimmedString(item, ["title", "archiveTitle"]);

    if (!id || !agentId || !agentName || !archivedAt) {
      return null;
    }

    return {
      id,
      agentId,
      agentName,
      title,
      agentRole,
      agentAvatarUrl,
      agentAvatarText,
      agentEmoji,
      preview: preview || "已归档，可稍后回看",
      archivedAt,
      messages,
    } satisfies SidebarDirectArchive;
  });

  const normalizedArchives = normalized.filter(
    (archive): archive is SidebarDirectArchive => archive !== null,
  );

  return sortDirectArchivesByNewest(
    hydrateArchiveTitles(normalizedArchives, {
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

function normalizePendingDirectArchiveIds(parsed: unknown) {
  if (!Array.isArray(parsed)) {
    return [];
  }

  return Array.from(
    new Set(
      parsed.flatMap((value) => {
        if (typeof value !== "string" || !value.trim()) {
          return [];
        }

        return [value.trim()];
      }),
    ),
  );
}

function readLocalSidebarDirectArchives() {
  return normalizeDirectArchivesFromParsed(parseStorageValue(SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY));
}

function readPendingDirectArchiveDeletionIds() {
  return normalizePendingDirectArchiveIds(
    parseStorageValue(SIDEBAR_DIRECT_ARCHIVE_PENDING_DELETE_STORAGE_KEY),
  );
}

function writePendingDirectArchiveDeletionIds(value: string[]) {
  writeStorageItem(
    SIDEBAR_DIRECT_ARCHIVE_PENDING_DELETE_STORAGE_KEY,
    JSON.stringify(normalizePendingDirectArchiveIds(value)),
  );
}

function markPendingDirectArchiveDeletion(archiveId: string) {
  const nextIds = new Set(readPendingDirectArchiveDeletionIds());
  nextIds.add(archiveId);
  writePendingDirectArchiveDeletionIds(Array.from(nextIds));
}

function clearPendingDirectArchiveDeletion(archiveId: string) {
  const nextIds = readPendingDirectArchiveDeletionIds().filter((id) => id !== archiveId);
  writePendingDirectArchiveDeletionIds(nextIds);
}

function areDirectArchivesEqual(left: SidebarDirectArchive[], right: SidebarDirectArchive[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getCachedDirectArchives() {
  const localArchives = readLocalSidebarDirectArchives();
  if (
    cachedDirectArchives === null ||
    !areDirectArchivesEqual(cachedDirectArchives, localArchives)
  ) {
    cachedDirectArchives = localArchives;
    directArchiveSnapshotVersion += 1;
  }

  return cachedDirectArchives;
}

function writeLocalSidebarDirectArchives(value: SidebarDirectArchive[]) {
  if (cachedDirectArchives === null || !areDirectArchivesEqual(cachedDirectArchives, value)) {
    directArchiveSnapshotVersion += 1;
  }

  cachedDirectArchives = value;
  writeStorageItem(SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY, JSON.stringify(value));
  emitStorageChange(SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY);
  return value;
}

function normalizeDirectArchiveFromBackend(archive: BackendArchive): SidebarDirectArchive | null {
  if (archive.type !== "direct") {
    return null;
  }

  const messages = normalizeArchivedMessages(archive.messages);
  const id = archive.id.trim();
  const agentId = archive.source_id.trim();
  const agentName = archive.source_name?.trim() || agentId;
  const archivedAt = archive.archived_at?.trim() || archive.created_at.trim();
  if (!id || !agentId || !agentName || !archivedAt) {
    return null;
  }

  const metadata =
    Array.isArray(archive.messages) && isRecord(archive.messages[0]) ? archive.messages[0] : null;

  return {
    id,
    agentId,
    agentName,
    title: archive.title?.trim() || "",
    agentRole: metadata
      ? readTrimmedString(metadata, ["agentRole", "role"]) || undefined
      : undefined,
    agentAvatarUrl: metadata
      ? readTrimmedString(metadata, ["agentAvatarUrl", "avatarUrl", "avatar"]) || undefined
      : undefined,
    agentAvatarText: metadata
      ? readTrimmedString(metadata, ["agentAvatarText", "avatarText"]) || undefined
      : undefined,
    agentEmoji: metadata
      ? readTrimmedString(metadata, ["agentEmoji", "emoji"]) || undefined
      : undefined,
    preview: computeDirectArchivePreview(messages),
    archivedAt,
    messages,
  } satisfies SidebarDirectArchive;
}

function buildPersistedDirectArchiveMessages(archive: SidebarDirectArchive) {
  return cloneArchivedMessages(archive.messages ?? []).map((message, index) => ({
    ...message,
    agentRole: index === 0 ? archive.agentRole : undefined,
    agentAvatarUrl: index === 0 ? archive.agentAvatarUrl : undefined,
    agentAvatarText: index === 0 ? archive.agentAvatarText : undefined,
    agentEmoji: index === 0 ? archive.agentEmoji : undefined,
  }));
}

function buildBackendDirectArchivePayload(archive: SidebarDirectArchive) {
  return {
    id: archive.id,
    type: "direct",
    source_id: archive.agentId,
    source_name: archive.agentName,
    title: sanitizeArchiveTitle(archive.title),
    archived_at: archive.archivedAt,
    messages: buildPersistedDirectArchiveMessages(archive),
    message_count: archive.messages.length,
  };
}

async function createRemoteDirectArchive(archive: SidebarDirectArchive) {
  console.log(
    `[ArchiveFS] createRemoteDirectArchive called: id=${archive.id}, type=direct, source_id=${archive.agentId}, source_name=${archive.agentName}, archivedAt=${archive.archivedAt}, messagesCount=${archive.messages.length}`,
  );
  try {
    await archivesApi.create(buildBackendDirectArchivePayload(archive));
    console.log(`[ArchiveFS] createRemoteDirectArchive SUCCESS: id=${archive.id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      console.log(
        `[ArchiveFS] createRemoteDirectArchive CONFLICT (already exists): id=${archive.id}`,
      );
      return;
    }
    console.error(`[ArchiveFS] createRemoteDirectArchive ERROR: id=${archive.id}`, error);
    throw error;
  }
}

async function updateRemoteDirectArchiveTitle(archive: SidebarDirectArchive) {
  try {
    await archivesApi.update(archive.id, {
      title: sanitizeArchiveTitle(archive.title),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      await createRemoteDirectArchive(archive);
      return;
    }

    throw error;
  }
}

async function deleteRemoteDirectArchive(archiveId: string) {
  console.log(
    `[ArchiveFS] deleteRemoteDirectArchive called: archiveId=${archiveId}, timestamp=${new Date().toISOString()}`,
  );
  try {
    await archivesApi.remove(archiveId);
    console.log(`[ArchiveFS] deleteRemoteDirectArchive SUCCESS: archiveId=${archiveId}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      console.log(
        `[ArchiveFS] deleteRemoteDirectArchive 404 (already gone): archiveId=${archiveId}`,
      );
      return;
    }
    console.error(`[ArchiveFS] deleteRemoteDirectArchive ERROR: archiveId=${archiveId}`, error);
    throw error;
  }
}

async function runDirectArchiveApiSync(
  task: () => Promise<void>,
  label: string,
  options: {
    attempts?: number;
    retryDelayMs?: number;
  } = {},
) {
  const attempts = Math.max(1, Math.floor(options.attempts ?? DIRECT_ARCHIVE_SYNC_ATTEMPTS));
  const retryDelayMs = Math.max(
    0,
    Math.floor(options.retryDelayMs ?? DIRECT_ARCHIVE_SYNC_RETRY_DELAY_MS),
  );

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await task();
      return true;
    } catch (error) {
      if (attempt >= attempts) {
        console.warn(`[Archive] ${label} 失败，保留本地回退:`, error);
        return false;
      }

      console.warn(`[Archive] ${label} 第 ${attempt}/${attempts} 次失败，准备重试:`, error);
      if (retryDelayMs > 0) {
        await delay(retryDelayMs);
      }
    }
  }

  return false;
}

function queueDirectArchiveSync(task: () => Promise<void>, label: string) {
  directArchiveSyncChain = directArchiveSyncChain
    .then(async () => {
      await runDirectArchiveApiSync(task, label);
    })
    .catch((error) => {
      console.warn(`[Archive] ${label} 失败，保留本地回退:`, error);
    });

  return directArchiveSyncChain;
}

function syncSidebarDirectArchiveDelta(
  previousArchives: SidebarDirectArchive[],
  nextArchives: SidebarDirectArchive[],
) {
  const previousById = new Map(previousArchives.map((archive) => [archive.id, archive]));
  const nextById = new Map(nextArchives.map((archive) => [archive.id, archive]));
  const addedArchives = nextArchives.filter((archive) => !previousById.has(archive.id));
  const removedArchiveIds = previousArchives
    .filter((archive) => !nextById.has(archive.id))
    .map((archive) => archive.id);
  const renamedArchives = nextArchives.filter((archive) => {
    const previous = previousById.get(archive.id);
    return previous && sanitizeArchiveTitle(previous.title) !== sanitizeArchiveTitle(archive.title);
  });

  if (
    addedArchives.length === 0 &&
    removedArchiveIds.length === 0 &&
    renamedArchives.length === 0
  ) {
    return;
  }

  void queueDirectArchiveSync(async () => {
    for (const archive of addedArchives) {
      await createRemoteDirectArchive(archive);
    }

    for (const archive of renamedArchives) {
      await updateRemoteDirectArchiveTitle(archive);
    }

    for (const archiveId of removedArchiveIds) {
      await deleteRemoteDirectArchive(archiveId);
    }
  }, "同步 1v1 归档到后端");
}

export async function hydrateSidebarDirectArchivesFromApi() {
  console.log(`[ArchiveFS] hydrateSidebarDirectArchivesFromApi START`);
  if (directArchiveHydrationPromise) {
    console.log(`[ArchiveFS] hydrateSidebarDirectArchivesFromApi: using existing promise`);
    return directArchiveHydrationPromise;
  }

  directArchiveHydrationPromise = (async () => {
    const localArchives = getCachedDirectArchives();
    console.log(
      `[ArchiveFS] hydrate: localArchives from cache: ids=[${localArchives.map((a) => a.id).join(", ")}]`,
    );
    const snapshotVersionAtStart = directArchiveSnapshotVersion;
    const pendingAtStart = new Set(readPendingDirectArchiveDeletionIds());
    const remoteArchivesResponse = await archivesApi.list("direct");
    const pendingAtEnd = new Set(readPendingDirectArchiveDeletionIds());
    console.log(
      `[ArchiveFS] hydrate: raw response from /api/archives?type=direct: count=${remoteArchivesResponse.length}, ids=[${remoteArchivesResponse.map((archive) => archive.id).join(", ")}]`,
    );
    const remoteArchives = sortDirectArchivesByNewest(
      hydrateArchiveTitles(
        remoteArchivesResponse
          .map(normalizeDirectArchiveFromBackend)
          .filter((archive): archive is SidebarDirectArchive => archive !== null),
        {
          getTitle: (archive) => archive.title,
          getSourceName: (archive) => archive.agentName,
          getArchivedAt: (archive) => archive.archivedAt,
          setTitle: (archive, title) => ({
            ...archive,
            title,
          }),
        },
      ),
    );
    console.log(
      `[ArchiveFS] hydrate: normalized remoteArchives: ids=[${remoteArchives.map((a) => a.id).join(", ")}]`,
    );
    const latestLocalArchives = getCachedDirectArchives();
    console.log(
      `[ArchiveFS] hydrate: latestLocalArchives (after normalize): ids=[${latestLocalArchives.map((a) => a.id).join(", ")}]`,
    );
    if (snapshotVersionAtStart !== directArchiveSnapshotVersion) {
      console.log(
        `[ArchiveFS] hydrate: snapshotVersion changed during hydration, returning latestLocalArchives`,
      );
      return latestLocalArchives;
    }

    const pendingDeletedArchiveIds = new Set([...pendingAtStart, ...pendingAtEnd]);
    console.log(
      `[ArchiveFS] hydrate: pendingDeletedArchiveIds: ids=[${[...pendingDeletedArchiveIds].join(", ")}]`,
    );
    if (pendingDeletedArchiveIds.size > 0) {
      void queueDirectArchiveSync(async () => {
        console.log(
          `[ArchiveFS] hydrate: processing pending deletes: ids=[${[...pendingDeletedArchiveIds].join(", ")}]`,
        );
        for (const archiveId of readPendingDirectArchiveDeletionIds()) {
          await deleteRemoteDirectArchive(archiveId);
          clearPendingDirectArchiveDeletion(archiveId);
        }
      }, "补删已移除的 1v1 归档");
    }

    const visibleRemoteArchives = remoteArchives.filter(
      (archive) => !pendingDeletedArchiveIds.has(archive.id),
    );
    console.log(
      `[ArchiveFS] hydrate: visibleRemoteArchives (filtered by pendingDelete): ids=[${visibleRemoteArchives.map((a) => a.id).join(", ")}]`,
    );
    const mergedArchives = sortDirectArchivesByNewest(visibleRemoteArchives);
    console.log(
      `[ArchiveFS] hydrate: mergedArchives: ids=[${mergedArchives.map((a) => a.id).join(", ")}]`,
    );
    console.log(
      `[ArchiveFS] hydrate: comparing local vs merged: localCount=${localArchives.length}, mergedCount=${mergedArchives.length}, areEqual=${areDirectArchivesEqual(localArchives, mergedArchives)}`,
    );
    if (!areDirectArchivesEqual(localArchives, mergedArchives)) {
      console.log(
        `[ArchiveFS] hydrate: DIFFERENCE DETECTED - writing mergedArchives to localStorage`,
      );
      writeLocalSidebarDirectArchives(mergedArchives);
      return mergedArchives;
    }

    console.log(`[ArchiveFS] hydrate: no difference - using cached`);
    cachedDirectArchives = mergedArchives;
    return mergedArchives;
  })()
    .catch((error) => {
      console.warn("[ArchiveFS] hydrate: ERROR:", error);
      return getCachedDirectArchives();
    })
    .finally(() => {
      console.log(`[ArchiveFS] hydrateSidebarDirectArchivesFromApi END`);
      directArchiveHydrationPromise = null;
    });

  return directArchiveHydrationPromise;
}

export function readSidebarDirectArchives(): SidebarDirectArchive[] {
  const archives = getCachedDirectArchives();
  void hydrateSidebarDirectArchivesFromApi();
  return archives;
}

export function writeSidebarDirectArchives(
  value: SidebarDirectArchive[],
  options: {
    skipRemoteSync?: boolean;
  } = {},
) {
  const previousArchives = getCachedDirectArchives();
  const mappedArchives: Array<SidebarDirectArchive | null> = value.map((archive) => {
    const id = archive.id.trim();
    const agentId = archive.agentId.trim();
    const agentName = archive.agentName.trim();
    const archivedAt = archive.archivedAt.trim();
    const title = sanitizeArchiveTitle(archive.title);
    if (!id || !agentId || !agentName || !archivedAt) {
      return null;
    }

    return {
      ...archive,
      id,
      agentId,
      agentName,
      title,
      agentRole: archive.agentRole?.trim() || undefined,
      agentAvatarUrl: archive.agentAvatarUrl?.trim() || undefined,
      agentAvatarText: archive.agentAvatarText?.trim() || undefined,
      agentEmoji: archive.agentEmoji?.trim() || undefined,
      preview: archive.preview.trim() || "已归档，可稍后回看",
      archivedAt,
      messages: cloneArchivedMessages(archive.messages ?? []),
    } satisfies SidebarDirectArchive;
  });

  const normalized = sortDirectArchivesByNewest(
    mappedArchives.filter((archive): archive is SidebarDirectArchive => archive !== null),
  );

  writeLocalSidebarDirectArchives(normalized);
  if (!options.skipRemoteSync) {
    syncSidebarDirectArchiveDelta(previousArchives, normalized);
  }
  return normalized;
}

export async function persistSidebarDirectArchive(archive: SidebarDirectArchive) {
  console.log(
    `[ArchiveFS] persistSidebarDirectArchive called: id=${archive.id}, agentId=${archive.agentId}, agentName=${archive.agentName}`,
  );
  const synced = await runDirectArchiveApiSync(async () => {
    await createRemoteDirectArchive(archive);
  }, "创建 1v1 归档");
  if (!synced) {
    throw new Error("1v1 归档同步失败，请检查虾班后端是否可用");
  }
}

export async function deleteSidebarDirectArchiveFromBackend(archiveId: string) {
  await deleteRemoteDirectArchive(archiveId.trim());
}

export function appendSidebarDirectArchive(archive: SidebarDirectArchive) {
  return writeSidebarDirectArchives([archive, ...readSidebarDirectArchives()]);
}

export function removeSidebarDirectArchivesByAgentId(agentId: string) {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    return readSidebarDirectArchives();
  }

  const currentArchives = readSidebarDirectArchives();
  const nextArchives = currentArchives.filter((archive) => archive.agentId !== normalizedAgentId);
  if (nextArchives.length === currentArchives.length) {
    return currentArchives;
  }

  return writeSidebarDirectArchives(nextArchives);
}

export async function removeSidebarDirectArchiveById(archiveId: string) {
  console.log(
    `[ArchiveFS] removeSidebarDirectArchiveById called: archiveId=${archiveId}, timestamp=${new Date().toISOString()}`,
  );
  const normalizedArchiveId = archiveId.trim();
  if (!normalizedArchiveId) {
    console.log(`[ArchiveFS] removeSidebarDirectArchiveById: empty archiveId, returning current`);
    return readSidebarDirectArchives();
  }

  const currentArchives = getCachedDirectArchives();
  console.log(
    `[ArchiveFS] removeSidebarDirectArchiveById: currentArchives: ids=[${currentArchives.map((a) => a.id).join(", ")}]`,
  );
  if (!currentArchives.some((archive) => archive.id === normalizedArchiveId)) {
    console.log(
      `[ArchiveFS] removeSidebarDirectArchiveById: archive ${normalizedArchiveId} not found in currentArchives`,
    );
    return currentArchives;
  }

  const nextArchives = currentArchives.filter((archive) => archive.id !== normalizedArchiveId);
  console.log(
    `[ArchiveFS] removeSidebarDirectArchiveById: nextArchives (after filter): ids=[${nextArchives.map((a) => a.id).join(", ")}]`,
  );
  markPendingDirectArchiveDeletion(normalizedArchiveId);
  console.log(
    `[ArchiveFS] removeSidebarDirectArchiveById: pendingDelete marked for ${normalizedArchiveId}`,
  );
  writeSidebarDirectArchives(nextArchives, {
    skipRemoteSync: true,
  });
  console.log(
    `[ArchiveFS] removeSidebarDirectArchiveById: localStorage updated, now calling backend delete`,
  );

  const removed = await runDirectArchiveApiSync(async () => {
    await deleteRemoteDirectArchive(normalizedArchiveId);
  }, "删除 1v1 归档");
  if (removed) {
    console.log(
      `[ArchiveFS] removeSidebarDirectArchiveById: backend delete SUCCESS for ${normalizedArchiveId}`,
    );
    clearPendingDirectArchiveDeletion(normalizedArchiveId);
  } else {
    console.warn(
      `[ArchiveFS] removeSidebarDirectArchiveById: backend delete FAILED for ${normalizedArchiveId}, keeping pendingDelete marker`,
    );
  }

  console.log(`[ArchiveFS] removeSidebarDirectArchiveById: DONE for ${normalizedArchiveId}`);
  return nextArchives;
}

export async function renameSidebarDirectArchiveById(archiveId: string, title: string) {
  const normalizedArchiveId = archiveId.trim();
  const nextTitle = sanitizeArchiveTitle(title);
  const currentArchives = getCachedDirectArchives();
  if (!normalizedArchiveId || !nextTitle) {
    return {
      archives: currentArchives,
      renamed: false,
    };
  }

  let previousTitle = "";
  let renamed = false;
  const nextArchives = currentArchives.map((archive) => {
    if (archive.id !== normalizedArchiveId) {
      return archive;
    }

    const currentTitle = sanitizeArchiveTitle(archive.title);
    if (!currentTitle || currentTitle === nextTitle) {
      return archive;
    }

    previousTitle = currentTitle;
    renamed = true;
    return {
      ...archive,
      title: nextTitle,
    };
  });

  if (!renamed || !previousTitle) {
    return {
      archives: currentArchives,
      renamed: false,
    };
  }

  writeSidebarDirectArchives(nextArchives, {
    skipRemoteSync: true,
  });
  const renamedRemotely = await runDirectArchiveApiSync(async () => {
    const updatedArchive = nextArchives.find((archive) => archive.id === normalizedArchiveId);
    if (!updatedArchive) {
      return;
    }

    await updateRemoteDirectArchiveTitle(updatedArchive);
  }, "重命名 1v1 归档");
  if (!renamedRemotely) {
    writeSidebarDirectArchives(currentArchives, {
      skipRemoteSync: true,
    });
    throw new Error("1v1 归档标题同步失败，请稍后重试");
  }

  console.log(`[Archive] 归档重命名: ${previousTitle} → ${nextTitle}`);
  return {
    archives: nextArchives,
    renamed: true,
  };
}

export function readSidebarUnreadState(): SidebarUnreadState {
  const parsed = parseStorageValue(SIDEBAR_UNREAD_STORAGE_KEY);
  if (!isRecord(parsed)) {
    return {
      directByAgentId: {},
      groupById: {},
    };
  }

  return {
    directByAgentId: normalizeUnreadMap(parsed.directByAgentId),
    groupById: normalizeUnreadMap(parsed.groupById),
  };
}

export function writeSidebarUnreadState(value: SidebarUnreadState) {
  const normalized = {
    directByAgentId: normalizeUnreadMap(value.directByAgentId),
    groupById: normalizeUnreadMap(value.groupById),
  } satisfies SidebarUnreadState;

  writeStorageItem(SIDEBAR_UNREAD_STORAGE_KEY, JSON.stringify(normalized));
  emitStorageChange(SIDEBAR_UNREAD_STORAGE_KEY);
  return normalized;
}

export function incrementSidebarDirectUnreadCount(agentId: string, delta = 1) {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId || !Number.isFinite(delta) || delta <= 0) {
    return readSidebarUnreadState();
  }

  const current = readSidebarUnreadState();
  return writeSidebarUnreadState({
    ...current,
    directByAgentId: {
      ...current.directByAgentId,
      [normalizedAgentId]: (current.directByAgentId[normalizedAgentId] ?? 0) + Math.floor(delta),
    },
  });
}

export function clearSidebarDirectUnreadCount(agentId: string) {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    return readSidebarUnreadState();
  }

  const current = readSidebarUnreadState();
  if (!(normalizedAgentId in current.directByAgentId)) {
    return current;
  }

  const nextDirectByAgentId = { ...current.directByAgentId };
  delete nextDirectByAgentId[normalizedAgentId];
  return writeSidebarUnreadState({
    ...current,
    directByAgentId: nextDirectByAgentId,
  });
}

export function incrementSidebarGroupUnreadCount(groupId: string, delta = 1) {
  const normalizedGroupId = groupId.trim();
  if (!normalizedGroupId || !Number.isFinite(delta) || delta <= 0) {
    return readSidebarUnreadState();
  }

  const current = readSidebarUnreadState();
  return writeSidebarUnreadState({
    ...current,
    groupById: {
      ...current.groupById,
      [normalizedGroupId]: (current.groupById[normalizedGroupId] ?? 0) + Math.floor(delta),
    },
  });
}

export function clearSidebarGroupUnreadCount(groupId: string) {
  const normalizedGroupId = groupId.trim();
  if (!normalizedGroupId) {
    return readSidebarUnreadState();
  }

  const current = readSidebarUnreadState();
  if (!(normalizedGroupId in current.groupById)) {
    return current;
  }

  const nextGroupById = { ...current.groupById };
  delete nextGroupById[normalizedGroupId];
  return writeSidebarUnreadState({
    ...current,
    groupById: nextGroupById,
  });
}

export function purgeSidebarAgentData(agentId: string) {
  removeSidebarAgentMeta(agentId);
  removeSidebarDirectArchivesByAgentId(agentId);
  clearSidebarDirectUnreadCount(agentId);
}
