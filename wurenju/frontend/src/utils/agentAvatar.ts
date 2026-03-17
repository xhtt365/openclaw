export const AGENT_AVATAR_STORAGE_KEY = "xiaban_agent_avatars";
const EMOJI_AVATAR_PATTERN = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;

export type AgentAvatarInfo = {
  type: "image" | "emoji" | "letter";
  value: string;
};

type AgentAvatarMap = Record<string, string>;

function getStorage() {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }

  if (typeof localStorage !== "undefined") {
    return localStorage;
  }

  return null;
}

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
  const storage = getStorage();
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(AGENT_AVATAR_STORAGE_KEY);
    if (!raw) {
      return {};
    }

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

  const storage = getStorage();
  if (!storage) {
    return;
  }

  const avatarMap = readAgentAvatarMap();
  avatarMap[normalizedAgentId] = normalizedAvatarSrc;
  storage.setItem(AGENT_AVATAR_STORAGE_KEY, JSON.stringify(avatarMap));

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
