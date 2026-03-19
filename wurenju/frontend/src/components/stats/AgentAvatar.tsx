"use client";

import { useEffect, useState } from "react";
import type { Agent } from "@/stores/agentStore";
import { getAgentAvatarInfo } from "@/utils/agentAvatar";

type AgentAvatarProps = {
  agent: Agent;
  className?: string;
  textClassName?: string;
};

export function AgentAvatar({ agent, className, textClassName }: AgentAvatarProps) {
  const [, setVersion] = useState(0);

  useEffect(() => {
    function handleRefresh() {
      setVersion((current) => current + 1);
    }

    window.addEventListener("xiaban-agent-avatar-updated", handleRefresh);
    return () => {
      window.removeEventListener("xiaban-agent-avatar-updated", handleRefresh);
    };
  }, []);

  const avatarInfo = getAgentAvatarInfo(
    agent.id,
    agent.avatarUrl ?? agent.emoji ?? agent.name.charAt(0),
    agent.name,
  );

  if (avatarInfo.type === "image") {
    return (
      <img
        alt={agent.name}
        src={avatarInfo.value}
        className={className ?? "h-10 w-10 rounded-2xl object-cover"}
      />
    );
  }

  return (
    <div
      className={
        className ??
        "flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)]"
      }
    >
      <span className={textClassName ?? "text-lg"}>{avatarInfo.value}</span>
    </div>
  );
}
