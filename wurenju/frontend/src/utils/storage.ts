import { toast } from "@/hooks/use-toast";

type StorageTrimMode = "normal" | "soft" | "aggressive";
type StorageReason = "startup" | "preflight" | "quota";
type StoragePolicy = {
  id: string;
  order: number;
  matches: (key: string) => boolean;
  trim: (key: string, value: string, mode: StorageTrimMode) => string | null;
};
type StorageMaintenanceResult = {
  totalBytes: number;
  freedBytes: number;
  changedKeys: string[];
  changed: boolean;
};

const STORAGE_SAFE_TOTAL_BYTES = 4_200_000;
const STORAGE_SOFT_TARGET_BYTES = 3_900_000;
const STORAGE_AGGRESSIVE_TARGET_BYTES = 3_300_000;
const STORAGE_TOAST_COOLDOWN_MS = 20_000;
const STORAGE_TOAST_KEY = "storage-space";
const EMPTY_STORAGE: Storage = {
  get length() {
    return 0;
  },
  clear() {},
  getItem() {
    return null;
  },
  key() {
    return null;
  },
  removeItem() {},
  setItem() {},
};

const toastTimestamps = new Map<string, number>();

function resolveByteSize(value: string) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).length;
  }

  return value.length * 2;
}

function resolveEntrySize(key: string, value: string) {
  return resolveByteSize(key) + resolveByteSize(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function now() {
  return Date.now();
}

function isQuotaExceededError(error: unknown) {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED";
  }

  return (
    !!error &&
    typeof error === "object" &&
    "name" in error &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

function isStorageLike(value: unknown): value is Storage {
  return (
    !!value &&
    typeof value === "object" &&
    "getItem" in value &&
    typeof value.getItem === "function" &&
    "setItem" in value &&
    typeof value.setItem === "function" &&
    "removeItem" in value &&
    typeof value.removeItem === "function" &&
    "key" in value &&
    typeof value.key === "function" &&
    "clear" in value &&
    typeof value.clear === "function"
  );
}

function resolveStorage() {
  if (typeof window !== "undefined" && isStorageLike(window.localStorage)) {
    return window.localStorage;
  }

  if (typeof localStorage !== "undefined" && isStorageLike(localStorage)) {
    return localStorage;
  }

  return null;
}

function readStorageKeys(storage: Storage) {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (typeof key === "string") {
      keys.push(key);
    }
  }
  return keys;
}

function resolveTotalBytes(storage: Storage) {
  return readStorageKeys(storage).reduce((total, key) => {
    const value = storage.getItem(key);
    return total + (typeof value === "string" ? resolveEntrySize(key, value) : 0);
  }, 0);
}

function normalizeTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  }

  return 0;
}

function logStorage(message: string, ...args: unknown[]) {
  console.log(`[Storage] ${message}`, ...args);
}

function warnStorage(message: string, ...args: unknown[]) {
  console.warn(`[Storage] ${message}`, ...args);
}

function notifyStorageToast(message: "cleaned" | "tight") {
  const currentTime = now();
  const lastShownAt = toastTimestamps.get(STORAGE_TOAST_KEY) ?? 0;
  if (currentTime - lastShownAt < STORAGE_TOAST_COOLDOWN_MS) {
    return;
  }

  toastTimestamps.set(STORAGE_TOAST_KEY, currentTime);
  if (message === "cleaned") {
    toast({
      title: "已自动整理本地缓存",
      description: "已保留最近的聊天记录和配置，页面会继续正常使用。",
    });
    return;
  }

  toast({
    title: "本地存储空间偏紧",
    description: "已尽量保留最近的数据，部分更旧的本地缓存可能暂未继续保存。",
  });
}

function trimMessageList(messages: unknown, limit: number) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.slice(-limit);
}

