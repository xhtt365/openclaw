import { db, nowIso, runTransaction } from "../db";
import { ApiError } from "../errors";

type StorageUserRow = {
  id: string;
  name: string | null;
  avatar: string | null;
  created_at: string;
  updated_at: string;
};

type AgentAvatarRow = {
  agent_id: string;
  avatar: string;
  updated_at: string;
};

type ChannelConfigRow = {
  agent_id: string;
  config: string;
  updated_at: string;
};

type ModelProviderRow = {
  id: string;
  config: string;
  updated_at: string;
};

type SettingRow = {
  key: string;
  value: string | null;
  created_at: string;
  updated_at: string;
};

type StorageGroupRow = {
  id: string;
  name: string | null;
  icon: string | null;
  description: string | null;
  owner_agent_id: string | null;
  announcement: string | null;
  announcement_version: number;
  notifications_enabled: number;
  sound_enabled: number;
  urge_enabled: number;
  urge_paused: number;
  urge_interval: number | null;
  urge_started_at: string | null;
  urge_count: number;
  urge_no_response_count: number;
  urge_last_checked_at: string | null;
  last_urge_at: string | null;
  urge_stop_reason: string | null;
  max_rounds: number;
  created_at: string;
  updated_at: string;
};

type StorageGroupMemberRow = {
  group_id: string;
  agent_id: string;
  role: string;
  created_at: string;
  updated_at: string;
};

type ArchiveRow = {
  id: string;
  type: string;
  source_id: string;
  source_name: string | null;
  title: string | null;
  messages: string | null;
  message_count: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type GroupSnapshotRecord = {
  groups: unknown[];
  selectedGroupId: string | null;
  selectedArchiveId: string | null;
  messagesByGroupId: Record<string, unknown>;
  archives: unknown[];
};

type NormalizedMirroredGroup = {
  id: string;
  row: StorageGroupRow;
  members: StorageGroupMemberRow[];
};

type NormalizedMirroredArchive = {
  id: string;
  row: ArchiveRow;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeInteger(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  return fallback;
}

function normalizeBooleanInteger(value: unknown, fallback = 0) {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value === 0 ? 0 : 1;
  }

  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return 1;
    }

    if (normalized === "false" || normalized === "0") {
      return 0;
    }
  }

  return fallback;
}

