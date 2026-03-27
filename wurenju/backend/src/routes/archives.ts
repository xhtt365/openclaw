import { Router } from "express";
import { ARCHIVE_TOMBSTONE_SQLITE_ERROR, db, nowIso, type ArchiveRow } from "../db";
import { ApiError } from "../errors";
import {
  asJsonText,
  asOptionalInteger,
  asOptionalText,
  asRequiredText,
  parseStoredJson,
  readRouteParam,
  requireRecord,
} from "../utils";

type ArchiveMutationParams = {
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

const router = Router();

const listArchivesBaseSql = `
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
`;

const listArchivesStmt = db.prepare<[], ArchiveRow>(`
  ${listArchivesBaseSql}
  ORDER BY COALESCE(archived_at, updated_at) DESC, id ASC
`);

const listArchivesByTypeStmt = db.prepare<{ type: string }, ArchiveRow>(`
  ${listArchivesBaseSql}
  WHERE type = @type
  ORDER BY COALESCE(archived_at, updated_at) DESC, id ASC
`);

const getArchiveStmt = db.prepare<{ id: string }, ArchiveRow>(`
  ${listArchivesBaseSql}
  WHERE id = @id
`);

const getDirectArchiveTombstoneStmt = db.prepare<{ id: string }, { id: string }>(`
  SELECT id
  FROM archive_tombstones
  WHERE id = @id
    AND type = 'direct'
`);

const insertArchiveStmt = db.prepare<ArchiveMutationParams>(`
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
`);

const updateArchiveTitleStmt = db.prepare<{
  id: string;
  title: string;
  updated_at: string;
}>(`
  UPDATE archives
  SET
    title = @title,
    updated_at = @updated_at
  WHERE id = @id
`);

const deleteArchiveStmt = db.prepare<{ id: string }>(`
  DELETE FROM archives
  WHERE id = @id
`);

function normalizeArchiveType(value: unknown) {
  const type = asRequiredText(value, "归档类型").toLowerCase();
  if (type !== "direct" && type !== "group") {
    throw new ApiError(400, "归档类型只能是 direct 或 group");
  }

  return type;
}

function formatArchiveRow(row: ArchiveRow) {
  return {
    ...row,
    messages: parseStoredJson(row.messages, []),
  };
}

function isArchiveTombstoneConflict(error: unknown) {
  return error instanceof Error && error.message.includes(ARCHIVE_TOMBSTONE_SQLITE_ERROR);
}

router.get("/", (req, res) => {
  const type = typeof req.query.type === "string" ? req.query.type.trim().toLowerCase() : "";
  if (!type) {
    res.json(listArchivesStmt.all().map(formatArchiveRow));
    return;
  }

  if (type !== "direct" && type !== "group") {
    throw new ApiError(400, "type 只能是 direct 或 group");
  }

  res.json(listArchivesByTypeStmt.all({ type }).map(formatArchiveRow));
});

router.get("/:id", (req, res) => {
  const id = readRouteParam(req.params.id, "归档 ID");
  const archive = getArchiveStmt.get({ id });
  if (!archive) {
    throw new ApiError(404, "归档不存在");
  }

  res.json(formatArchiveRow(archive));
});

router.post("/", (req, res) => {
  const body = requireRecord(req.body);
  const id = asRequiredText(body.id, "归档 ID");
  const normalizedType = normalizeArchiveType(body.type);
  const rawSourceId = body.source_id ?? body.sourceId;
  const sourceIdForLog =
    typeof rawSourceId === "string" && rawSourceId.trim() ? rawSourceId.trim() : "<missing>";
  console.log(
    `[BackendArchive] POST /api/archives: id=${id}, type=${normalizedType}, source_id=${sourceIdForLog}, timestamp=${new Date().toISOString()}`,
  );
  if (getArchiveStmt.get({ id })) {
    console.log(`[BackendArchive] POST /api/archives: CONFLICT - archive ${id} already exists`);
    throw new ApiError(409, "归档已存在");
  }

  if (normalizedType === "direct" && getDirectArchiveTombstoneStmt.get({ id })) {
    console.log(
      `[BackendArchive] POST /api/archives: TOMBSTONED direct archive ${id}, skip recreate`,
    );
    throw new ApiError(409, "归档已删除，不能重建");
  }

  const messagesText = asJsonText(body.messages);
  const messageCount =
    asOptionalInteger(body.message_count ?? body.messageCount, "消息数量") ??
    (Array.isArray(body.messages) ? body.messages.length : 0);
  const createdAt = nowIso();

  const payload: ArchiveMutationParams = {
    id,
    type: normalizedType,
    source_id: asRequiredText(body.source_id ?? body.sourceId, "来源 ID"),
    source_name: asOptionalText(body.source_name ?? body.sourceName, "来源名称"),
    title: asOptionalText(body.title, "归档标题"),
    messages: messagesText,
    message_count: messageCount,
    archived_at: asOptionalText(body.archived_at ?? body.archivedAt, "归档时间"),
    created_at: createdAt,
    updated_at: createdAt,
  };

  try {
    insertArchiveStmt.run(payload);
  } catch (error) {
    if (normalizedType === "direct" && isArchiveTombstoneConflict(error)) {
      console.log(
        `[BackendArchive] POST /api/archives: TOMBSTONE CONFLICT during insert for ${id}`,
      );
      throw new ApiError(409, "归档已删除，不能重建");
    }

    throw error;
  }
  console.log(`[BackendArchive] POST /api/archives: INSERTED id=${id}, type=${normalizedType}`);

  const archive = getArchiveStmt.get({ id });
  if (!archive) {
    throw new ApiError(500, "创建归档失败");
  }

  res.status(201).json(formatArchiveRow(archive));
});

router.put("/:id", (req, res) => {
  const id = readRouteParam(req.params.id, "归档 ID");
  const current = getArchiveStmt.get({ id });
  if (!current) {
    throw new ApiError(404, "归档不存在");
  }

  const body = requireRecord(req.body);
  const title = asRequiredText(body.title, "归档标题");

  updateArchiveTitleStmt.run({
    id,
    title,
    updated_at: nowIso(),
  });

  const archive = getArchiveStmt.get({ id });
  if (!archive) {
    throw new ApiError(500, "更新归档失败");
  }

  res.json(formatArchiveRow(archive));
});

router.delete("/:id", (req, res) => {
  const id = readRouteParam(req.params.id, "归档 ID");
  console.log(
    `[BackendArchive] DELETE /api/archives/:id: id=${id}, timestamp=${new Date().toISOString()}`,
  );
  const current = getArchiveStmt.get({ id });
  if (!current) {
    console.log(
      `[BackendArchive] DELETE /api/archives/:id: NOT FOUND - archive ${id} does not exist`,
    );
    throw new ApiError(404, "归档不存在");
  }
  console.log(
    `[BackendArchive] DELETE /api/archives/:id: FOUND, type=${current.type}, source_id=${current.source_id}, about to DELETE`,
  );
  deleteArchiveStmt.run({ id });
  console.log(`[BackendArchive] DELETE /api/archives/:id: DELETED id=${id}`);
  res.json({ success: true });
});

export default router;