function trimGroupStorageValue(value: string, mode: StorageTrimMode) {
  const parsed = safeJsonParse(value);
  if (Array.isArray(parsed) || !isRecord(parsed)) {
    return value;
  }

  const maxBytesByMode: Record<StorageTrimMode, number> = {
    normal: 1_800_000,
    soft: 1_250_000,
    aggressive: 780_000,
  };
  const steps = [
    { groupMessages: 220, archives: 14, archiveMessages: 120 },
    { groupMessages: 160, archives: 10, archiveMessages: 80 },
    { groupMessages: 100, archives: 6, archiveMessages: 48 },
    { groupMessages: 60, archives: 4, archiveMessages: 24 },
  ];

  const rawGroups = Array.isArray(parsed.groups) ? parsed.groups : [];
  const groupIds = new Set(
    rawGroups.flatMap((group) =>
      isRecord(group) && typeof group.id === "string" && group.id.trim() ? [group.id.trim()] : [],
    ),
  );
  const rawMessagesByGroupId = isRecord(parsed.messagesByGroupId) ? parsed.messagesByGroupId : {};
  const rawArchives = Array.isArray(parsed.archives)
    ? parsed.archives.filter((archive): archive is Record<string, unknown> => isRecord(archive))
    : [];
  const sortedArchives = rawArchives.toSorted(
    (left, right) =>
      normalizeTimestamp(right.createdAt ?? right.archivedAt) -
      normalizeTimestamp(left.createdAt ?? left.archivedAt),
  );

  const buildPayload = (step: (typeof steps)[number]) => {
    const messagesByGroupId = Object.fromEntries(
      Array.from(groupIds).map((groupId) => [
        groupId,
        trimMessageList(rawMessagesByGroupId[groupId], step.groupMessages),
      ]),
    );
    const archives = sortedArchives.slice(0, step.archives).map(
      (archive): Record<string, unknown> => ({
        ...archive,
        messages: trimMessageList(archive.messages, step.archiveMessages),
      }),
    );
    const selectedGroupId =
      typeof parsed.selectedGroupId === "string" && groupIds.has(parsed.selectedGroupId)
        ? parsed.selectedGroupId
        : null;
    const archiveIds = new Set(
      archives.flatMap((archive: Record<string, unknown>) =>
        typeof archive.id === "string" && archive.id.trim() ? [archive.id.trim()] : [],
      ),
    );

    return {
      groups: rawGroups,
      selectedGroupId,
      selectedArchiveId:
        typeof parsed.selectedArchiveId === "string" && archiveIds.has(parsed.selectedArchiveId)
          ? parsed.selectedArchiveId
          : null,
      messagesByGroupId,
      archives,
    };
  };

  const maxBytes = maxBytesByMode[mode];
  for (const step of steps) {
    const raw = JSON.stringify(buildPayload(step));
    if (resolveByteSize(raw) <= maxBytes) {
      return raw;
    }
  }

  return JSON.stringify(buildPayload(steps[steps.length - 1]));
}

function trimSidebarDirectArchivesValue(value: string, mode: StorageTrimMode) {
  const parsed = safeJsonParse(value);
  if (!Array.isArray(parsed)) {
    return value;
  }

  const maxBytesByMode: Record<StorageTrimMode, number> = {
    normal: 700_000,
    soft: 460_000,
    aggressive: 240_000,
  };
  const steps = [
    { archives: 16, messages: 120 },
    { archives: 10, messages: 80 },
    { archives: 6, messages: 48 },
    { archives: 4, messages: 24 },
  ];
  const sorted = parsed
    .filter((archive): archive is Record<string, unknown> => isRecord(archive))
    .toSorted(
      (left, right) =>
        normalizeTimestamp(right.archivedAt ?? right.createdAt) -
        normalizeTimestamp(left.archivedAt ?? left.createdAt),
    );

  const maxBytes = maxBytesByMode[mode];
  for (const step of steps) {
    const raw = JSON.stringify(
      sorted.slice(0, step.archives).map((archive) => ({
        ...archive,
        messages: trimMessageList(archive.messages, step.messages),
      })),
    );
    if (resolveByteSize(raw) <= maxBytes) {
      return raw;
    }
  }

  return JSON.stringify(
    sorted.slice(0, steps[steps.length - 1].archives).map((archive) => ({
      ...archive,
      messages: trimMessageList(archive.messages, steps[steps.length - 1].messages),
    })),
  );
}

