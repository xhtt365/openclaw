import { storageApi } from "@/services/api";

type StorageApiStatus = "unknown" | "available" | "unavailable";
type StorageSyncOptions = {
  attempts?: number;
  retryDelayMs?: number;
};

const STORAGE_API_RETRY_MS = 30_000;
const STORAGE_SYNC_ATTEMPTS = 3;
const STORAGE_SYNC_RETRY_DELAY_MS = 1_000;

let storageApiStatus: StorageApiStatus = "unknown";
let storageApiCheckedAt = 0;
let storageApiPromise: Promise<boolean> | null = null;

function setStorageApiStatus(status: StorageApiStatus) {
  storageApiStatus = status;
  storageApiCheckedAt = Date.now();
}

export function getStorageApiStatus() {
  return storageApiStatus;
}

export async function ensureStorageApiAvailable(force = false) {
  const now = Date.now();
  if (!force && storageApiStatus === "available") {
    return true;
  }

  if (
    !force &&
    storageApiStatus === "unavailable" &&
    now - storageApiCheckedAt < STORAGE_API_RETRY_MS
  ) {
    return false;
  }

  if (storageApiPromise) {
    return storageApiPromise;
  }

  storageApiPromise = storageApi
    .health({
      timeoutMs: 1_500,
    })
    .then(() => {
      setStorageApiStatus("available");
      return true;
    })
    .catch((error) => {
      console.warn("[StorageAPI] 后端不可用，继续回退到 localStorage:", error);
      setStorageApiStatus("unavailable");
      return false;
    })
    .finally(() => {
      storageApiPromise = null;
    });

  return storageApiPromise;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

export async function runStorageApiSync(
  task: () => Promise<void>,
  label: string,
  options: StorageSyncOptions = {},
) {
  const attempts = Math.max(1, Math.floor(options.attempts ?? STORAGE_SYNC_ATTEMPTS));
  const retryDelayMs = Math.max(0, Math.floor(options.retryDelayMs ?? STORAGE_SYNC_RETRY_DELAY_MS));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const available = await ensureStorageApiAvailable(attempt > 1);
    if (!available) {
      if (attempt < attempts && retryDelayMs > 0) {
        await delay(retryDelayMs);
      }
      continue;
    }

    try {
      await task();
      setStorageApiStatus("available");
      return true;
    } catch (error) {
      setStorageApiStatus("unavailable");
      if (attempt >= attempts) {
        console.warn(`[StorageAPI] ${label} 失败，保留 localStorage 回退:`, error);
        return false;
      }

      console.warn(`[StorageAPI] ${label} 第 ${attempt}/${attempts} 次失败，准备重试:`, error);
      if (retryDelayMs > 0) {
        await delay(retryDelayMs);
      }
    }
  }

  return false;
}

export function scheduleStorageApiSync(
  task: () => Promise<void>,
  label: string,
  options?: StorageSyncOptions,
) {
  void runStorageApiSync(task, label, options);
}
