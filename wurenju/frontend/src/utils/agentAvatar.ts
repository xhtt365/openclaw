import { storageApi } from "@/services/api";
import { readLocalStorageItem, writeLocalStorageItem } from "@/utils/storage";
import { ensureStorageApiAvailable, runStorageApiSync } from "@/utils/storageBackend";

export const AGENT_AVATAR_STORAGE_KEY = "xiaban_agent_avatars";

const EMOJI_AVATAR_PATTERN = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;

export type AgentAvatarInfo = {
  type: "image" | "emoji" | "letter";
  value: string;
};

export type AgentAvatarPersistenceResult =
  | {
      persistedTo: "remote";
    }
  | {
      persistedTo: "local";
      reason: "backend-unavailable" | "sync-failed";
    };

type AgentAvatarMap = Record<string, string>;

let cachedAgentAvatarMap: AgentAvatarMap | null = null;
let agentAvatarHydrationPromise: Promise<void> | null = null;

function isImageAvatar(value: string) {
  return (
    /^https?:\/\//iu.test(value) ||
    /^data:image\//iu.test(value) ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../")
  );
}

function readLocalAgentAvatarMap(): AgentAvatarMap {
  const raw = readLocalStorageItem(AGENT_AVATAR_STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as AgentAvatarMap) : {};
  } catch {
    return {};
  }
}

function writeLocalAgentAvatarMap(value: AgentAvatarMap) {
  writeLocalStorageItem(AGENT_AVATAR_STORAGE_KEY, JSON.stringify(value));
}

function dispatchAgentAvatarUpdated(detail: Record<string, unknown>) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("xiaban-agent-avatar-updated", {
      detail,
    }),
  );
}

function getCachedAgentAvatarMap() {
  const localMap = readLocalAgentAvatarMap();
  const currentMap = cachedAgentAvatarMap ?? {};
  const localKeys = Object.keys(localMap);
  const cachedKeys = Object.keys(currentMap);
  const changed =
    cachedAgentAvatarMap === null ||
    localKeys.length !== cachedKeys.length ||
    localKeys.some((key) => currentMap[key] !== localMap[key]);
  if (changed) {
    cachedAgentAvatarMap = localMap;
  }

  return cachedAgentAvatarMap ?? {};
}

async function hydrateAgentAvatarMapFromApi() {
  if (agentAvatarHydrationPromise) {
    return agentAvatarHydrationPromise;
  }

  agentAvatarHydrationPromise = (async () => {
    const localMap = getCachedAgentAvatarMap();
    const available = await ensureStorageApiAvailable();
    if (!available) {
      return;
    }

    const remoteMap = await storageApi.get<AgentAvatarMap>("agent-avatars");
    const hasRemoteData = Object.keys(remoteMap).length > 0;
    const hasLocalData = Object.keys(localMap).length > 0;

    if (!hasRemoteData && hasLocalData) {
      await storageApi.put("agent-avatars", {
        items: localMap,
      });
      return;
    }

    if (!hasRemoteData) {
      return;
    }

    cachedAgentAvatarMap = remoteMap;
    writeLocalAgentAvatarMap(remoteMap);
    dispatchAgentAvatarUpdated({});
  })()
    .catch((error) => {
      console.warn("[AgentAvatar] 从后端读取头像映射失败，继续使用本地缓存:", error);
    })
    .finally(() => {
      agentAvatarHydrationPromise = null;
    });

  return agentAvatarHydrationPromise;
}

async function persistAgentAvatarMap(value: AgentAvatarMap): Promise<AgentAvatarPersistenceResult> {
  const available = await ensureStorageApiAvailable(true);
  if (!available) {
    return {
      persistedTo: "local",
      reason: "backend-unavailable",
    };
  }

  const synced = await runStorageApiSync(async () => {
    await storageApi.put("agent-avatars", {
      items: value,
    });
  }, "同步智能体头像映射到后端");

  if (!synced) {
    return {
      persistedTo: "local",
      reason: "sync-failed",
    };
  }

  return {
    persistedTo: "remote",
  };
}