function trimConfigHistoryValue(value: string, mode: StorageTrimMode) {
  const parsed = safeJsonParse(value);
  if (!Array.isArray(parsed)) {
    return value;
  }

  const maxBytesByMode: Record<StorageTrimMode, number> = {
    normal: 260_000,
    soft: 180_000,
    aggressive: 96_000,
  };
  const sorted = parsed
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .toSorted(
      (left, right) => normalizeTimestamp(right.timestamp) - normalizeTimestamp(left.timestamp),
    );
  const maxBytes = maxBytesByMode[mode];

  for (const keepCount of [20, 12, 8, 4, 2, 1]) {
    const raw = JSON.stringify(sorted.slice(0, keepCount));
    if (resolveByteSize(raw) <= maxBytes) {
      return raw;
    }
  }

  return JSON.stringify([]);
}

function trimAgentAvatarMapValue(value: string, mode: StorageTrimMode) {
  const parsed = safeJsonParse(value);
  if (!isRecord(parsed)) {
    return value;
  }

  const maxBytesByMode: Record<StorageTrimMode, number> = {
    normal: 320_000,
    soft: 220_000,
    aggressive: 120_000,
  };
  const entries = Object.entries(parsed).filter(
    (entry): entry is [string, string] =>
      typeof entry[0] === "string" &&
      entry[0].trim().length > 0 &&
      typeof entry[1] === "string" &&
      entry[1].trim().length > 0,
  );
  const maxBytes = maxBytesByMode[mode];

  for (const keepCount of [48, 32, 20, 12, 6]) {
    const raw = JSON.stringify(Object.fromEntries(entries.slice(-keepCount)));
    if (resolveByteSize(raw) <= maxBytes) {
      return raw;
    }
  }

  return JSON.stringify({});
}

function trimUserAvatarValue(value: string, mode: StorageTrimMode) {
  const maxBytesByMode: Record<StorageTrimMode, number> = {
    normal: 220_000,
    soft: 160_000,
    aggressive: 100_000,
  };

  if (resolveByteSize(value) <= maxBytesByMode[mode]) {
    return value;
  }

  return mode === "aggressive" ? null : value;
}

function trimRuntimeStatusValue(value: string) {
  const parsed = safeJsonParse(value);
  if (!isRecord(parsed)) {
    return value;
  }

  const filtered = Object.fromEntries(
    Object.entries(parsed).flatMap(([providerId, status]) => {
      if (!isRecord(status)) {
        return [];
      }

      const state = typeof status.status === "string" ? status.status : "healthy";
      const cooldownUntil = normalizeTimestamp(status.cooldownUntil);
      const resetAt = normalizeTimestamp(status.resetAt);
      const expired =
        (state === "rate_limited" || state === "error") &&
        cooldownUntil > 0 &&
        cooldownUntil < now();
      const reset = state === "quota_exhausted" && resetAt > 0 && resetAt < now();
      if (state === "healthy" || expired || reset) {
        return [];
      }

      return [[providerId, status]];
    }),
  );

  return JSON.stringify(filtered);
}

function trimAgentModelAccessValue(value: string) {
  const parsed = safeJsonParse(value);
  if (!isRecord(parsed)) {
    return value;
  }

  const normalized = Object.fromEntries(
    Object.entries(parsed)
      .slice(0, 80)
      .map(([agentId, refs]) => [
        agentId,
        Array.isArray(refs)
          ? refs
              .filter((ref): ref is string => typeof ref === "string" && ref.trim().length > 0)
              .slice(0, 64)
          : [],
      ]),
  );

  return JSON.stringify(normalized);
}

function trimModelProvidersValue(value: string) {
  const parsed = safeJsonParse(value);
  if (!isRecord(parsed)) {
    return value;
  }

  const normalized = Object.fromEntries(
    Object.entries(parsed)
      .slice(0, 24)
      .map(([providerId, meta]) => {
        if (!isRecord(meta)) {
          return [providerId, {}];
        }

        const models = isRecord(meta.models)
          ? Object.fromEntries(Object.entries(meta.models).slice(0, 64))
          : {};

        return [providerId, { ...meta, models }];
      }),
  );

  return JSON.stringify(normalized);
}

