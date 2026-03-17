import { type Agent } from "@/stores/agentStore";
import {
  useGroupStore,
  type AgentInfo,
  type Group,
  type GroupArchive,
  type GroupChatMessage,
} from "@/stores/groupStore";
import { getAgentAvatarInfo } from "@/utils/agentAvatar";
import { writeGroupStorageSnapshot } from "@/utils/groupPersistence";

export const HUMAN_MEMBER_LABEL = "You";

type GroupPersistenceSnapshot = {
  groups: Group[];
  selectedGroupId: string | null;
  selectedArchiveId: string | null;
  messagesByGroupId: Record<string, GroupChatMessage[]>;
  archives: GroupArchive[];
};

export type GroupMemberMutationReason =
  | "already_joined"
  | "group_not_found"
  | "leader_locked"
  | "member_not_found";

export type GroupMemberMutationResult = {
  group: Group | null;
  changed: boolean;
  reason?: GroupMemberMutationReason;
};

function resolveManagedMemberAvatarUrl(agent: Pick<Agent, "id" | "name" | "emoji" | "avatarUrl">) {
  const avatarInfo = getAgentAvatarInfo(agent.id, agent.avatarUrl ?? agent.emoji, agent.name);
  return avatarInfo.type === "image" ? avatarInfo.value : undefined;
}

export function toManagedGroupMember(
  agent: Pick<Agent, "id" | "name" | "emoji" | "avatarUrl" | "role">,
): AgentInfo {
  return {
    id: agent.id.trim(),
    name: agent.name.trim() || agent.id.trim(),
    emoji: agent.emoji?.trim() || undefined,
    // 群成员统一复用左栏同一套头像解析，避免本地头像映射在群聊入口丢失。
    avatarUrl: resolveManagedMemberAvatarUrl(agent),
    role: agent.role?.trim() || undefined,
  };
}

export function normalizeManagedMembers(members: AgentInfo[]) {
  const uniqueMembers = new Map<string, AgentInfo>();

  members.forEach((member) => {
    const memberId = member.id.trim();
    if (!memberId) {
      return;
    }

    uniqueMembers.set(memberId, {
      id: memberId,
      name: member.name.trim() || memberId,
      emoji: member.emoji?.trim() || undefined,
      avatarUrl: member.avatarUrl?.trim() || undefined,
      role: member.role?.trim() || undefined,
    });
  });

  return Array.from(uniqueMembers.values());
}

export function getGroupDisplayMemberCount(group: Group) {
  return group.members.length + 1;
}

export function getAvailableGroupAgents(group: Group, agents: Agent[]) {
  const joinedMemberIds = new Set(group.members.map((member) => member.id));
  return agents.filter((agent) => {
    const agentId = agent.id.trim();
    return agentId.length > 0 && !joinedMemberIds.has(agentId);
  });
}

export function resolveDisplayAgentMembers(group: Group, agents: Agent[]) {
  const liveAgentMap = new Map(agents.map((agent) => [agent.id, agent]));

  return normalizeManagedMembers(
    group.members.map((member) => {
      const liveAgent = liveAgentMap.get(member.id);
      if (!liveAgent) {
        return member;
      }

      return {
        id: member.id,
        name: liveAgent.name.trim() || member.name,
        emoji: liveAgent.emoji?.trim() || member.emoji,
        avatarUrl: resolveManagedMemberAvatarUrl(liveAgent) ?? member.avatarUrl,
        role: liveAgent.role?.trim() || member.role,
      };
    }),
  );
}

