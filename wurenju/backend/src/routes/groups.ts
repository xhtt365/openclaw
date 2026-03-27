import { Router } from "express";
import {
  db,
  getGroupWithMembers,
  listGroupsWithMembers,
  nowIso,
  runTransaction,
  type GroupMemberRow,
  type GroupRow,
} from "../db";
import { ApiError } from "../errors";
import {
  asBooleanInteger,
  asOptionalInteger,
  asOptionalText,
  asRequiredText,
  isRecord,
  readRouteParam,
  requireRecord,
} from "../utils";

type GroupMutationParams = {
  id: string;
  name: string | null;
  icon: string | null;
  description: string | null;
  owner_agent_id: string | null;
  announcement: string | null;
  announcement_version: number;
  urge_enabled: number;
  urge_paused: number;
  urge_interval: number | null;
  urge_count: number;
  urge_no_response_count: number;
  urge_last_checked_at: string | null;
  last_urge_at: string | null;
  urge_stop_reason: string | null;
  max_rounds: number;
  created_at: string;
  updated_at: string;
};

type GroupMemberMutationParams = {
  group_id: string;
  agent_id: string;
  role: string;
  created_at: string;
  updated_at: string;
};

const router = Router();

const getGroupRowStmt = db.prepare<{ id: string }, GroupRow>(`
  SELECT
    id,
    name,
    icon,
    description,
    owner_agent_id,
    announcement,
    announcement_version,
    urge_enabled,
    urge_paused,
    urge_interval,
    urge_count,
    urge_no_response_count,
    urge_last_checked_at,
    last_urge_at,
    urge_stop_reason,
    max_rounds,
    created_at,
    updated_at
  FROM groups
  WHERE id = @id
`);

const insertGroupStmt = db.prepare<GroupMutationParams>(`
  INSERT INTO groups (
    id,
    name,
    icon,
    description,
    owner_agent_id,
    announcement,
    announcement_version,
    urge_enabled,
    urge_paused,
    urge_interval,
    urge_count,
    urge_no_response_count,
    urge_last_checked_at,
    last_urge_at,
    urge_stop_reason,
    max_rounds,
    created_at,
    updated_at
  ) VALUES (
    @id,
    @name,
    @icon,
    @description,
    @owner_agent_id,
    @announcement,
    @announcement_version,
    @urge_enabled,
    @urge_paused,
    @urge_interval,
    @urge_count,
    @urge_no_response_count,
    @urge_last_checked_at,
    @last_urge_at,
    @urge_stop_reason,
    @max_rounds,
    @created_at,
    @updated_at
  )
`);

const updateGroupStmt = db.prepare<GroupMutationParams>(`
  UPDATE groups
  SET
    name = @name,
    icon = @icon,
    description = @description,
    owner_agent_id = @owner_agent_id,
    announcement = @announcement,
    announcement_version = @announcement_version,
    urge_enabled = @urge_enabled,
    urge_paused = @urge_paused,
    urge_interval = @urge_interval,
    urge_count = @urge_count,
    urge_no_response_count = @urge_no_response_count,
    urge_last_checked_at = @urge_last_checked_at,
    last_urge_at = @last_urge_at,
    urge_stop_reason = @urge_stop_reason,
    max_rounds = @max_rounds,
    updated_at = @updated_at
  WHERE id = @id
`);

const deleteGroupStmt = db.prepare<{ id: string }>(`
  DELETE FROM groups
  WHERE id = @id
`);

const getGroupMemberStmt = db.prepare<{ group_id: string; agent_id: string }, GroupMemberRow>(`
  SELECT
    group_id,
    agent_id,
    role,
    created_at,
    updated_at
  FROM group_members
  WHERE group_id = @group_id AND agent_id = @agent_id
`);

const listGroupMembersStmt = db.prepare<{ group_id: string }, GroupMemberRow>(`
  SELECT
    group_id,
    agent_id,
    role,
    created_at,
    updated_at
  FROM group_members
  WHERE group_id = @group_id
`);

const upsertGroupMemberStmt = db.prepare<GroupMemberMutationParams>(`
  INSERT INTO group_members (
    group_id,
    agent_id,
    role,
    created_at,
    updated_at
  ) VALUES (
    @group_id,
    @agent_id,
    @role,
    @created_at,
    @updated_at
  )
  ON CONFLICT(group_id, agent_id) DO UPDATE SET
    role = excluded.role,
    updated_at = excluded.updated_at
`);