function trimNumberArrayValue(value: string, limit: number) {
  const parsed = safeJsonParse(value);
  if (!Array.isArray(parsed)) {
    return value;
  }

  const next = parsed.filter((item) => typeof item === "number").slice(-limit);
  return next.length === 0 ? null : JSON.stringify(next);
}

function trimStringArrayValue(value: string, limit: number) {
  const parsed = safeJsonParse(value);
  if (!Array.isArray(parsed)) {
    return value;
  }

  const next = parsed
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(-limit);
  return next.length === 0 ? null : JSON.stringify(next);
}

const STORAGE_POLICIES: StoragePolicy[] = [
  {
    id: "compaction-backup",
    order: 0,
    matches: (key: string) => key.startsWith("compacted:"),
    trim: () => null,
  },
  {
    id: "deleted-messages",
    order: 1,
    matches: (key: string) => key.startsWith("openclaw:deleted:"),
    trim: (_key: string, value: string, mode: StorageTrimMode) =>
      trimStringArrayValue(value, mode === "normal" ? 400 : mode === "soft" ? 240 : 120),
  },
  {
    id: "pinned-messages",
    order: 2,
    matches: (key: string) => key.startsWith("openclaw:pinned:"),
    trim: (_key: string, value: string, mode: StorageTrimMode) =>
      trimNumberArrayValue(value, mode === "normal" ? 200 : mode === "soft" ? 120 : 60),
  },
  {
    id: "group-storage",
    order: 3,
    matches: (key: string) => key === "wurenju.groups.v1",
    trim: (_key: string, value: string, mode: StorageTrimMode) =>
      trimGroupStorageValue(value, mode),
  },
  {
    id: "direct-archives",
    order: 4,
    matches: (key: string) => key === "xiaban.sidebar.directArchives",
    trim: (_key: string, value: string, mode: StorageTrimMode) =>
      trimSidebarDirectArchivesValue(value, mode),
  },
  {
    id: "config-history",
    order: 5,
    matches: (key: string) => key === "lobster-config-history",
    trim: (_key: string, value: string, mode: StorageTrimMode) =>
      trimConfigHistoryValue(value, mode),
  },
  {
    id: "agent-avatar-map",
    order: 6,
    matches: (key: string) => key === "xiaban_agent_avatars",
    trim: (_key: string, value: string, mode: StorageTrimMode) =>
      trimAgentAvatarMapValue(value, mode),
  },
  {
    id: "user-avatar",
    order: 7,
    matches: (key: string) => key === "xiaban_user_avatar" || key === "userAvatar",
    trim: (_key: string, value: string, mode: StorageTrimMode) => trimUserAvatarValue(value, mode),
  },
  {
    id: "model-provider-status",
    order: 8,
    matches: (key: string) => key === "xiaban.modelProviderStatus",
    trim: (_key: string, value: string) => trimRuntimeStatusValue(value),
  },
  {
    id: "agent-model-access",
    order: 9,
    matches: (key: string) => key === "xiaban.agentModelAccess",
    trim: (_key: string, value: string) => trimAgentModelAccessValue(value),
  },
  {
    id: "model-providers",
    order: 10,
    matches: (key: string) => key === "xiaban.modelProviders",
    trim: (_key: string, value: string) => trimModelProvidersValue(value),
  },
].toSorted((left, right) => left.order - right.order);

function resolvePolicy(key: string) {
  return STORAGE_POLICIES.find((policy) => policy.matches(key)) ?? null;
}

function trimValueByPolicy(key: string, value: string, mode: StorageTrimMode) {
  const policy = resolvePolicy(key);
  if (!policy) {
    return value;
  }

  try {
    return policy.trim(key, value, mode);
  } catch (error) {
    warnStorage(`裁剪缓存失败: key=${key}`, error);
    return value;
  }
}

function applyStorageMutation(storage: Storage, key: string, value: string | null) {
  if (value === null) {
    storage.removeItem(key);
    return;
  }

  storage.setItem(key, value);
}

