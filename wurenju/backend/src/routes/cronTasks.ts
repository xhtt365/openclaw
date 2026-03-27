import { Router } from "express";
import { db, nowIso, type CronTaskRow } from "../db";
import { ApiError } from "../errors";
import { asOptionalText, asRequiredText, readRouteParam, requireRecord } from "../utils";

type CronTaskMutationParams = {
  id: string;
  agent_id: string | null;
  name: string | null;
  reply_mode: string | null;
  reply_target_id: string | null;
  display_status: string | null;
  created_at: string;
  updated_at: string;
};

const router = Router();

const listCronTasksStmt = db.prepare<[], CronTaskRow>(`
  SELECT
    id,
    agent_id,
    name,
    reply_mode,
    reply_target_id,
    display_status,
    created_at,
    updated_at
  FROM cron_tasks
  ORDER BY updated_at DESC, id ASC
`);

const listCronTasksByAgentStmt = db.prepare<{ agent_id: string }, CronTaskRow>(`
  SELECT
    id,
    agent_id,
    name,
    reply_mode,
    reply_target_id,
    display_status,
    created_at,
    updated_at
  FROM cron_tasks
  WHERE agent_id = @agent_id
  ORDER BY updated_at DESC, id ASC
`);

const getCronTaskStmt = db.prepare<{ id: string }, CronTaskRow>(`
  SELECT
    id,
    agent_id,
    name,
    reply_mode,
    reply_target_id,
    display_status,
    created_at,
    updated_at
  FROM cron_tasks
  WHERE id = @id
`);

const insertCronTaskStmt = db.prepare<CronTaskMutationParams>(`
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
`);

const updateCronTaskStmt = db.prepare<CronTaskMutationParams>(`
  UPDATE cron_tasks
  SET
    agent_id = @agent_id,
    name = @name,
    reply_mode = @reply_mode,
    reply_target_id = @reply_target_id,
    display_status = @display_status,
    updated_at = @updated_at
  WHERE id = @id
`);

const deleteCronTaskStmt = db.prepare<{ id: string }>(`
  DELETE FROM cron_tasks
  WHERE id = @id
`);

function normalizeReplyMode(value: unknown) {
  const normalized = asOptionalText(value, "回复模式");
  if (normalized === null) {
    return null;
  }

  const mode = normalized.toLowerCase();
  if (mode !== "direct" && mode !== "group" && mode !== "silent") {
    throw new ApiError(400, "回复模式只能是 direct、group 或 silent");
  }

  return mode;
}

router.get("/", (req, res) => {
  const agentId = typeof req.query.agent_id === "string" ? req.query.agent_id.trim() : "";
  if (!agentId) {
    res.json(listCronTasksStmt.all());
    return;
  }

  res.json(listCronTasksByAgentStmt.all({ agent_id: agentId }));
});

router.get("/:id", (req, res) => {
  const id = readRouteParam(req.params.id, "任务 ID");
  const task = getCronTaskStmt.get({ id });
  if (!task) {
    throw new ApiError(404, "定时任务不存在");
  }

  res.json(task);
});

router.post("/", (req, res) => {
  const body = requireRecord(req.body);
  const id = asRequiredText(body.id, "任务 ID");
  if (getCronTaskStmt.get({ id })) {
    throw new ApiError(409, "定时任务已存在");
  }

  const createdAt = nowIso();
  const payload: CronTaskMutationParams = {
    id,
    agent_id: asOptionalText(body.agent_id ?? body.agentId, "员工 ID"),
    name: asOptionalText(body.name, "任务名称"),
    reply_mode: normalizeReplyMode(body.reply_mode ?? body.replyMode),
    reply_target_id: asOptionalText(body.reply_target_id ?? body.replyTargetId, "回复目标 ID"),
    display_status: asOptionalText(body.display_status ?? body.displayStatus, "显示状态"),
    created_at: createdAt,
    updated_at: createdAt,
  };

  insertCronTaskStmt.run(payload);

  res.status(201).json(getCronTaskStmt.get({ id }));
});

router.put("/:id", (req, res) => {
  const id = readRouteParam(req.params.id, "任务 ID");
  const current = getCronTaskStmt.get({ id });
  if (!current) {
    throw new ApiError(404, "定时任务不存在");
  }

  const body = requireRecord(req.body);
  const payload: CronTaskMutationParams = {
    ...current,
    agent_id:
      body.agent_id !== undefined || body.agentId !== undefined
        ? asOptionalText(body.agent_id ?? body.agentId, "员工 ID")
        : current.agent_id,
    name: body.name !== undefined ? asOptionalText(body.name, "任务名称") : current.name,
    reply_mode:
      body.reply_mode !== undefined || body.replyMode !== undefined
        ? normalizeReplyMode(body.reply_mode ?? body.replyMode)
        : current.reply_mode,
    reply_target_id:
      body.reply_target_id !== undefined || body.replyTargetId !== undefined
        ? asOptionalText(body.reply_target_id ?? body.replyTargetId, "回复目标 ID")
        : current.reply_target_id,
    display_status:
      body.display_status !== undefined || body.displayStatus !== undefined
        ? asOptionalText(body.display_status ?? body.displayStatus, "显示状态")
        : current.display_status,
    updated_at: nowIso(),
  };

  updateCronTaskStmt.run(payload);

  res.json(getCronTaskStmt.get({ id }));
});

router.delete("/:id", (req, res) => {
  const id = readRouteParam(req.params.id, "任务 ID");
  const current = getCronTaskStmt.get({ id });
  if (!current) {
    throw new ApiError(404, "定时任务不存在");
  }

  deleteCronTaskStmt.run({ id });
  res.json({ success: true });
});

export default router;