function areMembersEqual(left: AgentInfo[], right: AgentInfo[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((member, index) => {
    const rightMember = right[index];
    return (
      member.id === rightMember?.id &&
      member.name === rightMember?.name &&
      member.emoji === rightMember?.emoji &&
      member.avatarUrl === rightMember?.avatarUrl &&
      member.role === rightMember?.role
    );
  });
}

function createPersistenceSnapshot(groups: Group[]): GroupPersistenceSnapshot {
  const state = useGroupStore.getState();
  return {
    groups,
    selectedGroupId: state.selectedGroupId,
    selectedArchiveId: state.selectedArchiveId,
    messagesByGroupId: state.messagesByGroupId,
    archives: state.archives,
  };
}

function persistSnapshot(snapshot: GroupPersistenceSnapshot) {
  if (typeof window === "undefined") {
    return true;
  }

  return writeGroupStorageSnapshot(snapshot, "写入项目组成员缓存失败");
}

function commitGroupMembers(groupId: string, nextMembers: AgentInfo[]) {
  const state = useGroupStore.getState();
  const targetGroup = state.groups.find((group) => group.id === groupId) ?? null;
  if (!targetGroup) {
    return null;
  }

  const normalizedMembers = normalizeManagedMembers(nextMembers);
  if (areMembersEqual(targetGroup.members, normalizedMembers)) {
    return targetGroup;
  }

  const nextGroups = state.groups.map((group) =>
    group.id === groupId
      ? {
          ...group,
          members: normalizedMembers,
        }
      : group,
  );

  if (!persistSnapshot(createPersistenceSnapshot(nextGroups))) {
    return targetGroup;
  }

  // 这里不能改 groupStore，本工具负责把外层成员变更同步回同一份持久化快照。
  useGroupStore.setState({
    groups: nextGroups,
  });

  return nextGroups.find((group) => group.id === groupId) ?? null;
}

export function addAgentToGroup(groupId: string, agent: Agent): GroupMemberMutationResult {
  const state = useGroupStore.getState();
  const targetGroup = state.groups.find((group) => group.id === groupId) ?? null;
  if (!targetGroup) {
    console.error(`[Member] 添加成员失败: 找不到项目组 ${groupId}`);
    return {
      group: null,
      changed: false,
      reason: "group_not_found",
    };
  }

  if (targetGroup.members.some((member) => member.id === agent.id.trim())) {
    console.log(`[Member] 跳过重复成员: ${targetGroup.name} <- ${agent.name}`);
    return {
      group: targetGroup,
      changed: false,
      reason: "already_joined",
    };
  }

  const nextGroup = commitGroupMembers(groupId, [
    ...targetGroup.members,
    toManagedGroupMember(agent),
  ]);
  if (!nextGroup) {
    return {
      group: null,
      changed: false,
      reason: "group_not_found",
    };
  }

  if (areMembersEqual(targetGroup.members, nextGroup.members)) {
    return {
      group: targetGroup,
      changed: false,
    };
  }

  console.log(`[Member] 添加成员成功: ${targetGroup.name} <- ${agent.name}`);
  return {
    group: nextGroup,
    changed: true,
  };
}

export function removeAgentFromGroup(groupId: string, memberId: string): GroupMemberMutationResult {
  const state = useGroupStore.getState();
  const targetGroup = state.groups.find((group) => group.id === groupId) ?? null;
  if (!targetGroup) {
    console.error(`[Member] 移除成员失败: 找不到项目组 ${groupId}`);
    return {
      group: null,
      changed: false,
      reason: "group_not_found",
    };
  }

  const targetMember = targetGroup.members.find((member) => member.id === memberId) ?? null;
  if (!targetMember) {
    console.log(`[Member] 跳过不存在的成员: ${targetGroup.name} - ${memberId}`);
    return {
      group: targetGroup,
      changed: false,
      reason: "member_not_found",
    };
  }

  if (targetGroup.leaderId === memberId) {
    console.log(`[Member] 阻止移除群主: ${targetGroup.name} - ${targetMember.name}`);
    return {
      group: targetGroup,
      changed: false,
      reason: "leader_locked",
    };
  }

  const nextGroup = commitGroupMembers(
    groupId,
    targetGroup.members.filter((member) => member.id !== memberId),
  );
  if (!nextGroup) {
    return {
      group: null,
      changed: false,
      reason: "group_not_found",
    };
  }

  if (areMembersEqual(targetGroup.members, nextGroup.members)) {
    return {
      group: targetGroup,
      changed: false,
    };
  }

  useGroupStore.getState().handleMemberRemoved(groupId, targetMember);

  console.log(`[Member] 移除成员成功: ${targetGroup.name} - ${targetMember.name}`);
  return {
    group: nextGroup,
    changed: true,
  };
}
