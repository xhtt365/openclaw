import { migrateApi } from "@/services/api";
import {
  readSidebarAgentMetaMap,
  readSidebarDepartments,
  readSidebarDirectArchives,
  type SidebarAgentMetaMap,
  type SidebarDirectArchive,
} from "@/utils/sidebarPersistence";
import {
  listLocalStorageKeys,
  readLocalStorageItem,
  removeLocalStorageItem,
} from "@/utils/storage";

const LEGACY_GROUP_STORAGE_KEY = "wurenju.groups.v1";
const LEGACY_AGENT_STORE_KEYS = [
  "agent-store",
  "agentStore",
  "employee-store",
  "employeeStore",
  "employees-store",
  "employeesStore",
] as const;
const LEGACY_GROUP_STORE_KEYS = ["group-store", "groupStore", LEGACY_GROUP_STORAGE_KEY] as const;
const LEGACY_ARCHIVE_STORE_KEYS = [
  "archive-store",
  "archiveStore",
  "direct-archive-store",
  "directArchiveStore",
  "directArchive-store",
  "xiaban.sidebar.directArchives",
] as const;
const LEGACY_CRON_STORE_KEYS = [
  "cron-store",
  "cronStore",
  "cron-task-store",
  "cronTaskStore",
  "xiaban.cron.tasks",
] as const;
const LEGACY_DEPARTMENT_KEYS = [
  "xiaban.sidebar.departments",
  "xiaban.sidebar.agentMeta",
  "employeeDepartmentMap",
  "pinnedEmployees",
] as const;

const ALL_LEGACY_KEYS = [
  ...LEGACY_AGENT_STORE_KEYS,
  ...LEGACY_GROUP_STORE_KEYS,
  ...LEGACY_ARCHIVE_STORE_KEYS,
  ...LEGACY_CRON_STORE_KEYS,
  ...LEGACY_DEPARTMENT_KEYS,
] as const;

type LegacyEmployeePayload = {
  id: string;
  name: string;
  avatar: string | null;
  position: string | null;
  department: string | null;
  description: string | null;
  pinned: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

function safeJsonParse(raw: string | null) {
  if (!raw?.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function hasLegacyKey(key: string) {
  return readLocalStorageItem(key) !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trimToString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function trimToOptionalString(value: unknown) {
  const normalized = trimToString(value);
  return normalized || null;
}

function readLegacyRaw(key: string) {
  const raw = readLocalStorageItem(key);
  console.log(`[Migrate] localStorage[${key}] 原始数据:`, raw);
  return raw;
}

function readLegacyJson(key: string) {
  return safeJsonParse(readLegacyRaw(key));
}

function pickFirstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = trimToString(record[key]);
    if (value) {
      return value;
    }
  }

  return "";
}

function pickFirstNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function pickFirstBoolean(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return value !== 0;
    }

    if (typeof value === "string" && value.trim()) {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1") {
        return true;
      }

      if (normalized === "false" || normalized === "0") {
        return false;
      }
    }
  }

  return undefined;
}

function normalizeLegacyList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord);
}

function getLegacyGroupList(groupsPayload: unknown) {
  if (Array.isArray(groupsPayload)) {
    return groupsPayload.filter(isRecord);
  }

  if (!isRecord(groupsPayload)) {
    return [];
  }

  return normalizeLegacyList(groupsPayload.groups);
}

function getLegacyGroupArchives(groupsPayload: unknown) {
  if (!isRecord(groupsPayload)) {
    return [];
  }

  return normalizeLegacyList(groupsPayload.archives);
}

