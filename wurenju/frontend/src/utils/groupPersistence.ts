import { storageApi } from "@/services/api";
import { readLocalStorageItem, writeLocalStorageItem } from "@/utils/storage";
import { ensureStorageApiAvailable, runStorageApiSync } from "@/utils/storageBackend";
import { getStorageUserId } from "@/utils/storageUser";

export const GROUP_STORAGE_KEY = "wurenju.groups.v1";

let cachedGroupSnapshot: unknown | null = null;
let groupSnapshotHydrationPromise: Promise<unknown | null> | null = null;
let pendingGroupSnapshotSync: {
  snapshot: unknown;
  context: string;
} | null = null;
let groupSnapshotSyncPromise: Promise<boolean> | null = null;
let didRegisterGroupSnapshotFlushHandlers = false;

export function reportGroupStorageWriteError(error: unknown, context: string) {
  console.error(`[Group] ${context}:`, error);
}

function parseLocalGroupSnapshot() {
  const raw = readLocalStorageItem(GROUP_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function getCachedGroupSnapshot() {
  const localSnapshot = parseLocalGroupSnapshot();
  if (JSON.stringify(cachedGroupSnapshot) !== JSON.stringify(localSnapshot)) {
    cachedGroupSnapshot = localSnapshot;
  }

  return cachedGroupSnapshot;
}

function writeLocalGroupSnapshot(snapshot: unknown) {
  cachedGroupSnapshot = snapshot;
  return writeLocalStorageItem(GROUP_STORAGE_KEY, JSON.stringify(snapshot));
}

function registerGroupSnapshotFlushHandlers() {
  if (didRegisterGroupSnapshotFlushHandlers || typeof window === "undefined") {
    return;
  }

  const flushPending = () => {
    void flushPendingGroupSnapshotSync();
  };
  const handleVisibilityChange = () => {
    if (typeof document !== "undefined" && document.hidden) {
      flushPending();
    }
  };

  window.addEventListener("pagehide", flushPending);
  window.addEventListener("beforeunload", flushPending);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }
  didRegisterGroupSnapshotFlushHandlers = true;
}

export function readGroupStorageSnapshot() {
  const snapshot = getCachedGroupSnapshot();
  void hydrateGroupStorageSnapshot();
  return snapshot;
}

export async function hydrateGroupStorageSnapshot() {
  if (groupSnapshotHydrationPromise) {
    return groupSnapshotHydrationPromise;
  }

  groupSnapshotHydrationPromise = (async () => {
    const localSnapshot = getCachedGroupSnapshot();
    const available = await ensureStorageApiAvailable();
    if (!available) {
      return localSnapshot;
    }

    const remote = await storageApi.get<{
      userId: string;
      snapshot: unknown;
      source: "settings" | "derived" | "empty" | "legacy-migrated";
    }>("groups", {
      userId: getStorageUserId(),
    });

    if (remote.source === "empty" && localSnapshot) {
      await storageApi.put("groups", {
        userId: getStorageUserId(),
        snapshot: localSnapshot,
        migratedFromLocal: true,
      });
      return localSnapshot;
    }

    if (remote.snapshot) {
      cachedGroupSnapshot = remote.snapshot;
      writeLocalGroupSnapshot(remote.snapshot);
      return remote.snapshot;
    }

    return localSnapshot;
  })()
    .catch((error) => {
      console.warn("[Group] 从后端读取群聊持久化失败，继续使用本地缓存:", error);
      return getCachedGroupSnapshot();
    })
    .finally(() => {
      groupSnapshotHydrationPromise = null;
    });

  return groupSnapshotHydrationPromise;
}

export async function flushPendingGroupSnapshotSync() {
  if (groupSnapshotSyncPromise) {
    return groupSnapshotSyncPromise;
  }

  groupSnapshotSyncPromise = (async () => {
    let synced = true;
    while (pendingGroupSnapshotSync) {
      const nextPending = pendingGroupSnapshotSync;
      pendingGroupSnapshotSync = null;
      const currentSynced = await runStorageApiSync(async () => {
        await storageApi.put("groups", {
          userId: getStorageUserId(),
          snapshot: nextPending.snapshot,
        });
      }, nextPending.context);
      synced = synced && currentSynced;
    }

    return synced;
  })().finally(() => {
    groupSnapshotSyncPromise = null;
  });

  return groupSnapshotSyncPromise;
}

function scheduleGroupSnapshotSync(snapshot: unknown, context: string) {
  pendingGroupSnapshotSync = {
    snapshot,
    context,
  };
  registerGroupSnapshotFlushHandlers();
  void flushPendingGroupSnapshotSync();
}

export function writeGroupStorageSnapshot(snapshot: unknown, context: string) {
  if (typeof window === "undefined") {
    return true;
  }

  try {
    const saved = writeLocalGroupSnapshot(snapshot);
    if (!saved) {
      return false;
    }

    scheduleGroupSnapshotSync(snapshot, context);
    return true;
  } catch (error) {
    reportGroupStorageWriteError(error, context);
    return false;
  }
}
