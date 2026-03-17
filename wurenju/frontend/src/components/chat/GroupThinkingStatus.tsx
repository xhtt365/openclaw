import { AnimatePresence, motion } from "framer-motion";
import { memo, useMemo } from "react";
import { useAgentStore } from "@/stores/agentStore";
import type { AgentInfo, ThinkingAgent } from "@/stores/groupStore";

type GroupThinkingStatusProps = {
  members: AgentInfo[];
  thinkingAgents: ThinkingAgent[];
};

type ThinkingAgentDisplay = {
  id: string;
  name: string;
  avatarUrl?: string;
  avatarText: string;
  avatarColor: string;
};

const AVATAR_COLORS = [
  "var(--color-avatar-1)",
  "var(--color-avatar-2)",
  "var(--color-avatar-3)",
  "var(--color-avatar-4)",
  "var(--color-avatar-5)",
  "var(--color-avatar-6)",
] as const;

function hashText(value: string) {
  return Array.from(value).reduce((total, char) => total + char.charCodeAt(0), 0);
}

function getAvatarColor(value: string) {
  return AVATAR_COLORS[hashText(value) % AVATAR_COLORS.length];
}

function resolveAvatarText(name: string, emoji?: string) {
  return emoji?.trim() || name.trim().charAt(0).toUpperCase() || "#";
}

function GroupThinkingStatusInner({ members, thinkingAgents }: GroupThinkingStatusProps) {
  const agents = useAgentStore((state) => state.agents);

  const displayAgents = useMemo<ThinkingAgentDisplay[]>(() => {
    const agentMap = new Map(agents.map((agent) => [agent.id, agent]));
    const memberMap = new Map(members.map((member) => [member.id, member]));

    return thinkingAgents.map((thinkingAgent) => {
      const liveAgent = agentMap.get(thinkingAgent.id);
      const member = memberMap.get(thinkingAgent.id);
      const name = liveAgent?.name?.trim() || member?.name?.trim() || thinkingAgent.name;
      const avatarUrl = liveAgent?.avatarUrl?.trim() || member?.avatarUrl?.trim() || undefined;
      const emoji = liveAgent?.emoji?.trim() || member?.emoji?.trim() || undefined;

      return {
        id: thinkingAgent.id,
        name,
        avatarUrl,
        avatarText: resolveAvatarText(name, emoji),
        avatarColor: getAvatarColor(thinkingAgent.id || name),
      };
    });
  }, [agents, members, thinkingAgents]);

  const nameFragments = useMemo(
    () =>
      displayAgents.map((agent, index) => ({
        id: agent.id,
        label: `${index > 0 ? "、" : ""}${agent.name}`,
      })),
    [displayAgents],
  );

  return (
    <AnimatePresence initial={false}>
      {displayAgents.length > 0 ? (
        <motion.div
          key="group-thinking-status"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4, transition: { duration: 0.2 } }}
          className="flex justify-start"
        >
          <div className="group-thinking-pill text-xs">
            <div className="flex items-center -space-x-1">
              <AnimatePresence initial={false}>
                {displayAgents.map((agent) => (
                  <motion.div
                    key={agent.id}
                    layout
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0, transition: { duration: 0.15 } }}
                    className="relative"
                  >
                    {agent.avatarUrl ? (
                      <img
                        src={agent.avatarUrl}
                        alt={agent.name}
                        className="h-5 w-5 rounded-full border border-[var(--border)] object-cover"
                      />
                    ) : (
                      <span
                        className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border)] text-[10px] font-semibold text-[var(--accent-foreground)]"
                        style={{ backgroundColor: agent.avatarColor }}
                      >
                        {agent.avatarText}
                      </span>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />

            <span className="inline-flex items-center whitespace-pre-wrap">
              <AnimatePresence initial={false}>
                {nameFragments.map((fragment) => (
                  <motion.span
                    key={fragment.id}
                    layout
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0, transition: { duration: 0.15 } }}
                  >
                    {fragment.label}
                  </motion.span>
                ))}
              </AnimatePresence>
              <motion.span layout>思考中…</motion.span>
            </span>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export const GroupThinkingStatus = memo(GroupThinkingStatusInner);
GroupThinkingStatus.displayName = "GroupThinkingStatus";