const updateMemberRoleStmt = db.prepare<{
  group_id: string;
  agent_id: string;
  role: string;
  updated_at: string;
}>(`
  UPDATE group_members
  SET
    role = @role,
    updated_at = @updated_at
  WHERE group_id = @group_id AND agent_id = @agent_id
`);

const deleteGroupMemberStmt = db.prepare<{ group_id: string; agent_id: string }>(`
  DELETE FROM group_members
  WHERE group_id = @group_id AND agent_id = @agent_id
`);

function normalizeGroupRole(value: unknown, fallback = "member") {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value !== "string") {
    throw new ApiError(400, "成员角色必须是字符串");
  }

  const normalized = value.trim().toLowerCase();
  if (normalized !== "member" && normalized !== "owner") {
    throw new ApiError(400, "成员角色只能是 member 或 owner");
  }

  return normalized;
}

function normalizeMembersInput(value: unknown, ownerAgentId: string | null) {
  const members = new Map<string, { agent_id: string; role: string }>();

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) {
        members.set(item.trim(), {
          agent_id: item.trim(),
          role: "member",
        });
        continue;
      }

      if (!isRecord(item)) {
        continue;
      }

      const agentId = asRequiredText(item.agent_id ?? item.agentId ?? item.id, "成员 ID");
      const role = normalizeGroupRole(item.role, "member");
      members.set(agentId, {
        agent_id: agentId,
        role,
      });
    }
  }

  if (ownerAgentId) {
    members.set(ownerAgentId, {
      agent_id: ownerAgentId,
      role: "owner",
    });
  }

  return [...members.values()];
}

function ensureGroupExists(groupId: string) {
  const group = getGroupRowStmt.get({ id: groupId });
  if (!group) {
    throw new ApiError(404, "项目组不存在");
  }

  return group;
}

function checkpointWal() {
  db.pragma("wal_checkpoint(PASSIVE)");
}

function syncOwnerMember(
  groupId: string,
  previousOwnerId: string | null,
  nextOwnerId: string | null,
) {
  const updatedAt = nowIso();

  if (previousOwnerId && previousOwnerId !== nextOwnerId) {
    const previousOwnerMember = getGroupMemberStmt.get({
      group_id: groupId,
      agent_id: previousOwnerId,
    });
    if (previousOwnerMember) {
      updateMemberRoleStmt.run({
        group_id: groupId,
        agent_id: previousOwnerId,
        role: "member",
        updated_at: updatedAt,
      });
    }
  }

  if (nextOwnerId) {
    upsertGroupMemberStmt.run({
      group_id: groupId,
      agent_id: nextOwnerId,
      role: "owner",
      created_at: updatedAt,
      updated_at: updatedAt,
    });
  }
}

function syncGroupMembers(groupId: string, members: Array<{ agent_id: string; role: string }>) {
  const currentMembers = listGroupMembersStmt.all({ group_id: groupId });
  const nextMemberIds = new Set(members.map((member) => member.agent_id));
  const updatedAt = nowIso();

  for (const member of currentMembers) {
    if (!nextMemberIds.has(member.agent_id)) {
      deleteGroupMemberStmt.run({
        group_id: groupId,
        agent_id: member.agent_id,
      });
    }
  }

  for (const member of members) {
    upsertGroupMemberStmt.run({
      group_id: groupId,
      agent_id: member.agent_id,
      role: member.role,
      created_at: updatedAt,
      updated_at: updatedAt,
    });
  }
}

router.get("/", (_req, res) => {
  res.json(listGroupsWithMembers());
});

router.get("/:id", (req, res) => {
  const id = readRouteParam(req.params.id, "项目组 ID");
  const group = getGroupWithMembers(id);
  if (!group) {
    throw new ApiError(404, "项目组不存在");
  }

  res.json(group);
});