function createBaseLegacyEmployee(
  id: string,
  sortOrder: number,
  sidebarAgentMetaMap: SidebarAgentMetaMap,
): LegacyEmployeePayload {
  const sidebarMeta = sidebarAgentMetaMap[id];
  const timestamp = new Date(0).toISOString();
  return {
    id,
    name: id,
    avatar: null,
    position: null,
    department: sidebarMeta?.departmentId ?? null,
    description: null,
    pinned: sidebarMeta?.pinned === true,
    sortOrder,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function upsertLegacyEmployee(
  employeeMap: Map<string, LegacyEmployeePayload>,
  raw: unknown,
  sidebarAgentMetaMap: SidebarAgentMetaMap,
) {
  if (!isRecord(raw)) {
    return;
  }

  const id = pickFirstString(raw, ["id", "agentId", "agent_id", "employeeId", "targetAgentId"]);
  if (!id) {
    return;
  }

  const existing =
    employeeMap.get(id) ?? createBaseLegacyEmployee(id, employeeMap.size, sidebarAgentMetaMap);
  const sidebarMeta = sidebarAgentMetaMap[id];
  const nextCreatedAt =
    pickFirstString(raw, ["createdAt", "created_at", "archivedAt", "archived_at"]) ||
    existing.createdAt;
  const nextUpdatedAt =
    pickFirstString(raw, ["updatedAt", "updated_at", "archivedAt", "archived_at"]) ||
    nextCreatedAt ||
    existing.updatedAt;

  employeeMap.set(id, {
    id,
    name:
      pickFirstString(raw, ["name", "agentName", "employeeName", "displayName"]) || existing.name,
    avatar:
      pickFirstString(raw, ["avatar", "avatarUrl", "agentAvatarUrl", "image"]) || existing.avatar,
    position: pickFirstString(raw, ["position", "role", "title", "agentRole"]) || existing.position,
    department:
      pickFirstString(raw, ["department", "departmentId", "departmentName"]) ||
      sidebarMeta?.departmentId ||
      existing.department,
    description: pickFirstString(raw, ["description", "bio"]) || existing.description,
    pinned: pickFirstBoolean(raw, ["pinned"]) ?? sidebarMeta?.pinned ?? existing.pinned,
    sortOrder: pickFirstNumber(raw, ["sortOrder", "sort_order"]) ?? existing.sortOrder,
    createdAt: nextCreatedAt,
    updatedAt: nextUpdatedAt,
  });
}

function collectLegacyEmployees(params: {
  groupsPayload: unknown;
  directArchives: SidebarDirectArchive[];
}) {
  const sidebarAgentMetaMap = readSidebarAgentMetaMap();
  const employeeMap = new Map<string, LegacyEmployeePayload>();

  for (const key of LEGACY_AGENT_STORE_KEYS) {
    const parsed = readLegacyJson(key);
    if (Array.isArray(parsed)) {
      parsed.forEach((item) => {
        upsertLegacyEmployee(employeeMap, item, sidebarAgentMetaMap);
      });
      continue;
    }

    if (!isRecord(parsed)) {
      continue;
    }

    const record = parsed;
    normalizeLegacyList(record.employees).forEach((item) => {
      upsertLegacyEmployee(employeeMap, item, sidebarAgentMetaMap);
    });
    normalizeLegacyList(record.agents).forEach((item) => {
      upsertLegacyEmployee(employeeMap, item, sidebarAgentMetaMap);
    });
  }

  getLegacyGroupList(params.groupsPayload).forEach((group) => {
    normalizeLegacyList(group.members).forEach((member) => {
      upsertLegacyEmployee(employeeMap, member, sidebarAgentMetaMap);
    });

    const leaderId = pickFirstString(group, ["leaderId", "owner_agent_id", "ownerAgentId"]);
    if (leaderId) {
      upsertLegacyEmployee(
        employeeMap,
        {
          id: leaderId,
        },
        sidebarAgentMetaMap,
      );
    }
  });

  getLegacyGroupArchives(params.groupsPayload).forEach((archive) => {
    normalizeLegacyList(archive.messages).forEach((message) => {
      upsertLegacyEmployee(
        employeeMap,
        {
          id: pickFirstString(message, ["senderId", "agentId", "agent_id"]),
          name: pickFirstString(message, ["senderName", "agentName"]),
          avatarUrl: pickFirstString(message, ["senderAvatarUrl", "agentAvatarUrl"]),
          role: pickFirstString(message, ["senderRole", "agentRole"]),
          archivedAt: pickFirstString(archive, ["createdAt", "archivedAt", "archived_at"]),
        },
        sidebarAgentMetaMap,
      );
    });
  });

  params.directArchives.forEach((archive) => {
    upsertLegacyEmployee(
      employeeMap,
      {
        id: archive.agentId,
        name: archive.agentName,
        avatarUrl: archive.agentAvatarUrl,
        role: archive.agentRole,
        archivedAt: archive.archivedAt,
      },
      sidebarAgentMetaMap,
    );
  });

  const employees = Array.from(employeeMap.values())
    .map((employee) => ({
      ...employee,
      name: employee.name || employee.id,
      avatar: trimToOptionalString(employee.avatar),
      position: trimToOptionalString(employee.position),
      department: trimToOptionalString(employee.department),
      description: trimToOptionalString(employee.description),
      createdAt: employee.createdAt || new Date(0).toISOString(),
      updatedAt: employee.updatedAt || employee.createdAt || new Date(0).toISOString(),
    }))
    .toSorted((left, right) => {
      const pinnedDelta = Number(right.pinned) - Number(left.pinned);
      if (pinnedDelta !== 0) {
        return pinnedDelta;
      }

      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder;
      }

      return left.name.localeCompare(right.name, "zh-CN");
    });

  console.log("[Migrate] 迁移前汇总出的 employees:", employees);
  return employees;
}

function collectLegacyGroupsPayload() {
  const parsed = readLegacyJson(LEGACY_GROUP_STORAGE_KEY);
  if (parsed && (typeof parsed === "object" || Array.isArray(parsed))) {
    return parsed;
  }

  for (const key of LEGACY_GROUP_STORE_KEYS) {
    if (key === LEGACY_GROUP_STORAGE_KEY) {
      continue;
    }

    const fallback = readLegacyJson(key);
    if (fallback && (typeof fallback === "object" || Array.isArray(fallback))) {
      return fallback;
    }
  }

  return null;
}

function collectLegacyArchives(groupsPayload: unknown) {
  const groupArchives = getLegacyGroupArchives(groupsPayload);
  const directArchives = readSidebarDirectArchives();
  console.log("[Migrate] 迁移前汇总出的 groups payload:", groupsPayload);
  console.log("[Migrate] 迁移前汇总出的 group archives:", groupArchives);
  console.log("[Migrate] 迁移前汇总出的 direct archives:", directArchives);

  return {
    groupArchives,
    directArchives,
  };
}

function collectLegacyCronTasks() {
  for (const key of LEGACY_CRON_STORE_KEYS) {
    const parsed = readLegacyJson(key);
    if (!parsed || typeof parsed !== "object") {
      continue;
    }

    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.jobs)) {
      return record.jobs;
    }

    if (Array.isArray(record.tasks)) {
      return record.tasks;
    }
  }

  return [];
}

