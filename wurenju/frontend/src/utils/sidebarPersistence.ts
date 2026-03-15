"use client";

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
  preview: string;
  archivedAt: string;
};

export type SidebarCollapsedSections = Record<string, boolean>;

export const SIDEBAR_DEPARTMENTS_STORAGE_KEY = "xiaban.sidebar.departments";
export const SIDEBAR_AGENT_META_STORAGE_KEY = "xiaban.sidebar.agentMeta";
export const EMPLOYEE_DEPARTMENT_MAP_STORAGE_KEY = "employeeDepartmentMap";
export const PINNED_EMPLOYEES_STORAGE_KEY = "pinnedEmployees";
export const SIDEBAR_COLLAPSED_SECTIONS_STORAGE_KEY = "xiaban.sidebar.collapsedSections.v2";
export const SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY = "xiaban.sidebar.directArchives";
const SIDEBAR_STORAGE_CHANGE_EVENT = "xiaban:sidebar-storage-change";

// 这几类数据当前都先走本地 mock，后续接后端时统一从这里替换读写入口。
function readStorageItem(key: string) {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(key);
}

function writeStorageItem(key: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(key, value);
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

export function readSidebarDirectArchives(): SidebarDirectArchive[] {
  const parsed = parseStorageValue(SIDEBAR_DIRECT_ARCHIVES_STORAGE_KEY);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const id = typeof item.id === "string" ? item.id.trim() : "";
      const agentId = typeof item.agentId === "string" ? item.agentId.trim() : "";
      const agentName = typeof item.agentName === "string" ? item.agentName.trim() : "";
      const preview = typeof item.preview === "string" ? item.preview.trim() : "";
      const archivedAt = typeof item.archivedAt === "string" ? item.archivedAt.trim() : "";

      if (!id || !agentId || !agentName || !archivedAt) {
        return null;
      }

      return {
        id,
        agentId,
        agentName,
        preview: preview || "已归档，可稍后回看",
        archivedAt,
      };
    })
    .filter((archive): archive is SidebarDirectArchive => archive !== null)
    .toSorted(
      (left, right) => new Date(right.archivedAt).getTime() - new Date(left.archivedAt).getTime(),
    );
}