function normalizeIsoFromUnknown(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    const timestamp = Date.parse(value.trim());
    if (Number.isFinite(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }

  return null;
}

function parseJsonSafe<T>(value: string | null, fallback: T) {
  if (!value || !value.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function serializeJson(value: unknown) {
  return JSON.stringify(value);
}

function getGroupSnapshotSettingKey(userId: string) {
  return `storage.groups.snapshot.${userId}`;
}

const SHARED_STORAGE_USER_ID = "self";
const GROUP_SNAPSHOT_SETTING_KEY_PREFIX = "storage.groups.snapshot.";

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    avatar TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_avatars (
    agent_id TEXT PRIMARY KEY,
    avatar TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS channel_configs (
    agent_id TEXT PRIMARY KEY,
    config TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS model_providers (
    id TEXT PRIMARY KEY,
    config TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_agent_avatars_updated_at
  ON agent_avatars(updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_channel_configs_updated_at
  ON channel_configs(updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_model_providers_updated_at
  ON model_providers(updated_at DESC);
`);

type TableInfoRow = {
  name: string;
};

function ensureGroupsStorageColumn(columnName: string, definition: string) {
  const columns = db.prepare<[], TableInfoRow>("PRAGMA table_info(groups)").all();
  if (columns.some((column) => column.name === columnName)) {
    return false;
  }

  db.exec(`ALTER TABLE groups ADD COLUMN ${columnName} ${definition}`);
  return true;
}

const didAddGroupStorageColumns = [
  ensureGroupsStorageColumn("notifications_enabled", "INTEGER DEFAULT 1"),
  ensureGroupsStorageColumn("sound_enabled", "INTEGER DEFAULT 1"),
  ensureGroupsStorageColumn("urge_started_at", "TEXT"),
].some(Boolean);

if (didAddGroupStorageColumns) {
  db.pragma("wal_checkpoint(PASSIVE)");
}

const getUserStmt = db.prepare<{ id: string }, StorageUserRow>(`
  SELECT
    id,
    name,
    avatar,
    created_at,
    updated_at
  FROM users
  WHERE id = @id
`);

const upsertUserStmt = db.prepare<StorageUserRow>(`
  INSERT INTO users (
    id,
    name,
    avatar,
    created_at,
    updated_at
  ) VALUES (
    @id,
    @name,
    @avatar,
    @created_at,
    @updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    avatar = excluded.avatar,
    updated_at = excluded.updated_at
`);

const deleteUserStmt = db.prepare<{ id: string }>(`
  DELETE FROM users
  WHERE id = @id
`);

const listAgentAvatarRowsStmt = db.prepare<[], AgentAvatarRow>(`
  SELECT
    agent_id,
    avatar,
    updated_at
  FROM agent_avatars
  ORDER BY updated_at DESC, agent_id ASC
`);

const upsertAgentAvatarStmt = db.prepare<AgentAvatarRow>(`
  INSERT INTO agent_avatars (
    agent_id,
    avatar,
    updated_at
  ) VALUES (
    @agent_id,
    @avatar,
    @updated_at
  )
  ON CONFLICT(agent_id) DO UPDATE SET
    avatar = excluded.avatar,
    updated_at = excluded.updated_at
`);

const deleteAgentAvatarStmt = db.prepare<{ agent_id: string }>(`
  DELETE FROM agent_avatars
  WHERE agent_id = @agent_id
`);

const listChannelConfigRowsStmt = db.prepare<[], ChannelConfigRow>(`
  SELECT
    agent_id,
    config,
    updated_at
  FROM channel_configs
  ORDER BY updated_at DESC, agent_id ASC
`);

const getChannelConfigStmt = db.prepare<{ agent_id: string }, ChannelConfigRow>(`
  SELECT
    agent_id,
    config,
    updated_at
  FROM channel_configs
  WHERE agent_id = @agent_id
`);

const upsertChannelConfigStmt = db.prepare<ChannelConfigRow>(`
  INSERT INTO channel_configs (
    agent_id,
    config,
    updated_at
  ) VALUES (
    @agent_id,
    @config,
    @updated_at
  )
  ON CONFLICT(agent_id) DO UPDATE SET
    config = excluded.config,
    updated_at = excluded.updated_at
`);

const deleteChannelConfigStmt = db.prepare<{ agent_id: string }>(`
  DELETE FROM channel_configs
  WHERE agent_id = @agent_id
`);

const listModelProviderRowsStmt = db.prepare<[], ModelProviderRow>(`
  SELECT
    id,
    config,
    updated_at
  FROM model_providers
  ORDER BY updated_at DESC, id ASC
`);

const upsertModelProviderStmt = db.prepare<ModelProviderRow>(`
  INSERT INTO model_providers (
    id,
    config,
    updated_at
  ) VALUES (
    @id,
    @config,
    @updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    config = excluded.config,
    updated_at = excluded.updated_at
`);

const deleteModelProviderStmt = db.prepare<{ id: string }>(`
  DELETE FROM model_providers
  WHERE id = @id
`);

const clearModelProvidersStmt = db.prepare(`
  DELETE FROM model_providers
`);

const getSettingStmt = db.prepare<{ key: string }, SettingRow>(`
  SELECT
    key,
    value,
    created_at,
    updated_at
  FROM settings
  WHERE key = @key
`);

const upsertSettingStmt = db.prepare<SettingRow>(`
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

const deleteSettingStmt = db.prepare<{ key: string }>(`
  DELETE FROM settings
  WHERE key = @key
`);

const listStorageUserRowsByUpdatedStmt = db.prepare<[], StorageUserRow>(`
  SELECT
    id,
    name,
    avatar,
    created_at,
    updated_at
  FROM users
  ORDER BY updated_at DESC, created_at DESC, id ASC
`);

const listGroupSnapshotSettingsStmt = db.prepare<{ key_pattern: string }, SettingRow>(`
  SELECT
    key,
    value,
    created_at,
    updated_at
  FROM settings
  WHERE key LIKE @key_pattern
  ORDER BY updated_at DESC, created_at DESC, key ASC
`);

const listStorageGroupRowsStmt = db.prepare<[], StorageGroupRow>(`
  SELECT
    id,
    name,
    icon,
    description,
    owner_agent_id,
    announcement,
    announcement_version,
    notifications_enabled,
    sound_enabled,
    urge_enabled,
    urge_paused,
    urge_interval,
    urge_started_at,
    urge_count,
    urge_no_response_count,
    urge_last_checked_at,
    last_urge_at,
    urge_stop_reason,
    max_rounds,
    created_at,
    updated_at
  FROM groups
  ORDER BY created_at DESC, id ASC
`);

const getStorageGroupRowStmt = db.prepare<{ id: string }, StorageGroupRow>(`
  SELECT
    id,
    name,
    icon,
    description,
    owner_agent_id,
    announcement,
    announcement_version,
    notifications_enabled,
    sound_enabled,
    urge_enabled,
    urge_paused,
    urge_interval,
    urge_started_at,
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

const insertStorageGroupStmt = db.prepare<StorageGroupRow>(`
  INSERT INTO groups (
    id,
    name,
    icon,
    description,
    owner_agent_id,
    announcement,
    announcement_version,
    notifications_enabled,
    sound_enabled,
    urge_enabled,
    urge_paused,
    urge_interval,
    urge_started_at,
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
    @notifications_enabled,
    @sound_enabled,
    @urge_enabled,
    @urge_paused,
    @urge_interval,
    @urge_started_at,
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

const updateStorageGroupStmt = db.prepare<StorageGroupRow>(`
  UPDATE groups
  SET
    name = @name,
    icon = @icon,
    description = @description,
    owner_agent_id = @owner_agent_id,
    announcement = @announcement,
    announcement_version = @announcement_version,
    notifications_enabled = @notifications_enabled,
    sound_enabled = @sound_enabled,
    urge_enabled = @urge_enabled,
    urge_paused = @urge_paused,
    urge_interval = @urge_interval,
    urge_started_at = @urge_started_at,
    urge_count = @urge_count,
    urge_no_response_count = @urge_no_response_count,
    urge_last_checked_at = @urge_last_checked_at,
    last_urge_at = @last_urge_at,
    urge_stop_reason = @urge_stop_reason,
    max_rounds = @max_rounds,
    updated_at = @updated_at
  WHERE id = @id
`);

const deleteStorageGroupStmt = db.prepare<{ id: string }>(`
  DELETE FROM groups
  WHERE id = @id
`);

const listGroupMembersStmt = db.prepare<{ group_id: string }, StorageGroupMemberRow>(`
  SELECT
    group_id,
    agent_id,
    role,
    created_at,
    updated_at
  FROM group_members
  WHERE group_id = @group_id
  ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END, created_at ASC, agent_id ASC
`);

const upsertGroupMemberStmt = db.prepare<StorageGroupMemberRow>(`
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

const deleteGroupMembersForGroupStmt = db.prepare<{ group_id: string }>(`
  DELETE FROM group_members
  WHERE group_id = @group_id
`);

const listGroupArchiveRowsStmt = db.prepare<[], ArchiveRow>(`
  SELECT
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
  FROM archives
  WHERE type = 'group'
  ORDER BY COALESCE(archived_at, created_at) DESC, id ASC
`);

const getArchiveRowStmt = db.prepare<{ id: string }, ArchiveRow>(`
  SELECT
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
  FROM archives
  WHERE id = @id
`);

const upsertArchiveStmt = db.prepare<ArchiveRow>(`
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

const deleteArchiveStmt = db.prepare<{ id: string }>(`
  DELETE FROM archives
  WHERE id = @id
`);

function logArchiveUpsert(row: ArchiveRow, context: string) {
  console.log(
    `[StorageService] upsertArchiveStmt.run: context=${context}, id=${row.id}, type=${row.type}, source_id=${row.source_id}, archived_at=${row.archived_at}, timestamp=${new Date().toISOString()}`,
  );
}

function logArchiveDelete(id: string, context: string) {
  console.log(
    `[StorageService] deleteArchiveStmt.run: context=${context}, id=${id}, timestamp=${new Date().toISOString()}`,
  );
}

function readSettingValue(key: string) {
  return getSettingStmt.get({ key }) ?? null;
}

function writeSettingValue(key: string, value: unknown) {
  const existing = readSettingValue(key);
  const createdAt = existing?.created_at ?? nowIso();
  upsertSettingStmt.run({
    key,
    value: serializeJson(value),
    created_at: createdAt,
    updated_at: nowIso(),
  });
  return readSettingValue(key);
}

function deleteSettingValue(key: string) {
  deleteSettingStmt.run({ key });
}

function normalizeGroupSnapshotRecord(snapshot: unknown): GroupSnapshotRecord {
  const record = isRecord(snapshot) ? snapshot : {};
  const rawGroups = Array.isArray(record.groups) ? record.groups : [];
  const rawArchives = Array.isArray(record.archives) ? record.archives : [];
  const rawMessagesByGroupId = isRecord(record.messagesByGroupId) ? record.messagesByGroupId : {};

  return {
    groups: rawGroups,
    selectedGroupId:
      typeof record.selectedGroupId === "string" && record.selectedGroupId.trim()
        ? record.selectedGroupId.trim()
        : null,
    selectedArchiveId:
      typeof record.selectedArchiveId === "string" && record.selectedArchiveId.trim()
        ? record.selectedArchiveId.trim()
        : null,
    messagesByGroupId: rawMessagesByGroupId,
    archives: rawArchives,
  };
}

function isSharedStorageUserId(userId: string) {
  return userId === SHARED_STORAGE_USER_ID;
}

function isNewerTimestamp(
  nextTimestamp: string | null | undefined,
  currentTimestamp: string | null | undefined,
) {
  if (!nextTimestamp) {
    return false;
  }

  if (!currentTimestamp) {
    return true;
  }

  const nextTime = Date.parse(nextTimestamp);
  const currentTime = Date.parse(currentTimestamp);
  if (!Number.isFinite(nextTime)) {
    return false;
  }

  if (!Number.isFinite(currentTime)) {
    return true;
  }

  return nextTime > currentTime;
}

function getLatestLegacyUserProfileRow() {
  return (
    listStorageUserRowsByUpdatedStmt.all().find((row) => !isSharedStorageUserId(row.id)) ?? null
  );
}

function extractUserIdFromGroupSnapshotSettingKey(key: string) {
  if (!key.startsWith(GROUP_SNAPSHOT_SETTING_KEY_PREFIX)) {
    return "";
  }

  return key.slice(GROUP_SNAPSHOT_SETTING_KEY_PREFIX.length).trim();
}

function getLatestLegacyGroupSnapshotSetting() {
  return (
    listGroupSnapshotSettingsStmt
      .all({
        key_pattern: `${GROUP_SNAPSHOT_SETTING_KEY_PREFIX}%`,
      })
      .find(
        (setting) => !isSharedStorageUserId(extractUserIdFromGroupSnapshotSettingKey(setting.key)),
      ) ?? null
  );
}

function buildMirroredGroup(group: unknown): NormalizedMirroredGroup | null {
  if (!isRecord(group)) {
    return null;
  }

  const groupId = normalizeText(group.id);
  if (!groupId) {
    return null;
  }

  const timestamp = nowIso();
  const createdAt = normalizeIsoFromUnknown(group.createdAt) ?? timestamp;
  const updatedAt = normalizeIsoFromUnknown(group.updatedAt) ?? timestamp;
  const leaderId =
    normalizeOptionalText(group.leaderId) ??
    normalizeOptionalText(group.owner_agent_id) ??
    normalizeOptionalText(group.ownerAgentId);
  const members = Array.isArray(group.members) ? group.members : [];
  const uniqueMembers = new Map<string, StorageGroupMemberRow>();

  for (const item of members) {
    if (!isRecord(item)) {
      continue;
    }

    const agentId =
      normalizeText(item.id) ||
      normalizeText(item.agentId) ||
      normalizeText(item.agent_id) ||
      normalizeText(item.userId) ||
      normalizeText(item.user_id);
    if (!agentId) {
      continue;
    }

    const role =
      leaderId && agentId === leaderId
        ? "owner"
        : normalizeText(item.role).toLowerCase() === "owner"
          ? "owner"
          : "member";
    const memberCreatedAt = normalizeIsoFromUnknown(item.createdAt) ?? createdAt;
    const memberUpdatedAt = normalizeIsoFromUnknown(item.updatedAt) ?? updatedAt;

    uniqueMembers.set(agentId, {
      group_id: groupId,
      agent_id: agentId,
      role,
      created_at: memberCreatedAt,
      updated_at: memberUpdatedAt,
    });
  }

  if (leaderId && !uniqueMembers.has(leaderId)) {
    uniqueMembers.set(leaderId, {
      group_id: groupId,
      agent_id: leaderId,
      role: "owner",
      created_at: createdAt,
      updated_at: updatedAt,
    });
  }

  return {
    id: groupId,
    row: {
      id: groupId,
      name: normalizeOptionalText(group.name),
      icon:
        normalizeOptionalText(group.avatarUrl) ??
        normalizeOptionalText(group.icon) ??
        normalizeOptionalText(group.avatar),
      description: normalizeOptionalText(group.description),
      owner_agent_id: leaderId,
      announcement: normalizeOptionalText(group.announcement),
      announcement_version: normalizeInteger(group.announcementVersion),
      notifications_enabled: normalizeBooleanInteger(group.notificationsEnabled, 1),
      sound_enabled: normalizeBooleanInteger(group.soundEnabled, 1),
      urge_enabled: normalizeBooleanInteger(group.isUrging),
      urge_paused: normalizeBooleanInteger(group.isUrgePaused),
      urge_interval:
        normalizeInteger(group.urgeIntervalMinutes, 0) > 0
          ? normalizeInteger(group.urgeIntervalMinutes, 0)
          : null,
      urge_started_at: normalizeIsoFromUnknown(group.urgeStartedAt),
      urge_count: Math.max(0, normalizeInteger(group.urgeCount)),
      urge_no_response_count: Math.max(0, normalizeInteger(group.urgeNoResponseCount)),
      urge_last_checked_at: normalizeIsoFromUnknown(group.urgeLastCheckedAt),
      last_urge_at: normalizeIsoFromUnknown(group.lastUrgeAt),
      urge_stop_reason: normalizeOptionalText(group.urgeStopReason),
      max_rounds: Math.max(1, normalizeInteger(group.maxRounds, 20)),
      created_at: createdAt,
      updated_at: updatedAt,
    },
    members: [...uniqueMembers.values()],
  };
}

function buildMirroredArchive(archive: unknown): NormalizedMirroredArchive | null {
  if (!isRecord(archive)) {
    return null;
  }

  const archiveId =
    normalizeText(archive.id) || normalizeText(archive.archiveId) || normalizeText(archive.groupId);
  if (!archiveId) {
    return null;
  }

  const createdAt =
    normalizeIsoFromUnknown(archive.createdAt) ??
    normalizeIsoFromUnknown(archive.archivedAt) ??
    nowIso();
  const messages = Array.isArray(archive.messages)
    ? archive.messages
    : Array.isArray(archive.history)
      ? archive.history
      : [];
  const groupId =
    normalizeOptionalText(archive.groupId) ??
    normalizeOptionalText(archive.source_id) ??
    normalizeOptionalText(archive.sourceId) ??
    archiveId;

  return {
    id: archiveId,
    row: {
      id: archiveId,
      type: "group",
      source_id: groupId,
      source_name:
        normalizeOptionalText(archive.groupName) ??
        normalizeOptionalText(archive.source_name) ??
        normalizeOptionalText(archive.sourceName),
      title: normalizeOptionalText(archive.title),
      messages: serializeJson(messages),
      message_count: messages.length,
      archived_at: normalizeIsoFromUnknown(archive.createdAt) ?? createdAt,
      created_at: createdAt,
      updated_at: normalizeIsoFromUnknown(archive.updatedAt) ?? createdAt,
    },
  };
}

function extractMirroredSnapshot(snapshot: unknown) {
  const normalized = normalizeGroupSnapshotRecord(snapshot);
  const groups = normalized.groups
    .map(buildMirroredGroup)
    .filter((group): group is NormalizedMirroredGroup => group !== null);
  const archives = normalized.archives
    .map(buildMirroredArchive)
    .filter((archive): archive is NormalizedMirroredArchive => archive !== null);

  return {
    normalized,
    groups,
    archives,
  };
}

function mapStoredGroupRowsToSnapshot() {
  const groups = listStorageGroupRowsStmt.all().map((row) => {
    const members = listGroupMembersStmt.all({ group_id: row.id }).map((member) => ({
      id: member.agent_id,
      name: member.agent_id,
      role: member.role === "owner" ? "owner" : undefined,
    }));

    return {
      id: row.id,
      name: row.name ?? row.id,
      avatarUrl: row.icon ?? undefined,
      description: row.description ?? undefined,
      announcement: row.announcement ?? undefined,
      announcementVersion: row.announcement_version || undefined,
      notificationsEnabled: row.notifications_enabled !== 0,
      soundEnabled: row.sound_enabled !== 0,
      isUrging: row.urge_enabled !== 0,
      urgeIntervalMinutes: row.urge_interval ?? undefined,
      urgeStartedAt: row.urge_started_at ? Date.parse(row.urge_started_at) : undefined,
      urgeCount: row.urge_count || 0,
      isUrgePaused: row.urge_paused !== 0,
      urgeLastCheckedAt: row.urge_last_checked_at
        ? Date.parse(row.urge_last_checked_at)
        : undefined,
      members,
      leaderId: row.owner_agent_id ?? members[0]?.id ?? "",
      createdAt: row.created_at,
    };
  });

  const archives = listGroupArchiveRowsStmt.all().map((row) => ({
    id: row.id,
    groupId: row.source_id,
    groupName: row.source_name ?? row.source_id,
    title: row.title ?? "",
    createdAt: row.archived_at ?? row.created_at,
    messages: parseJsonSafe(row.messages, [] as unknown[]),
  }));

  return {
    groups,
    selectedGroupId: null,
    selectedArchiveId: null,
    messagesByGroupId: Object.fromEntries(groups.map((group) => [group.id, []])),
    archives,
  } satisfies GroupSnapshotRecord;
}

function syncMirroredGroups(nextGroups: NormalizedMirroredGroup[], previousGroups: Set<string>) {
  const nextGroupIds = new Set(nextGroups.map((group) => group.id));
  for (const groupId of previousGroups) {
    if (!nextGroupIds.has(groupId)) {
      deleteStorageGroupStmt.run({ id: groupId });
    }
  }

  for (const group of nextGroups) {
    const existing = getStorageGroupRowStmt.get({ id: group.id });
    if (existing) {
      updateStorageGroupStmt.run({
        ...existing,
        ...group.row,
        created_at: existing.created_at,
        updated_at: group.row.updated_at,
      });
    } else {
      insertStorageGroupStmt.run(group.row);
    }

    deleteGroupMembersForGroupStmt.run({ group_id: group.id });
    for (const member of group.members) {
      upsertGroupMemberStmt.run(member);
    }
  }
}

function syncMirroredArchives(
  nextArchives: NormalizedMirroredArchive[],
  previousArchiveIds: Set<string>,
) {
  const nextArchiveIds = new Set(nextArchives.map((archive) => archive.id));
  for (const archiveId of previousArchiveIds) {
    if (!nextArchiveIds.has(archiveId)) {
      logArchiveDelete(archiveId, "syncMirroredArchives: deleting removed archive");
      deleteArchiveStmt.run({ id: archiveId });
    }
  }

  for (const archive of nextArchives) {
    const existing = getArchiveRowStmt.get({ id: archive.id });
    if (existing) {
      logArchiveUpsert(
        {
          ...existing,
          ...archive.row,
          created_at: existing.created_at,
          updated_at: archive.row.updated_at,
        },
        "syncMirroredArchives: updating existing",
      );
      upsertArchiveStmt.run({
        ...existing,
        ...archive.row,
        created_at: existing.created_at,
        updated_at: archive.row.updated_at,
      });
      continue;
    }

    logArchiveUpsert(archive.row, "syncMirroredArchives: inserting new");
    upsertArchiveStmt.run(archive.row);
  }
}

function readStoredGroupSnapshot(userId: string) {
  const setting = readSettingValue(getGroupSnapshotSettingKey(userId));
  if (!setting) {
    return {
      userId,
      snapshot: null,
      updated_at: null,
      source: "empty" as const,
    };
  }

  return {
    userId,
    snapshot: normalizeGroupSnapshotRecord(parseJsonSafe(setting.value, {})),
    updated_at: setting.updated_at,
    source: "settings" as const,
  };
}

function assertUserId(userId: string) {
  if (!userId.trim()) {
    throw new ApiError(400, "userId 不能为空");
  }

  return userId.trim();
}

function readResolvedUserProfile(userId: string) {
  let sharedRow = getUserStmt.get({ id: userId });
  if (!isSharedStorageUserId(userId)) {
    return {
      userId,
      row: sharedRow,
      source: sharedRow ? "direct" : "empty",
    } as const;
  }

  const fallbackRow = getLatestLegacyUserProfileRow();
  if (fallbackRow && isNewerTimestamp(fallbackRow.updated_at, sharedRow?.updated_at)) {
    upsertUserStmt.run({
      ...fallbackRow,
      id: userId,
    });
    sharedRow = getUserStmt.get({ id: userId });
    return {
      userId,
      row: sharedRow,
      source: "legacy-migrated",
    } as const;
  }

  if (sharedRow) {
    return {
      userId,
      row: sharedRow,
      source: "direct",
    } as const;
  }

  if (!fallbackRow) {
    return {
      userId,
      row: null,
      source: "empty",
    } as const;
  }

  upsertUserStmt.run({
    ...fallbackRow,
    id: userId,
  });

  return {
    userId,
    row: getUserStmt.get({ id: userId }),
    source: "legacy-migrated",
  } as const;
}

function readResolvedStoredGroupSnapshot(userId: string) {
  const sharedSettingKey = getGroupSnapshotSettingKey(userId);
  let sharedSnapshot = readStoredGroupSnapshot(userId);
  if (!isSharedStorageUserId(userId)) {
    return {
      ...sharedSnapshot,
      source: sharedSnapshot.snapshot ? sharedSnapshot.source : "empty",
    } as const;
  }

  const legacySetting = getLatestLegacyGroupSnapshotSetting();
  if (legacySetting && isNewerTimestamp(legacySetting.updated_at, sharedSnapshot.updated_at)) {
    const existingSharedSetting = readSettingValue(sharedSettingKey);
    upsertSettingStmt.run({
      key: sharedSettingKey,
      value: legacySetting.value,
      created_at: existingSharedSetting?.created_at ?? legacySetting.created_at,
      updated_at: legacySetting.updated_at,
    });
    sharedSnapshot = readStoredGroupSnapshot(userId);
    return {
      ...sharedSnapshot,
      source: "legacy-migrated" as const,
    };
  }

  if (sharedSnapshot.snapshot) {
    return {
      ...sharedSnapshot,
      source: sharedSnapshot.source,
    } as const;
  }

  if (!legacySetting) {
    return {
      ...sharedSnapshot,
      source: "empty" as const,
    };
  }

  upsertSettingStmt.run({
    key: getGroupSnapshotSettingKey(userId),
    value: legacySetting.value,
    created_at: legacySetting.created_at,
    updated_at: legacySetting.updated_at,
  });

  return {
    ...readStoredGroupSnapshot(userId),
    source: "legacy-migrated" as const,
  };
}

function assertAgentId(agentId: string, label = "agentId") {
  if (!agentId.trim()) {
    throw new ApiError(400, `${label} 不能为空`);
  }

  return agentId.trim();
}

export const storageService = {
  health() {
    return {
      ok: true as const,
      updated_at: nowIso(),
    };
  },

  getUserProfile(userId: string) {
    const normalizedUserId = assertUserId(userId);
    const resolved = readResolvedUserProfile(normalizedUserId);
    const existing = resolved.row;
    return {
      userId: normalizedUserId,
      name: existing?.name ?? null,
      avatar: existing?.avatar ?? null,
      created_at: existing?.created_at ?? null,
      updated_at: existing?.updated_at ?? null,
      source: resolved.source,
    };
  },

  upsertUserProfile(userId: string, payload: { name?: unknown; avatar?: unknown }) {
    const normalizedUserId = assertUserId(userId);
    const existing = getUserStmt.get({ id: normalizedUserId });
    const timestamp = nowIso();
    upsertUserStmt.run({
      id: normalizedUserId,
      name:
        payload.name !== undefined ? normalizeOptionalText(payload.name) : (existing?.name ?? null),
      avatar:
        payload.avatar !== undefined
          ? normalizeOptionalText(payload.avatar)
          : (existing?.avatar ?? null),
      created_at: existing?.created_at ?? timestamp,
      updated_at: timestamp,
    });
    return this.getUserProfile(normalizedUserId);
  },

  deleteUserProfile(userId: string) {
    const normalizedUserId = assertUserId(userId);
    deleteUserStmt.run({ id: normalizedUserId });
    return {
      success: true as const,
      userId: normalizedUserId,
    };
  },

  listAgentAvatars() {
    return Object.fromEntries(
      listAgentAvatarRowsStmt.all().map((row) => [row.agent_id, row.avatar]),
    ) as Record<string, string>;
  },

  upsertAgentAvatar(agentId: string, avatar: unknown) {
    const normalizedAgentId = assertAgentId(agentId);
    const normalizedAvatar = normalizeText(avatar);
    if (!normalizedAvatar) {
      throw new ApiError(400, "avatar 不能为空");
    }

    upsertAgentAvatarStmt.run({
      agent_id: normalizedAgentId,
      avatar: normalizedAvatar,
      updated_at: nowIso(),
    });
    return this.listAgentAvatars();
  },

  replaceAgentAvatars(items: Record<string, unknown>) {
    runTransaction(() => {
      for (const [agentId, avatar] of Object.entries(items)) {
        const normalizedAgentId = normalizeText(agentId);
        const normalizedAvatar = normalizeText(avatar);
        if (!normalizedAgentId || !normalizedAvatar) {
          continue;
        }

        upsertAgentAvatarStmt.run({
          agent_id: normalizedAgentId,
          avatar: normalizedAvatar,
          updated_at: nowIso(),
        });
      }
    });
    return this.listAgentAvatars();
  },

  deleteAgentAvatar(agentId: string) {
    const normalizedAgentId = assertAgentId(agentId);
    deleteAgentAvatarStmt.run({ agent_id: normalizedAgentId });
    return {
      success: true as const,
      agentId: normalizedAgentId,
    };
  },

  listChannelConfigs() {
    return Object.fromEntries(
      listChannelConfigRowsStmt.all().map((row) => [row.agent_id, parseJsonSafe(row.config, {})]),
    ) as Record<string, unknown>;
  },

  getChannelConfig(agentId: string) {
    const normalizedAgentId = assertAgentId(agentId);
    const row = getChannelConfigStmt.get({ agent_id: normalizedAgentId });
    return {
      agentId: normalizedAgentId,
      config: row ? parseJsonSafe(row.config, {}) : null,
      updated_at: row?.updated_at ?? null,
    };
  },

  upsertChannelConfig(agentId: string, config: unknown) {
    const normalizedAgentId = assertAgentId(agentId);
    if (!isRecord(config)) {
      throw new ApiError(400, "config 必须是对象");
    }

    upsertChannelConfigStmt.run({
      agent_id: normalizedAgentId,
      config: serializeJson(config),
      updated_at: nowIso(),
    });
    return this.getChannelConfig(normalizedAgentId);
  },

  deleteChannelConfig(agentId: string) {
    const normalizedAgentId = assertAgentId(agentId);
    deleteChannelConfigStmt.run({ agent_id: normalizedAgentId });
    return {
      success: true as const,
      agentId: normalizedAgentId,
    };
  },

  listModelProviders() {
    return Object.fromEntries(
      listModelProviderRowsStmt.all().map((row) => [row.id, parseJsonSafe(row.config, {})]),
    ) as Record<string, unknown>;
  },

  replaceModelProviders(items: Record<string, unknown>) {
    runTransaction(() => {
      clearModelProvidersStmt.run();
      for (const [providerId, config] of Object.entries(items)) {
        const normalizedProviderId = normalizeText(providerId);
        if (!normalizedProviderId || !isRecord(config)) {
          continue;
        }

        upsertModelProviderStmt.run({
          id: normalizedProviderId,
          config: serializeJson(config),
          updated_at: nowIso(),
        });
      }
    });
    return this.listModelProviders();
  },

  upsertModelProvider(providerId: string, config: unknown) {
    const normalizedProviderId = normalizeText(providerId);
    if (!normalizedProviderId) {
      throw new ApiError(400, "providerId 不能为空");
    }

    if (!isRecord(config)) {
      throw new ApiError(400, "config 必须是对象");
    }

    upsertModelProviderStmt.run({
      id: normalizedProviderId,
      config: serializeJson(config),
      updated_at: nowIso(),
    });
    return this.listModelProviders();
  },

  deleteModelProvider(providerId?: string) {
    const normalizedProviderId = providerId ? normalizeText(providerId) : "";
    if (normalizedProviderId) {
      deleteModelProviderStmt.run({ id: normalizedProviderId });
      return {
        success: true as const,
        providerId: normalizedProviderId,
      };
    }

    clearModelProvidersStmt.run();
    return {
      success: true as const,
      providerId: null,
    };
  },

  getGroups(userId: string) {
    const normalizedUserId = assertUserId(userId);
    const stored = readResolvedStoredGroupSnapshot(normalizedUserId);
    if (stored.snapshot) {
      return stored;
    }

    return {
      userId: normalizedUserId,
      snapshot: mapStoredGroupRowsToSnapshot(),
      updated_at: null,
      source: "derived" as const,
    };
  },

  putGroups(userId: string, snapshot: unknown) {
    const normalizedUserId = assertUserId(userId);
    const previous = readResolvedStoredGroupSnapshot(normalizedUserId);
    const previousExtracted = extractMirroredSnapshot(previous.snapshot);
    const nextExtracted = extractMirroredSnapshot(snapshot);

    runTransaction(() => {
      writeSettingValue(getGroupSnapshotSettingKey(normalizedUserId), nextExtracted.normalized);
      syncMirroredGroups(
        nextExtracted.groups,
        new Set(previousExtracted.groups.map((group) => group.id)),
      );
      syncMirroredArchives(
        nextExtracted.archives,
        new Set(previousExtracted.archives.map((archive) => archive.id)),
      );
    });

    return this.getGroups(normalizedUserId);
  },

  deleteGroups(userId: string, groupId?: string) {
    const normalizedUserId = assertUserId(userId);
    const current = readResolvedStoredGroupSnapshot(normalizedUserId);
    const normalizedGroupId = normalizeText(groupId ?? "");
    if (!current.snapshot) {
      return {
        success: true as const,
        userId: normalizedUserId,
        groupId: normalizedGroupId || null,
      };
    }

    if (!normalizedGroupId) {
      const extracted = extractMirroredSnapshot(current.snapshot);
      runTransaction(() => {
        deleteSettingValue(getGroupSnapshotSettingKey(normalizedUserId));
        for (const group of extracted.groups) {
          deleteStorageGroupStmt.run({ id: group.id });
        }
        for (const archive of extracted.archives) {
          logArchiveDelete(archive.id, "deleteGroups: deleting all archives for group");
          deleteArchiveStmt.run({ id: archive.id });
        }
      });
      return {
        success: true as const,
        userId: normalizedUserId,
        groupId: null,
      };
    }

    const next = normalizeGroupSnapshotRecord(current.snapshot);
    next.groups = next.groups.filter((group) => {
      if (!isRecord(group)) {
        return true;
      }

      return normalizeText(group.id) !== normalizedGroupId;
    });
    next.archives = next.archives.filter((archive) => {
      if (!isRecord(archive)) {
        return true;
      }

      const archiveGroupId =
        normalizeText(archive.groupId) ||
        normalizeText(archive.source_id) ||
        normalizeText(archive.sourceId);
      return archiveGroupId !== normalizedGroupId;
    });
    delete next.messagesByGroupId[normalizedGroupId];
    if (next.selectedGroupId === normalizedGroupId) {
      next.selectedGroupId = null;
    }

    return this.putGroups(normalizedUserId, next);
  },
};