function trimStorageEntries(
  storage: Storage,
  mode: StorageTrimMode,
  targetBytes: number,
): StorageMaintenanceResult {
  const keys = readStorageKeys(storage);
  const changedKeys: string[] = [];
  const beforeTotalBytes = resolveTotalBytes(storage);

  for (const policy of STORAGE_POLICIES) {
    for (const key of keys) {
      if (!policy.matches(key)) {
        continue;
      }

      const currentValue = storage.getItem(key);
      if (typeof currentValue !== "string") {
        continue;
      }

      const nextValue = trimValueByPolicy(key, currentValue, mode);
      if (nextValue === currentValue) {
        continue;
      }

      applyStorageMutation(storage, key, nextValue);
      changedKeys.push(key);

      if (resolveTotalBytes(storage) <= targetBytes) {
        const totalBytes = resolveTotalBytes(storage);
        return {
          totalBytes,
          freedBytes: Math.max(0, beforeTotalBytes - totalBytes),
          changedKeys,
          changed: changedKeys.length > 0,
        };
      }
    }
  }

  const totalBytes = resolveTotalBytes(storage);
  return {
    totalBytes,
    freedBytes: Math.max(0, beforeTotalBytes - totalBytes),
    changedKeys,
    changed: changedKeys.length > 0,
  };
}

function runMaintenanceWithStorage(
  storage: Storage,
  reason: StorageReason,
  mode: StorageTrimMode,
): StorageMaintenanceResult {
  const targetBytes =
    mode === "normal"
      ? STORAGE_SAFE_TOTAL_BYTES
      : mode === "soft"
        ? STORAGE_SOFT_TARGET_BYTES
        : STORAGE_AGGRESSIVE_TARGET_BYTES;
  const result = trimStorageEntries(storage, mode, targetBytes);

  if (result.changed) {
    logStorage(
      `已执行缓存整理: reason=${reason}, mode=${mode}, freed=${result.freedBytes}, total=${result.totalBytes}`,
    );
  }

  return result;
}

function shouldRunPreflightCleanup(storage: Storage, key: string, value: string) {
  const existingValue = storage.getItem(key);
  const currentTotal = resolveTotalBytes(storage);
  const nextTotal =
    currentTotal -
    (typeof existingValue === "string" ? resolveEntrySize(key, existingValue) : 0) +
    resolveEntrySize(key, value);
  return nextTotal > STORAGE_SAFE_TOTAL_BYTES;
}

export function getStorageTotalBytes() {
  const storage = resolveStorage();
  if (!storage) {
    return 0;
  }

  try {
    return resolveTotalBytes(storage);
  } catch (error) {
    warnStorage("统计本地缓存大小失败", error);
    return 0;
  }
}

export function runStorageMaintenance(reason: StorageReason = "startup") {
  const storage = resolveStorage();
  if (!storage) {
    return {
      totalBytes: 0,
      freedBytes: 0,
      changedKeys: [],
      changed: false,
    } satisfies StorageMaintenanceResult;
  }

  try {
    const totalBefore = resolveTotalBytes(storage);
    if (reason === "startup" && totalBefore <= STORAGE_SAFE_TOTAL_BYTES) {
      return {
        totalBytes: totalBefore,
        freedBytes: 0,
        changedKeys: [],
        changed: false,
      };
    }

    const normalResult = runMaintenanceWithStorage(storage, reason, "normal");
    const softResult =
      normalResult.totalBytes > STORAGE_SAFE_TOTAL_BYTES
        ? runMaintenanceWithStorage(storage, reason, "soft")
        : { totalBytes: normalResult.totalBytes, freedBytes: 0, changedKeys: [], changed: false };
    const aggressiveResult =
      softResult.totalBytes > STORAGE_SOFT_TARGET_BYTES
        ? runMaintenanceWithStorage(storage, reason, "aggressive")
        : { totalBytes: softResult.totalBytes, freedBytes: 0, changedKeys: [], changed: false };
    const changedKeys = [
      ...normalResult.changedKeys,
      ...softResult.changedKeys,
      ...aggressiveResult.changedKeys,
    ];
    const result = {
      totalBytes: aggressiveResult.totalBytes,
      freedBytes: normalResult.freedBytes + softResult.freedBytes + aggressiveResult.freedBytes,
      changedKeys,
      changed: changedKeys.length > 0,
    } satisfies StorageMaintenanceResult;

    if (reason === "startup" && result.changed) {
      notifyStorageToast("cleaned");
    }

    return result;
  } catch (error) {
    warnStorage(`执行缓存整理失败: reason=${reason}`, error);
    return {
      totalBytes: 0,
      freedBytes: 0,
      changedKeys: [],
      changed: false,
    };
  }
}