function collectLegacySettings() {
  const excludedKeys = new Set<string>(ALL_LEGACY_KEYS);
  const settingsEntries = listLocalStorageKeys()
    .filter(
      (key) =>
        (key.startsWith("xiaban.sidebar.") || key.startsWith("xiaban.chat.")) &&
        !excludedKeys.has(key),
    )
    .map((key) => ({
      key,
      value: safeJsonParse(readLocalStorageItem(key)) ?? readLocalStorageItem(key),
    }));

  return settingsEntries;
}

export function shouldRunLegacyMigration() {
  return ALL_LEGACY_KEYS.some(hasLegacyKey);
}

export async function runLegacyMigrationIfNeeded() {
  if (typeof window === "undefined") {
    return {
      migrated: false,
      imported: null,
    };
  }

  if (!shouldRunLegacyMigration()) {
    console.log("[Migrate] 未发现旧版业务数据，跳过迁移");
    return {
      migrated: false,
      imported: null,
    };
  }

  const groupsPayload = collectLegacyGroupsPayload() ?? null;
  const { groupArchives, directArchives } = collectLegacyArchives(groupsPayload);
  const payload = {
    employees: collectLegacyEmployees({
      groupsPayload,
      directArchives,
    }),
    departments: readSidebarDepartments(),
    groups: groupsPayload,
    archives: groupArchives,
    directArchives,
    cronTasks: collectLegacyCronTasks(),
    settings: collectLegacySettings(),
  } satisfies Record<string, unknown>;

  const response = await migrateApi.run(payload);
  for (const key of ALL_LEGACY_KEYS) {
    removeLocalStorageItem(key);
  }

  console.log(
    `[Migrate] 迁移完成，employees: ${response.imported.employees}, groups: ${response.imported.groups}, archives: ${response.imported.archives}, departments: ${response.imported.departments}, cronTasks: ${response.imported.cron_tasks}`,
  );

  return {
    migrated: true,
    imported: response.imported,
  };
}
