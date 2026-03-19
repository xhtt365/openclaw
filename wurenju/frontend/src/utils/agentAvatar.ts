import { readLocalStorageItem, writeLocalStorageItem } from "@/utils/storage";

export const AGENT_AVATAR_STORAGE_KEY = "xiaban_agent_avatars";

const EMOJI_AVATAR_PATTERN = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;

export type AgentAvatarInfo = {
  type: "image" | "emoji" | "letter";
  value: string;
};

type AgentAvatarMap = Record<string, string>;

function isImageAvatar(value: string) {
  return (
    /^https?:\/\//iu.test(value) ||
    /^data:image\//iu.test(value) ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../")
  );
}

export function readAgentAvatarMap(): AgentAvatarMap {
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

export function saveAgentAvatarMapping(agentId: string, avatarSrc: string) {
  const normalizedAgentId = agentId.trim();
  const normalizedAvatarSrc = avatarSrc.trim();
  if (!normalizedAgentId || !normalizedAvatarSrc) {
    return;
  }

  const avatarMap = readAgentAvatarMap();
  const nextAvatarMap = Object.fromEntries(
    [
      ...Object.entries(avatarMap).filter(([agentId]) => agentId !== normalizedAgentId),
      [normalizedAgentId, normalizedAvatarSrc],
    ].filter(([agentId, avatar]) => agentId.trim() && avatar.trim()),
  );
  if (!writeLocalStorageItem(AGENT_AVATAR_STORAGE_KEY, JSON.stringify(nextAvatarMap))) {
    return;
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("xiaban-agent-avatar-updated", {
        detail: {
          agentId: normalizedAgentId,
          avatarSrc: normalizedAvatarSrc,
        },
      }),
    );
  }
}

export function removeAgentAvatarMapping(agentId: string) {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    return;
  }

  const avatarMap = readAgentAvatarMap();
  if (!(normalizedAgentId in avatarMap)) {
    return;
  }

  delete avatarMap[normalizedAgentId];
  if (!writeLocalStorageItem(AGENT_AVATAR_STORAGE_KEY, JSON.stringify(avatarMap))) {
    return;
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("xiaban-agent-avatar-updated", {
        detail: {
          agentId: normalizedAgentId,
          removed: true,
        },
      }),
    );
  }
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