export function readLocalStorageItem(key: string) {
  const storage = resolveStorage();
  if (!storage) {
    return null;
  }

  try {
    return storage.getItem(key);
  } catch (error) {
    warnStorage(`读取本地缓存失败: key=${key}`, error);
    return null;
  }
}

export function listLocalStorageKeys() {
  const storage = resolveStorage();
  if (!storage) {
    return [];
  }

  try {
    return readStorageKeys(storage);
  } catch (error) {
    warnStorage("读取本地缓存键列表失败", error);
    return [];
  }
}

export function writeLocalStorageItem(key: string, value: string, options?: { silent?: boolean }) {
  const storage = resolveStorage();
  if (!storage) {
    return false;
  }

  const normalizedValue = trimValueByPolicy(key, value, "normal");
  if (normalizedValue === null) {
    try {
      storage.removeItem(key);
      return true;
    } catch (error) {
      warnStorage(`删除本地缓存失败: key=${key}`, error);
      return false;
    }
  }

  try {
    if (shouldRunPreflightCleanup(storage, key, normalizedValue)) {
      runStorageMaintenance("preflight");
    }

    storage.setItem(key, normalizedValue);
    return true;
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      warnStorage(`写入本地缓存失败: key=${key}`, error);
      return false;
    }

    warnStorage(`检测到存储空间不足，开始自动清理: key=${key}`);

    for (const mode of ["soft", "aggressive"] as StorageTrimMode[]) {
      const retryValue = trimValueByPolicy(key, value, mode);
      const maintenanceResult = runMaintenanceWithStorage(storage, "quota", mode);
      if (retryValue === null) {
        try {
          storage.removeItem(key);
          if (maintenanceResult.changed && !options?.silent) {
            notifyStorageToast("cleaned");
          }
          return true;
        } catch (retryError) {
          warnStorage(`清理后删除缓存仍失败: key=${key}`, retryError);
        }
        continue;
      }

      try {
        storage.setItem(key, retryValue);
        if (maintenanceResult.changed && !options?.silent) {
          notifyStorageToast("cleaned");
        }
        return true;
      } catch (retryError) {
        if (!isQuotaExceededError(retryError)) {
          warnStorage(`清理后写入缓存失败: key=${key}`, retryError);
          return false;
        }
      }
    }

    if (!options?.silent) {
      notifyStorageToast("tight");
    }
    return false;
  }
}

export function removeLocalStorageItem(key: string) {
  const storage = resolveStorage();
  if (!storage) {
    return false;
  }

  try {
    storage.removeItem(key);
    return true;
  } catch (error) {
    warnStorage(`删除本地缓存失败: key=${key}`, error);
    return false;
  }
}

export function createSafeStorageAdapter() {
  const storage = resolveStorage();
  if (!storage) {
    return EMPTY_STORAGE;
  }

  return {
    getItem: (key: string) => readLocalStorageItem(key),
    setItem: (key: string, value: string) => {
      writeLocalStorageItem(key, value, { silent: true });
    },
    removeItem: (key: string) => {
      removeLocalStorageItem(key);
    },
    key: (index: number) => {
      try {
        return storage.key(index);
      } catch (error) {
        warnStorage(`读取本地缓存 key 失败: index=${index}`, error);
        return null;
      }
    },
    clear: () => {
      try {
        storage.clear();
      } catch (error) {
        warnStorage("清空本地缓存失败", error);
      }
    },
    get length() {
      try {
        return storage.length;
      } catch (error) {
        warnStorage("读取本地缓存长度失败", error);
        return 0;
      }
    },
  } satisfies Storage;
}
