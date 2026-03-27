import { readLocalStorageItem } from "@/utils/storage";

export const STORAGE_USER_ID_KEY = "xiaban.storage.userId";
export const SHARED_STORAGE_USER_ID = "self";

export function getStorageUserId() {
  return SHARED_STORAGE_USER_ID;
}

export function getLegacyStorageUserId() {
  const stored = readLocalStorageItem(STORAGE_USER_ID_KEY)?.trim() || "";
  return stored || null;
}
