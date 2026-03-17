// 复制自 openclaw 3.13 原版 ui/src/ui/views/agents-utils.ts 的聊天相关函数，用于二开定制

const AVATAR_URL_RE = /^(https?:\/\/|data:image\/|\/)/i;

export function resolveAgentAvatarUrl(
  agent: { identity?: { avatar?: string; avatarUrl?: string } },
  agentIdentity?: { avatar?: string | null } | null,
): string | null {
  const url =
    agentIdentity?.avatar?.trim() ??
    agent.identity?.avatarUrl?.trim() ??
    agent.identity?.avatar?.trim();
  if (!url) {
    return null;
  }
  if (AVATAR_URL_RE.test(url)) {
    return url;
  }
  return null;
}

export function agentLogoUrl(basePath: string): string {
  const base = basePath?.trim() ? basePath.replace(/\/$/, "") : "";
  return base ? `${base}/favicon.svg` : "/favicon.svg";
}
