import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

export type TimestampedRow = {
  created_at: string;
  updated_at: string;
};

export type EmployeeRow = TimestampedRow & {
  id: string;
  name: string | null;
  avatar: string | null;
  position: string | null;
  department: string | null;
  description: string | null;
  pinned: number;
  sort_order: number;
};

export type DepartmentRow = TimestampedRow & {
  id: string;
  name: string | null;
  icon: string | null;
  sort_order: number;
};

export type GroupRow = TimestampedRow & {
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
};

export type GroupMemberRow = TimestampedRow & {
  group_id: string;
  agent_id: string;
  role: string;
};

export type GroupWithMembersRow = GroupRow & {
  members: GroupMemberRow[];
};

export type ArchiveRow = TimestampedRow & {
  id: string;
  type: string;
  source_id: string;
  source_name: string | null;
  title: string | null;
  messages: string | null;
  message_count: number | null;
  archived_at: string | null;
};

export const ARCHIVE_TOMBSTONE_SQLITE_ERROR = "archive tombstoned";

export type CronTaskRow = TimestampedRow & {
  id: string;
  agent_id: string | null;
  name: string | null;
  reply_mode: string | null;
  reply_target_id: string | null;
  display_status: string | null;
};

export type SettingRow = TimestampedRow & {
  key: string;
  value: string | null;
};

const databaseDir = path.join(os.homedir(), ".xiaban");
export const databaseFile = path.join(databaseDir, "data.db");

if (!fs.existsSync(databaseDir)) {
  fs.mkdirSync(databaseDir, { recursive: true });
  console.log(`[DB] 已创建数据目录: ${databaseDir}`);
}

export const db = new Database(databaseFile);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    name TEXT,
    avatar TEXT,
    position TEXT,
    department TEXT,
    description TEXT,
    pinned INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    name TEXT,
    icon TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT,
    icon TEXT,
    description TEXT,
    owner_agent_id TEXT,
    announcement TEXT,
    announcement_version INTEGER DEFAULT 0,
    urge_enabled INTEGER DEFAULT 0,
    urge_paused INTEGER DEFAULT 0,
    urge_interval INTEGER,
    urge_count INTEGER DEFAULT 0,
    urge_no_response_count INTEGER DEFAULT 0,
    urge_last_checked_at TEXT,
    last_urge_at TEXT,
    urge_stop_reason TEXT,
    max_rounds INTEGER DEFAULT 20,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (group_id, agent_id),
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS archives (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_name TEXT,
    title TEXT,
    messages TEXT,
    message_count INTEGER,
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS archive_tombstones (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    deleted_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cron_tasks (
    id TEXT PRIMARY KEY,
    agent_id TEXT,
    name TEXT,
    reply_mode TEXT,
    reply_target_id TEXT,
    display_status TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_employees_pinned_sort_order
  ON employees(pinned DESC, sort_order DESC);

  CREATE INDEX IF NOT EXISTS idx_departments_sort_order
  ON departments(sort_order ASC);

  CREATE INDEX IF NOT EXISTS idx_group_members_group_id
  ON group_members(group_id);

  CREATE INDEX IF NOT EXISTS idx_group_members_agent_id
  ON group_members(agent_id);

  CREATE INDEX IF NOT EXISTS idx_archives_type
  ON archives(type);

  CREATE INDEX IF NOT EXISTS idx_archives_source_id
  ON archives(source_id);

  CREATE INDEX IF NOT EXISTS idx_archive_tombstones_type
  ON archive_tombstones(type);

  CREATE INDEX IF NOT EXISTS idx_cron_tasks_agent_id
  ON cron_tasks(agent_id);

  CREATE TRIGGER IF NOT EXISTS tombstone_direct_archives_after_delete
  AFTER DELETE ON archives
  FOR EACH ROW
  WHEN OLD.type = 'direct'
  BEGIN
    INSERT INTO archive_tombstones (
      id,
      type,
      source_id,
      deleted_at
    ) VALUES (
      OLD.id,
      OLD.type,
      OLD.source_id,
      STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
    )
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type,
      source_id = excluded.source_id,
      deleted_at = excluded.deleted_at;
  END;

  CREATE TRIGGER IF NOT EXISTS block_tombstoned_direct_archive_insert
  BEFORE INSERT ON archives
  FOR EACH ROW
  WHEN NEW.type = 'direct'
    AND EXISTS (
      SELECT 1
      FROM archive_tombstones
      WHERE id = NEW.id
    )
  BEGIN
    SELECT RAISE(ABORT, 'archive tombstoned');
  END;
`);

type TableColumnInfoRow = {
  name: string;
};

function ensureGroupsColumn(columnName: string, definition: string) {
  const columns = db.prepare<[], TableColumnInfoRow>("PRAGMA table_info(groups)").all();
  if (columns.some((column) => column.name === columnName)) {
    return false;
  }

  db.exec(`ALTER TABLE groups ADD COLUMN ${columnName} ${definition}`);
  console.log(`[DB] 已为 groups 表补充字段: ${columnName}`);
  return true;
}

const didAddLegacyGroupColumns = [
  ensureGroupsColumn("urge_paused", "INTEGER DEFAULT 0"),
  ensureGroupsColumn("urge_count", "INTEGER DEFAULT 0"),
  ensureGroupsColumn("urge_no_response_count", "INTEGER DEFAULT 0"),
  ensureGroupsColumn("urge_last_checked_at", "TEXT"),
  ensureGroupsColumn("last_urge_at", "TEXT"),
  ensureGroupsColumn("urge_stop_reason", "TEXT"),
].some(Boolean);

if (didAddLegacyGroupColumns) {
  db.pragma("wal_checkpoint(PASSIVE)");
}

console.log(`[DB] 已连接数据库: ${databaseFile}`);
console.log("[DB] 已完成数据表初始化");

const listGroupRowsStmt = db.prepare<[], GroupRow>(`
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
  ORDER BY created_at DESC, id ASC
`);

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

const getGroupMembersByIdStmt = db.prepare<{ group_id: string }, GroupMemberRow>(`
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

export function nowIso() {
  return new Date().toISOString();
}

function getGroupMembersMap(groupIds: string[]) {
  const membersMap = new Map<string, GroupMemberRow[]>();
  if (groupIds.length === 0) {
    return membersMap;
  }

  const placeholders = groupIds.map(() => "?").join(", ");
  const statement = db.prepare(`
    SELECT
      group_id,
      agent_id,
      role,
      created_at,
      updated_at
    FROM group_members
    WHERE group_id IN (${placeholders})
    ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END, created_at ASC, agent_id ASC
  `);

  const members = statement.all(...(groupIds as [string, ...string[]])) as GroupMemberRow[];
  for (const member of members) {
    const current = membersMap.get(member.group_id) ?? [];
    current.push(member);
    membersMap.set(member.group_id, current);
  }

  return membersMap;
}

export function listGroupsWithMembers() {
  const groups = listGroupRowsStmt.all();
  const membersMap = getGroupMembersMap(groups.map((group) => group.id));

  return groups.map((group) => ({
    ...group,
    members: membersMap.get(group.id) ?? [],
  })) satisfies GroupWithMembersRow[];
}

export function getGroupWithMembers(groupId: string) {
  const group = getGroupRowStmt.get({ id: groupId });
  if (!group) {
    return null;
  }

  return {
    ...group,
    members: getGroupMembersByIdStmt.all({ group_id: groupId }),
  } satisfies GroupWithMembersRow;
}

export function runTransaction<T>(callback: () => T) {
  const wrapped = db.transaction(callback);
  return wrapped();
}