router.post("/", (req, res) => {
  const body = requireRecord(req.body);
  const id = asRequiredText(body.id, "项目组 ID");
  if (getGroupRowStmt.get({ id })) {
    throw new ApiError(409, "项目组已存在");
  }

  const ownerAgentId = asOptionalText(body.owner_agent_id ?? body.ownerAgentId, "群主 Agent ID");
  const createdAt = nowIso();
  const payload: GroupMutationParams = {
    id,
    name: asOptionalText(body.name, "项目组名称"),
    icon: asOptionalText(body.icon, "项目组图标"),
    description: asOptionalText(body.description, "项目组简介"),
    owner_agent_id: ownerAgentId,
    announcement: asOptionalText(body.announcement, "群公告"),
    announcement_version:
      asOptionalInteger(body.announcement_version ?? body.announcementVersion, "公告版本") ?? 0,
    urge_enabled: asBooleanInteger(body.urge_enabled ?? body.urgeEnabled, "督促模式", 0),
    urge_paused: asBooleanInteger(body.urge_paused ?? body.urgePaused, "督促暂停", 0),
    urge_interval: asOptionalInteger(
      body.urge_interval ?? body.urgeInterval ?? body.urgeIntervalMinutes,
      "督促间隔分钟数",
    ),
    urge_count: Math.max(
      0,
      asOptionalInteger(body.urge_count ?? body.urgeCount, "累计督促次数") ?? 0,
    ),
    urge_no_response_count: Math.max(
      0,
      asOptionalInteger(
        body.urge_no_response_count ?? body.urgeNoResponseCount,
        "连续无响应次数",
      ) ?? 0,
    ),
    urge_last_checked_at: asOptionalText(
      body.urge_last_checked_at ?? body.urgeLastCheckedAt,
      "最后检查时间",
    ),
    last_urge_at: asOptionalText(body.last_urge_at ?? body.lastUrgeAt, "上次督促时间"),
    urge_stop_reason: asOptionalText(body.urge_stop_reason ?? body.urgeStopReason, "督促停止原因"),
    max_rounds: asOptionalInteger(body.max_rounds ?? body.maxRounds, "最大轮数") ?? 20,
    created_at: createdAt,
    updated_at: createdAt,
  };

  const members = normalizeMembersInput(body.members, ownerAgentId);

  runTransaction(() => {
    insertGroupStmt.run(payload);
    for (const member of members) {
      upsertGroupMemberStmt.run({
        group_id: id,
        agent_id: member.agent_id,
        role: member.role,
        created_at: createdAt,
        updated_at: createdAt,
      });
    }
  });
  checkpointWal();

  res.status(201).json(getGroupWithMembers(id));
});

