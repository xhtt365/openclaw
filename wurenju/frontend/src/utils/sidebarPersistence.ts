"use client";

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
export const SIDEBAR_UNREAD_STORAGE_KEY = "xiaban.sidebar.unreadState";
export const SIDEBAR_VISUAL_PRESET_STORAGE_KEY = "xiaban.sidebar.visualPreset";
const SIDEBAR_STORAGE_CHANGE_EVENT = "xiaban:sidebar-storage-change";

// 这几类数据当前都先走本地 mock，后续接后端时统一从这里替换读写入口。
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

export function readSidebarDirectArchives(): SidebarDirectArchive[] {
  const parsed = parseStorageValue(SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY);
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

export function writeSidebarDirectArchives(value: SidebarDirectArchive[]) {
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

  writeStorageItem(SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY, JSON.stringify(normalized));
  emitStorageChange(SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY);
  return normalized;
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

export function removeSidebarDirectArchiveById(archiveId: string) {
  const normalizedArchiveId = archiveId.trim();
  if (!normalizedArchiveId) {
    return readSidebarDirectArchives();
  }

  const currentArchives = readSidebarDirectArchives();
  const nextArchives = currentArchives.filter((archive) => archive.id !== normalizedArchiveId);
  if (nextArchives.length === currentArchives.length) {
    return currentArchives;
  }

  console.log(`[Archive] 删除 1v1 归档: ${normalizedArchiveId}`);
  return writeSidebarDirectArchives(nextArchives);
}

export function renameSidebarDirectArchiveById(archiveId: string, title: string) {
  const normalizedArchiveId = archiveId.trim();
  const nextTitle = sanitizeArchiveTitle(title);
  const currentArchives = readSidebarDirectArchives();
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

  console.log(`[Archive] 归档重命名: ${previousTitle} → ${nextTitle}`);
  return {
    archives: writeSidebarDirectArchives(nextArchives),
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
