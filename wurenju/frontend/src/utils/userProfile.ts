export const USER_AVATAR_STORAGE_KEY = "xiaban_user_avatar";
export const USER_NAME_STORAGE_KEY = "xiaban_user_name";

const LEGACY_USER_AVATAR_STORAGE_KEY = "userAvatar";
const USER_PROFILE_EVENT = "xiaban:user-profile-change";
const MAX_USER_NAME_LENGTH = 20;

export type UserProfile = {
  avatar: string | null;
  name: string | null;
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeAvatar(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeName(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().slice(0, MAX_USER_NAME_LENGTH);
  return trimmed ? trimmed : null;
}

function dispatchUserProfileChange() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(USER_PROFILE_EVENT));
}

function readStorageValue(key: string) {
  if (!canUseStorage()) {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.error(`[UserProfile] 读取 ${key} 失败:`, error);
    return null;
  }
}

function writeStorageValue(key: string, value: string | null) {
  if (!canUseStorage()) {
    return;
  }

  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch (error) {
    console.error(`[UserProfile] 写入 ${key} 失败:`, error);
  }
}

function migrateLegacyAvatar() {
  const legacyAvatar = normalizeAvatar(readStorageValue(LEGACY_USER_AVATAR_STORAGE_KEY));
  if (!legacyAvatar) {
    return null;
  }

  writeStorageValue(USER_AVATAR_STORAGE_KEY, legacyAvatar);
  return legacyAvatar;
}

export function getUserProfile(): UserProfile {
  const storedAvatar = normalizeAvatar(readStorageValue(USER_AVATAR_STORAGE_KEY));
  const storedName = normalizeName(readStorageValue(USER_NAME_STORAGE_KEY));

  return {
    avatar: storedAvatar ?? migrateLegacyAvatar(),
    name: storedName,
  };
}

export function saveUserAvatar(avatar: string | null | undefined) {
  const normalizedAvatar = normalizeAvatar(avatar);
  writeStorageValue(USER_AVATAR_STORAGE_KEY, normalizedAvatar);
  dispatchUserProfileChange();
  return normalizedAvatar;
}

export function saveUserName(name: string | null | undefined) {
  const normalizedName = normalizeName(name);
  writeStorageValue(USER_NAME_STORAGE_KEY, normalizedName);
  dispatchUserProfileChange();
  return normalizedName;
}

export function subscribeToUserProfile(callback: (profile: UserProfile) => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const notify = () => {
    callback(getUserProfile());
  };

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key &&
      event.key !== USER_AVATAR_STORAGE_KEY &&
      event.key !== USER_NAME_STORAGE_KEY &&
      event.key !== LEGACY_USER_AVATAR_STORAGE_KEY
    ) {
      return;
    }
    notify();
  };

  window.addEventListener(USER_PROFILE_EVENT, notify);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(USER_PROFILE_EVENT, notify);
    window.removeEventListener("storage", handleStorage);
  };
}

export function getUserDisplayName(profile: UserProfile, fallback = "你") {
  return profile.name ?? fallback;
}

export function getUserInitial(profile: UserProfile, fallback = "你") {
  const source = profile.name ?? fallback;
  const firstCharacter = source.trim().charAt(0);
  return firstCharacter ? firstCharacter.toUpperCase() : "你";
}