router.put("/:id", (req, res) => {
  const id = readRouteParam(req.params.id, "项目组 ID");
  const current = ensureGroupExists(id);
  const body = requireRecord(req.body);

  const nextOwnerAgentId =
    body.owner_agent_id !== undefined || body.ownerAgentId !== undefined
      ? asOptionalText(body.owner_agent_id ?? body.ownerAgentId, "群主 Agent ID")
      : current.owner_agent_id;
  const nextMembers =
    body.members !== undefined ? normalizeMembersInput(body.members, nextOwnerAgentId) : null;

  const payload: GroupMutationParams = {
    ...current,
    name: body.name !== undefined ? asOptionalText(body.name, "项目组名称") : current.name,
    icon: body.icon !== undefined ? asOptionalText(body.icon, "项目组图标") : current.icon,
    description:
      body.description !== undefined
        ? asOptionalText(body.description, "项目组简介")
        : current.description,
    owner_agent_id: nextOwnerAgentId,
    announcement:
      body.announcement !== undefined
        ? asOptionalText(body.announcement, "群公告")
        : current.announcement,
    announcement_version:
      body.announcement_version !== undefined || body.announcementVersion !== undefined
        ? (asOptionalInteger(body.announcement_version ?? body.announcementVersion, "公告版本") ??
          0)
        : current.announcement_version,
    urge_enabled:
      body.urge_enabled !== undefined || body.urgeEnabled !== undefined
        ? asBooleanInteger(body.urge_enabled ?? body.urgeEnabled, "督促模式", current.urge_enabled)
        : current.urge_enabled,
    urge_paused:
      body.urge_paused !== undefined || body.urgePaused !== undefined
        ? asBooleanInteger(body.urge_paused ?? body.urgePaused, "督促暂停", current.urge_paused)
        : current.urge_paused,
    urge_interval:
      body.urge_interval !== undefined ||
      body.urgeInterval !== undefined ||
      body.urgeIntervalMinutes !== undefined
        ? asOptionalInteger(
            body.urge_interval ?? body.urgeInterval ?? body.urgeIntervalMinutes,
            "督促间隔分钟数",
          )
        : current.urge_interval,
    urge_count:
      body.urge_count !== undefined || body.urgeCount !== undefined
        ? Math.max(0, asOptionalInteger(body.urge_count ?? body.urgeCount, "累计督促次数") ?? 0)
        : current.urge_count,
    urge_no_response_count:
      body.urge_no_response_count !== undefined || body.urgeNoResponseCount !== undefined
        ? Math.max(
            0,
            asOptionalInteger(
              body.urge_no_response_count ?? body.urgeNoResponseCount,
              "连续无响应次数",
            ) ?? 0,
          )
        : current.urge_no_response_count,
    urge_last_checked_at:
      body.urge_last_checked_at !== undefined || body.urgeLastCheckedAt !== undefined
        ? asOptionalText(body.urge_last_checked_at ?? body.urgeLastCheckedAt, "最后检查时间")
        : current.urge_last_checked_at,
    last_urge_at:
      body.last_urge_at !== undefined || body.lastUrgeAt !== undefined
        ? asOptionalText(body.last_urge_at ?? body.lastUrgeAt, "上次督促时间")
        : current.last_urge_at,
    urge_stop_reason:
      body.urge_stop_reason !== undefined || body.urgeStopReason !== undefined
        ? asOptionalText(body.urge_stop_reason ?? body.urgeStopReason, "督促停止原因")
        : current.urge_stop_reason,
    max_rounds:
      body.max_rounds !== undefined || body.maxRounds !== undefined
        ? (asOptionalInteger(body.max_rounds ?? body.maxRounds, "最大轮数") ?? 20)
        : current.max_rounds,
    updated_at: nowIso(),
  };

  runTransaction(() => {
    updateGroupStmt.run(payload);

    if (nextMembers) {
      syncGroupMembers(id, nextMembers);
    } else if (body.owner_agent_id !== undefined || body.ownerAgentId !== undefined) {
      syncOwnerMember(id, current.owner_agent_id, nextOwnerAgentId);
    }
  });
  checkpointWal();

  res.json(getGroupWithMembers(id));
});

router.delete("/:id", (req, res) => {
  const id = readRouteParam(req.params.id, "项目组 ID");
  ensureGroupExists(id);
  deleteGroupStmt.run({ id });
  checkpointWal();
  res.json({ success: true });
});

router.post("/:id/members", (req, res) => {
  const groupId = readRouteParam(req.params.id, "项目组 ID");
  const currentGroup = ensureGroupExists(groupId);
  const body = requireRecord(req.body);
  const agentId = asRequiredText(body.agent_id ?? body.agentId ?? body.id, "成员 Agent ID");

  const requestedRole = normalizeGroupRole(body.role, "member");
  const role = currentGroup.owner_agent_id === agentId ? "owner" : requestedRole;
  const timestamp = nowIso();

  runTransaction(() => {
    if (role === "owner") {
      syncOwnerMember(groupId, currentGroup.owner_agent_id, agentId);
      updateGroupStmt.run({
        ...currentGroup,
        owner_agent_id: agentId,
        updated_at: timestamp,
      });
    }

    upsertGroupMemberStmt.run({
      group_id: groupId,
      agent_id: agentId,
      role,
      created_at: timestamp,
      updated_at: timestamp,
    });
  });
  checkpointWal();

  res.status(201).json(getGroupWithMembers(groupId));
});

router.delete("/:id/members/:agentId", (req, res) => {
  const groupId = readRouteParam(req.params.id, "项目组 ID");
  const agentId = readRouteParam(req.params.agentId, "成员 Agent ID");
  const currentGroup = ensureGroupExists(groupId);
  const member = getGroupMemberStmt.get({ group_id: groupId, agent_id: agentId });
  if (!member) {
    throw new ApiError(404, "成员不存在");
  }

  runTransaction(() => {
    deleteGroupMemberStmt.run({ group_id: groupId, agent_id: agentId });

    if (currentGroup.owner_agent_id === agentId) {
      updateGroupStmt.run({
        ...currentGroup,
        owner_agent_id: null,
        updated_at: nowIso(),
      });
    }
  });
  checkpointWal();

  res.json(getGroupWithMembers(groupId));
});

export default router;
