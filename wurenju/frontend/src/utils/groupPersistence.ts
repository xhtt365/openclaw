import { writeLocalStorageItem } from "@/utils/storage";

export const GROUP_STORAGE_KEY = "wurenju.groups.v1";

export function reportGroupStorageWriteError(error: unknown, context: string) {
  console.error(`[Group] ${context}:`, error);
}

export function writeGroupStorageSnapshot(snapshot: unknown, context: string) {
  if (typeof window === "undefined") {
    return true;
  }

  try {
    return writeLocalStorageItem(GROUP_STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    reportGroupStorageWriteError(error, context);
    return false;
  }
}
