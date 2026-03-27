import { storageApi } from "@/services/api";
import {
  readLocalStorageItem,
  removeLocalStorageItem,
  writeLocalStorageItem,
} from "@/utils/storage";
import { ensureStorageApiAvailable, scheduleStorageApiSync } from "@/utils/storageBackend";
import { getStorageUserId } from "@/utils/storageUser";

export const USER_AVATAR_STORAGE_KEY = "xiaban_user_avatar";
export const USER_NAME_STORAGE_KEY = "xiaban_user_name";

const LEGACY_USER_AVATAR_STORAGE_KEY = "userAvatar";
const USER_PROFILE_EVENT = "xiaban:user-profile-change";
const MAX_USER_NAME_LENGTH = 20;

let cachedUserProfile: UserProfile | null = null;
let userProfileHydrationPromise: Promise<void> | null = null;

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

function writeLocalUserProfile(profile: UserProfile) {
  writeStorageValue(USER_AVATAR_STORAGE_KEY, profile.avatar);
  writeStorageValue(USER_NAME_STORAGE_KEY, profile.name);
}

function readStorageValue(key: string) {
  if (!canUseStorage()) {
    return null;
  }

  return readLocalStorageItem(key);
}

function writeStorageValue(key: string, value: string | null) {
  if (!canUseStorage()) {
    return;
  }

  if (value === null) {
    removeLocalStorageItem(key);
    return;
  }

  writeLocalStorageItem(key, value);
}

function migrateLegacyAvatar() {
  const legacyAvatar = normalizeAvatar(readStorageValue(LEGACY_USER_AVATAR_STORAGE_KEY));
  if (!legacyAvatar) {
    return null;
  }

  writeStorageValue(USER_AVATAR_STORAGE_KEY, legacyAvatar);
  return legacyAvatar;
}

function readLocalUserProfile(): UserProfile {
  const storedAvatar = normalizeAvatar(readStorageValue(USER_AVATAR_STORAGE_KEY));
  const storedName = normalizeName(readStorageValue(USER_NAME_STORAGE_KEY));

  return {
    avatar: storedAvatar ?? migrateLegacyAvatar(),
    name: storedName,
  };
}

function getCachedUserProfile() {
  const localProfile = readLocalUserProfile();
  if (
    !cachedUserProfile ||
    cachedUserProfile.avatar !== localProfile.avatar ||
    cachedUserProfile.name !== localProfile.name
  ) {
    cachedUserProfile = localProfile;
  }

  return cachedUserProfile;
}

async function hydrateUserProfileFromApi() {
  if (userProfileHydrationPromise) {
    return userProfileHydrationPromise;
  }

  userProfileHydrationPromise = (async () => {
    const localProfile = getCachedUserProfile();
    const available = await ensureStorageApiAvailable();
    if (!available) {
      return;
    }

    const userId = getStorageUserId();
    const remote = await storageApi.get<{
      userId: string;
      name: string | null;
      avatar: string | null;
    }>("user-profile", { userId });
    const remoteProfile: UserProfile = {
      avatar: normalizeAvatar(remote.avatar),
      name: normalizeName(remote.name),
    };

    if (!remoteProfile.avatar && !remoteProfile.name) {
      if (localProfile.avatar || localProfile.name) {
        await storageApi.put("user-profile", {
          userId,
          ...localProfile,
        });
      }
      return;
    }

    if (remoteProfile.avatar === localProfile.avatar && remoteProfile.name === localProfile.name) {
      return;
    }

    cachedUserProfile = remoteProfile;
    writeLocalUserProfile(remoteProfile);
    dispatchUserProfileChange();
  })()
    .catch((error) => {
      console.warn("[UserProfile] 从后端读取用户资料失败，继续使用本地缓存:", error);
    })
    .finally(() => {
      userProfileHydrationPromise = null;
    });

  return userProfileHydrationPromise;
}

function persistUserProfileInBackground(profile: UserProfile) {
  scheduleStorageApiSync(async () => {
    await storageApi.put("user-profile", {
      userId: getStorageUserId(),
      ...profile,
    });
  }, "同步用户资料到后端");
}

export function getUserProfile(): UserProfile {
  const profile = getCachedUserProfile();
  void hydrateUserProfileFromApi();
  return profile;
}

export function saveUserAvatar(avatar: string | null | undefined) {
  const normalizedAvatar = normalizeAvatar(avatar);
  const nextProfile = {
    ...getCachedUserProfile(),
    avatar: normalizedAvatar,
  };
  cachedUserProfile = nextProfile;
  writeLocalUserProfile(nextProfile);
  persistUserProfileInBackground(nextProfile);
  dispatchUserProfileChange();
  return normalizedAvatar;
}

export function saveUserName(name: string | null | undefined) {
  const normalizedName = normalizeName(name);
  const nextProfile = {
    ...getCachedUserProfile(),
    name: normalizedName,
  };
  cachedUserProfile = nextProfile;
  writeLocalUserProfile(nextProfile);
  persistUserProfileInBackground(nextProfile);
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

  void hydrateUserProfileFromApi().then(notify);

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
