import { randomUUID } from "node:crypto";
import { Router } from "express";
import { ARCHIVE_TOMBSTONE_SQLITE_ERROR, db, nowIso, runTransaction } from "../db";
import { isRecord, requireRecord } from "../utils";

type UpsertEmployeeParams = {
  id: string;
  name: string | null;
  avatar: string | null;
  position: string | null;
  department: string | null;
  description: string | null;
  pinned: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type UpsertDepartmentParams = {
  id: string;
  name: string | null;
  icon: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type UpsertGroupParams = {
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

type UpsertGroupMemberParams = {
  group_id: string;
  agent_id: string;
  role: string;
  created_at: string;
  updated_at: string;
};

type UpsertArchiveParams = {
  id: string;
  type: string;
  source_id: string;
  source_name: string | null;
  title: string | null;
  messages: string | null;
  message_count: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type UpsertCronTaskParams = {
  id: string;
  agent_id: string | null;
  name: string | null;
  reply_mode: string | null;
  reply_target_id: string | null;
  display_status: string | null;
  created_at: string;
  updated_at: string;
};

type UpsertSettingParams = {
  key: string;
  value: string | null;
  created_at: string;
  updated_at: string;
};

const router = Router();

const XIABAN_CRON_META_PREFIX = "__XIABAN_CRON_META_V1__:";

const upsertEmployeeStmt = db.prepare<UpsertEmployeeParams>(`
  INSERT INTO employees (
    id,
    name,
    avatar,
    position,
    department,
    description,
    pinned,
    sort_order,
    created_at,
    updated_at
  ) VALUES (
    @id,
    @name,
    @avatar,
    @position,
    @department,
    @description,
    @pinned,
    @sort_order,
    @created_at,
    @updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    avatar = excluded.avatar,
    position = excluded.position,
    department = excluded.department,
    description = excluded.description,
    pinned = excluded.pinned,
    sort_order = excluded.sort_order,
    updated_at = excluded.updated_at
`);

const upsertDepartmentStmt = db.prepare<UpsertDepartmentParams>(`
  INSERT INTO departments (
    id,
    name,
    icon,
    sort_order,
    created_at,
    updated_at
  ) VALUES (
    @id,
    @name,
    @icon,
    @sort_order,
    @created_at,
    @updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    icon = excluded.icon,
    sort_order = excluded.sort_order,
    updated_at = excluded.updated_at
`);

const upsertGroupStmt = db.prepare<UpsertGroupParams>(`
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
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    icon = excluded.icon,
    description = excluded.description,
    owner_agent_id = excluded.owner_agent_id,
    announcement = excluded.announcement,
    announcement_version = excluded.announcement_version,
    urge_enabled = excluded.urge_enabled,
    urge_paused = excluded.urge_paused,
    urge_interval = excluded.urge_interval,
    urge_count = excluded.urge_count,
    urge_no_response_count = excluded.urge_no_response_count,
    urge_last_checked_at = excluded.urge_last_checked_at,
    last_urge_at = excluded.last_urge_at,
    urge_stop_reason = excluded.urge_stop_reason,
    max_rounds = excluded.max_rounds,
    updated_at = excluded.updated_at
`);

const upsertGroupMemberStmt = db.prepare<UpsertGroupMemberParams>(`
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

const upsertArchiveStmt = db.prepare<UpsertArchiveParams>(`
  INSERT INTO archives (
    id,
    type,
    source_id,
    source_name,
    title,
    messages,
    message_count,
    archived_at,
    created_at,
    updated_at
  ) VALUES (
    @id,
    @type,
    @source_id,
    @source_name,
    @title,
    @messages,
    @message_count,
    @archived_at,
    @created_at,
    @updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    type = excluded.type,
    source_id = excluded.source_id,
    source_name = excluded.source_name,
    title = excluded.title,
    messages = excluded.messages,
    message_count = excluded.message_count,
    archived_at = excluded.archived_at,
    updated_at = excluded.updated_at
`);

const getDirectArchiveTombstoneStmt = db.prepare<{ id: string }, { id: string }>(`
  SELECT id
  FROM archive_tombstones
  WHERE id = @id
    AND type = 'direct'
`);

const upsertCronTaskStmt = db.prepare<UpsertCronTaskParams>(`
  INSERT INTO cron_tasks (
    id,
    agent_id,
    name,
    reply_mode,
    reply_target_id,
    display_status,
    created_at,
    updated_at
  ) VALUES (
    @id,
    @agent_id,
    @name,
    @reply_mode,
    @reply_target_id,
    @display_status,
    @created_at,
    @updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    agent_id = excluded.agent_id,
    name = excluded.name,
    reply_mode = excluded.reply_mode,
    reply_target_id = excluded.reply_target_id,
    display_status = excluded.display_status,
    updated_at = excluded.updated_at
`);

const upsertSettingStmt = db.prepare<UpsertSettingParams>(`
  INSERT INTO settings (
    key,
    value,
    created_at,
    updated_at
  ) VALUES (
    @key,
    @value,
    @created_at,
    @updated_at
  )
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = excluded.updated_at
`);

function pickText(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      const normalized = value.trim();
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function pickInteger(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.trunc(value);
    }

    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) {
        return Math.trunc(parsed);
      }
    }
  }

  return null;
}

function pickBooleanInteger(record: Record<string, unknown>, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return value === 0 ? 0 : 1;
    }

    if (typeof value === "string" && value.trim()) {
      const normalized = value.trim().toLowerCase();
      if (normalized === "1" || normalized === "true") {
        return 1;
      }

      if (normalized === "0" || normalized === "false") {
        return 0;
      }
    }
  }

  return fallback;
}

function pickTimestamp(record: Record<string, unknown>, keys: string[], fallback: string) {
  return pickText(record, keys) ?? fallback;
}

function pickOptionalTimestampText(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return new Date(value).toISOString();
    }

    if (typeof value === "string") {
      const normalized = value.trim();
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function toJsonText(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function normalizeList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord);
}

function decodeCronMeta(description: unknown) {
  if (typeof description !== "string") {
    return null;
  }

  const normalized = description.trim();
  if (!normalized.startsWith(XIABAN_CRON_META_PREFIX)) {
    return null;
  }

  const raw = normalized.slice(XIABAN_CRON_META_PREFIX.length).trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as {
      version?: number;
      replyMode?: string;
      groupId?: string;
    };

    if (
      parsed.version !== 1 ||
      (parsed.replyMode !== "direct" &&
        parsed.replyMode !== "group" &&
        parsed.replyMode !== "silent")
    ) {
      return null;
    }

    return {
      replyMode: parsed.replyMode,
      groupId:
        typeof parsed.groupId === "string" && parsed.groupId.trim() ? parsed.groupId.trim() : null,
    };
  } catch {
    return null;
  }
}

function normalizeGroupMembers(value: unknown, ownerAgentId: string | null) {
  const members = new Map<string, { agent_id: string; role: string }>();

  for (const item of normalizeList(value)) {
    const agentId = pickText(item, ["agent_id", "agentId", "id"]);
    if (!agentId) {
      continue;
    }

    const rawRole = pickText(item, ["role"]);
    const role = rawRole === "owner" ? "owner" : "member";
    members.set(agentId, {
      agent_id: agentId,
      role,
    });
  }

  if (ownerAgentId) {
    members.set(ownerAgentId, {
      agent_id: ownerAgentId,
      role: "owner",
    });
  }

  return [...members.values()];
}

function normalizeArchiveRecords(payload: Record<string, unknown>) {
  const topLevelArchives = normalizeList(payload.archives);
  const directArchives = normalizeList(payload.directArchives ?? payload.direct_archives);
  const groupsPayload = isRecord(payload.groups) ? payload.groups : null;
  const groupArchives = groupsPayload ? normalizeList(groupsPayload.archives) : [];

  const mixedArchives =
    topLevelArchives.length > 0 && isRecord(payload.archives)
      ? [...normalizeList(payload.archives.group), ...normalizeList(payload.archives.direct)]
      : [];

  return [...topLevelArchives, ...directArchives, ...groupArchives, ...mixedArchives];
}

router.post("/", (req, res) => {
  const payload = requireRecord(req.body);
  const employees = normalizeList(payload.employees);
  const departments = normalizeList(payload.departments);
  const groupsSource = Array.isArray(payload.groups)
    ? normalizeList(payload.groups)
    : isRecord(payload.groups)
      ? normalizeList(payload.groups.groups)
      : [];
  const archives = normalizeArchiveRecords(payload);
  const cronTasks = normalizeList(payload.cronTasks ?? payload.cron_tasks);

  const rawSettings = payload.settings;
  const settings = Array.isArray(rawSettings)
    ? normalizeList(rawSettings)
    : isRecord(rawSettings)
      ? Object.entries(rawSettings).map(([key, value]) => ({
          key,
          value,
        }))
      : [];

  const counters = {
    employees: 0,
    departments: 0,
    groups: 0,
    group_members: 0,
    archives: 0,
    cron_tasks: 0,
    settings: 0,
  };

  runTransaction(() => {
    for (const item of employees) {
      const id = pickText(item, ["id"]);
      if (!id) {
        continue;
      }

      const createdAt = pickTimestamp(item, ["created_at", "createdAt"], nowIso());
      upsertEmployeeStmt.run({
        id,
        name: pickText(item, ["name"]),
        avatar: pickText(item, ["avatar", "avatarUrl"]),
        position: pickText(item, ["position", "role", "title"]),
        department: pickText(item, ["department", "departmentName"]),
        description: pickText(item, ["description", "bio"]),
        pinned: pickBooleanInteger(item, ["pinned"], 0),
        sort_order: pickInteger(item, ["sort_order", "sortOrder"]) ?? 0,
        created_at: createdAt,
        updated_at: pickTimestamp(item, ["updated_at", "updatedAt"], createdAt),
      });
      counters.employees += 1;
    }

    for (const item of departments) {
      const id = pickText(item, ["id"]);
      if (!id) {
        continue;
      }

      const createdAt = pickTimestamp(item, ["created_at", "createdAt"], nowIso());
      upsertDepartmentStmt.run({
        id,
        name: pickText(item, ["name"]),
        icon: pickText(item, ["icon"]),
        sort_order: pickInteger(item, ["sort_order", "sortOrder"]) ?? 0,
        created_at: createdAt,
        updated_at: pickTimestamp(item, ["updated_at", "updatedAt"], createdAt),
      });
      counters.departments += 1;
    }

    for (const item of groupsSource) {
      const id = pickText(item, ["id"]);
      if (!id) {
        continue;
      }

      const ownerAgentId = pickText(item, ["owner_agent_id", "ownerAgentId", "leaderId"]);
      const createdAt = pickTimestamp(item, ["created_at", "createdAt"], nowIso());
      upsertGroupStmt.run({
        id,
        name: pickText(item, ["name"]),
        icon: pickText(item, ["icon", "avatarUrl"]),
        description: pickText(item, ["description"]),
        owner_agent_id: ownerAgentId,
        announcement: pickText(item, ["announcement"]),
        announcement_version:
          pickInteger(item, ["announcement_version", "announcementVersion"]) ?? 0,
        urge_enabled: pickBooleanInteger(item, ["urge_enabled", "urgeEnabled", "isUrging"], 0),
        urge_paused: pickBooleanInteger(item, ["urge_paused", "urgePaused", "isUrgePaused"], 0),
        urge_interval: pickInteger(item, ["urge_interval", "urgeInterval", "urgeIntervalMinutes"]),
        urge_count: Math.max(0, pickInteger(item, ["urge_count", "urgeCount"]) ?? 0),
        urge_no_response_count: Math.max(
          0,
          pickInteger(item, ["urge_no_response_count", "urgeNoResponseCount"]) ?? 0,
        ),
        urge_last_checked_at: pickOptionalTimestampText(item, [
          "urge_last_checked_at",
          "urgeLastCheckedAt",
        ]),
        last_urge_at: pickOptionalTimestampText(item, ["last_urge_at", "lastUrgeAt"]),
        urge_stop_reason: pickText(item, ["urge_stop_reason", "urgeStopReason"]),
        max_rounds: pickInteger(item, ["max_rounds", "maxRounds"]) ?? 20,
        created_at: createdAt,
        updated_at: pickTimestamp(item, ["updated_at", "updatedAt"], createdAt),
      });
      counters.groups += 1;

      const members = normalizeGroupMembers(item.members, ownerAgentId);
      for (const member of members) {
        const memberTimestamp = nowIso();
        upsertGroupMemberStmt.run({
          group_id: id,
          agent_id: member.agent_id,
          role: member.role,
          created_at: memberTimestamp,
          updated_at: memberTimestamp,
        });
        counters.group_members += 1;
      }
    }

    for (const item of archives) {
      const archiveId = pickText(item, ["id", "archiveId"]) ?? randomUUID();
      const explicitType = pickText(item, ["type"]);
      const type =
        explicitType === "direct" || explicitType === "group"
          ? explicitType
          : pickText(item, ["groupId", "group_id"])
            ? "group"
            : "direct";
      const sourceId =
        pickText(item, ["source_id", "sourceId"]) ??
        (type === "group"
          ? pickText(item, ["groupId", "group_id"])
          : pickText(item, ["agentId", "agent_id"]));
      if (!sourceId) {
        continue;
      }

      const messages = item.messages ?? item.history ?? item.items ?? item.session ?? [];
      const archivedAt = pickText(item, ["archived_at", "archivedAt", "createdAt", "updatedAt"]);
      const createdAt = archivedAt ?? nowIso();

      if (type === "direct" && getDirectArchiveTombstoneStmt.get({ id: archiveId })) {
        console.log(
          `[BackendArchive] POST /api/migrate: skip tombstoned direct archive ${archiveId}`,
        );
        continue;
      }

      try {
        upsertArchiveStmt.run({
          id: archiveId,
          type,
          source_id: sourceId,
          source_name:
            pickText(item, ["source_name", "sourceName"]) ??
            (type === "group" ? pickText(item, ["groupName"]) : pickText(item, ["agentName"])),
          title: pickText(item, ["title", "archiveTitle"]),
          messages: toJsonText(messages),
          message_count: Array.isArray(messages) ? messages.length : 0,
          archived_at: archivedAt,
          created_at: pickTimestamp(item, ["created_at", "createdAt"], createdAt),
          updated_at: pickTimestamp(item, ["updated_at", "updatedAt"], createdAt),
        });
      } catch (error) {
        if (
          type === "direct" &&
          error instanceof Error &&
          error.message.includes(ARCHIVE_TOMBSTONE_SQLITE_ERROR)
        ) {
          console.log(
            `[BackendArchive] POST /api/migrate: tombstone conflict during insert for ${archiveId}`,
          );
          continue;
        }

        throw error;
      }
      counters.archives += 1;
    }

    for (const item of cronTasks) {
      const id = pickText(item, ["id", "jobId"]);
      if (!id) {
        continue;
      }

      const meta = decodeCronMeta(item.description);
      const createdAt = pickTimestamp(item, ["created_at", "createdAt"], nowIso());
      const replyMode =
        pickText(item, ["reply_mode", "replyMode"]) ??
        meta?.replyMode ??
        (pickText(item, ["groupId", "reply_target_id", "replyTargetId"]) ? "group" : "direct");

      upsertCronTaskStmt.run({
        id,
        agent_id: pickText(item, ["agent_id", "agentId"]),
        name: pickText(item, ["name"]),
        reply_mode: replyMode,
        reply_target_id:
          pickText(item, ["reply_target_id", "replyTargetId", "groupId"]) ?? meta?.groupId ?? null,
        display_status:
          pickText(item, ["display_status", "displayStatus", "status"]) ??
          (pickBooleanInteger(item, ["enabled"], 1) === 0 ? "STOPPED" : "RUNNING"),
        created_at: createdAt,
        updated_at: pickTimestamp(item, ["updated_at", "updatedAt"], createdAt),
      });
      counters.cron_tasks += 1;
    }

    for (const item of settings) {
      const key = pickText(item, ["key"]);
      if (!key) {
        continue;
      }

      const createdAt = pickTimestamp(item, ["created_at", "createdAt"], nowIso());
      upsertSettingStmt.run({
        key,
        value: toJsonText(item.value),
        created_at: createdAt,
        updated_at: pickTimestamp(item, ["updated_at", "updatedAt"], createdAt),
      });
      counters.settings += 1;
    }
  });

  console.log(`[DB] 已完成迁移导入: ${JSON.stringify(counters)}`);

  res.json({
    success: true,
    imported: counters,
  });
});

export default router;