export function readAgentAvatarMap(): AgentAvatarMap {
  const avatarMap = getCachedAgentAvatarMap();
  void hydrateAgentAvatarMapFromApi();
  return avatarMap;
}

export async function saveAgentAvatarMapping(
  agentId: string,
  avatarSrc: string,
): Promise<AgentAvatarPersistenceResult> {
  const normalizedAgentId = agentId.trim();
  const normalizedAvatarSrc = avatarSrc.trim();
  if (!normalizedAgentId || !normalizedAvatarSrc) {
    return {
      persistedTo: "local",
      reason: "sync-failed",
    };
  }

  const avatarMap = { ...getCachedAgentAvatarMap() };
  const nextAvatarMap = Object.fromEntries(
    [
      ...Object.entries(avatarMap).filter(([agentId]) => agentId !== normalizedAgentId),
      [normalizedAgentId, normalizedAvatarSrc],
    ].filter(([agentId, avatar]) => agentId.trim() && avatar.trim()),
  );
  cachedAgentAvatarMap = nextAvatarMap;
  if (!writeLocalStorageItem(AGENT_AVATAR_STORAGE_KEY, JSON.stringify(nextAvatarMap))) {
    throw new Error("头像本地缓存失败，请稍后重试");
  }
  const persistence = await persistAgentAvatarMap(nextAvatarMap);

  dispatchAgentAvatarUpdated({
    agentId: normalizedAgentId,
    avatarSrc: normalizedAvatarSrc,
    persistedTo: persistence.persistedTo,
    reason: persistence.persistedTo === "local" ? persistence.reason : undefined,
  });

  return persistence;
}

export async function removeAgentAvatarMapping(
  agentId: string,
): Promise<AgentAvatarPersistenceResult> {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    return {
      persistedTo: "local",
      reason: "sync-failed",
    };
  }

  const avatarMap = { ...getCachedAgentAvatarMap() };
  if (!(normalizedAgentId in avatarMap)) {
    return {
      persistedTo: "remote",
    };
  }

  delete avatarMap[normalizedAgentId];
  cachedAgentAvatarMap = avatarMap;
  if (!writeLocalStorageItem(AGENT_AVATAR_STORAGE_KEY, JSON.stringify(avatarMap))) {
    throw new Error("头像本地缓存失败，请稍后重试");
  }
  const available = await ensureStorageApiAvailable(true);
  let persistence: AgentAvatarPersistenceResult = {
    persistedTo: "remote",
  };

  if (!available) {
    persistence = {
      persistedTo: "local",
      reason: "backend-unavailable",
    };
  } else {
    const synced = await runStorageApiSync(async () => {
      await storageApi.delete("agent-avatars", {
        agentId: normalizedAgentId,
      });
    }, "删除后端智能体头像映射");
    if (!synced) {
      persistence = {
        persistedTo: "local",
        reason: "sync-failed",
      };
    }
  }

  dispatchAgentAvatarUpdated({
    agentId: normalizedAgentId,
    removed: true,
    persistedTo: persistence.persistedTo,
    reason: persistence.persistedTo === "local" ? persistence.reason : undefined,
  });

  return persistence;
}

export function getAgentAvatarInfo(
  agentId: string,
  gatewayAvatar?: string | null,
  agentName?: string | null,
): AgentAvatarInfo {
  const normalizedAgentId = agentId.trim();
  const avatarMap = readAgentAvatarMap();
  const storedAvatar = normalizedAgentId ? avatarMap[normalizedAgentId]?.trim() : "";
  if (storedAvatar) {
    return { type: "image", value: storedAvatar };
  }

  const normalizedGatewayAvatar = gatewayAvatar?.trim() || "";
  if (normalizedGatewayAvatar) {
    if (isImageAvatar(normalizedGatewayAvatar)) {
      return { type: "image", value: normalizedGatewayAvatar };
    }

    if (EMOJI_AVATAR_PATTERN.test(normalizedGatewayAvatar)) {
      return { type: "emoji", value: normalizedGatewayAvatar };
    }

    return { type: "letter", value: normalizedGatewayAvatar.charAt(0).toUpperCase() };
  }

  const letter = agentName?.trim().charAt(0).toUpperCase() || "A";
  return { type: "letter", value: letter };
}
