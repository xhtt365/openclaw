import { Router } from "express";
import { nowIso } from "../db";
import { ApiError } from "../errors";
import {
  deprecateExperience,
  getExperienceById,
  getExperiencesForInject,
  getLastFeedbackEvent,
  getProcessEvents,
  listExperienceItems,
  promoteExperience,
  rejectExperience,
  updateExperienceStatus,
  upsertExperienceCandidate,
  writeProcessEvent,
} from "../services/experienceService";
import {
  asJsonText,
  asOptionalInteger,
  asOptionalText,
  asRequiredText,
  readRouteParam,
  requireRecord,
} from "../utils";

const router = Router();

function currentTimestampText() {
  const candidate = nowIso();
  return /^\d+$/.test(candidate) ? candidate : String(Date.now());
}

function pickDefinedValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }

  return undefined;
}

function asOptionalNumber(value: unknown, label: string) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new ApiError(400, `${label}必须是数字`);
}

function asOptionalBodyText(value: unknown, label: string) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new ApiError(400, `${label}必须是字符串`);
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function asOptionalTimestampText(value: unknown, label: string) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }

    return normalized;
  }

  throw new ApiError(400, `${label}必须是字符串或数字`);
}

function asOptionalJsonField(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return asJsonText(value);
}

router.get("/events", (req, res) => {
  res.json(
    getProcessEvents({
      groupId: asOptionalText(req.query.groupId, "项目组 ID") ?? undefined,
      targetAgentId: asOptionalText(req.query.targetAgentId, "目标 Agent ID") ?? undefined,
      sessionKey: asOptionalText(req.query.sessionKey, "会话键") ?? undefined,
      limit: asOptionalInteger(req.query.limit, "limit") ?? undefined,
    }),
  );
});

router.post("/events", (req, res) => {
  const body = requireRecord(req.body);

  writeProcessEvent({
    id: asRequiredText(pickDefinedValue(body, ["id"]), "事件 ID"),
    sessionKey: asRequiredText(pickDefinedValue(body, ["session_key", "sessionKey"]), "会话键"),
    groupId: asRequiredText(pickDefinedValue(body, ["group_id", "groupId"]), "项目组 ID"),
    targetAgentId: asRequiredText(
      pickDefinedValue(body, ["target_agent_id", "targetAgentId"]),
      "目标 Agent ID",
    ),
    type:
      (asOptionalBodyText(pickDefinedValue(body, ["type"]), "事件类型") as "feedback" | null) ??
      "feedback",
    feedbackType: asRequiredText(
      pickDefinedValue(body, ["feedback_type", "feedbackType"]),
      "反馈类型",
    ) as "negative_explicit" | "positive_explicit" | "positive_weak" | "neutral",
    senderId: asRequiredText(pickDefinedValue(body, ["sender_id", "senderId"]), "发送者 ID"),
    senderName: asOptionalBodyText(
      pickDefinedValue(body, ["sender_name", "senderName"]),
      "发送者名称",
    ),
    content: asRequiredText(pickDefinedValue(body, ["content"]), "反馈内容"),
    normalizedContent: asOptionalBodyText(
      pickDefinedValue(body, ["normalized_content", "normalizedContent"]),
      "归一化内容",
    ),
    taskTypeJson: asOptionalJsonField(pickDefinedValue(body, ["task_type_json", "taskTypeJson"])),
    confidenceDelta: asOptionalNumber(
      pickDefinedValue(body, ["confidence_delta", "confidenceDelta"]),
      "置信度变化",
    ),
    createdAt:
      asOptionalTimestampText(pickDefinedValue(body, ["created_at", "createdAt"]), "创建时间") ??
      currentTimestampText(),
  });

  res.status(201).json({ success: true });
});

router.get("/events/last", (req, res) => {
  res.json(
    getLastFeedbackEvent(
      asRequiredText(req.query.groupId, "项目组 ID"),
      asRequiredText(req.query.targetAgentId, "目标 Agent ID"),
      asOptionalText(req.query.sessionKey, "会话键") ?? undefined,
    ),
  );
});

router.get("/items", (req, res) => {
  res.json(
    listExperienceItems({
      status: asOptionalText(req.query.status, "经验状态") ?? undefined,
      kind: asOptionalText(req.query.kind, "经验类型") ?? undefined,
      limit: asOptionalInteger(req.query.limit, "limit") ?? undefined,
    }),
  );
});

router.post("/items", (req, res) => {
  const body = requireRecord(req.body);
  const id = asRequiredText(pickDefinedValue(body, ["id"]), "经验 ID");
  const existed = getExperienceById(id);

  upsertExperienceCandidate({
    id,
    status: asOptionalBodyText(pickDefinedValue(body, ["status"]), "经验状态") as
      | "pending"
      | "verified"
      | "deprecated"
      | "rejected"
      | "superseded"
      | undefined,
    kind: asOptionalBodyText(pickDefinedValue(body, ["kind"]), "经验类型") as
      | "lesson"
      | "anti_pattern"
      | undefined,
    taskTypeJson: asOptionalJsonField(pickDefinedValue(body, ["task_type_json", "taskTypeJson"])),
    trigger: asOptionalBodyText(pickDefinedValue(body, ["trigger"]), "触发词"),
    rule: asOptionalBodyText(pickDefinedValue(body, ["rule"]), "经验规则") ?? undefined,
    antiPattern: asOptionalBodyText(
      pickDefinedValue(body, ["anti_pattern", "antiPattern"]),
      "反面模式",
    ),
    groupId: asOptionalBodyText(pickDefinedValue(body, ["group_id", "groupId"]), "项目组 ID"),
    sessionKey: asOptionalBodyText(pickDefinedValue(body, ["session_key", "sessionKey"]), "会话键"),
    feedbackScore: asOptionalNumber(
      pickDefinedValue(body, ["feedback_score", "feedbackScore"]),
      "反馈分数",
    ),
    repeatedHits:
      asOptionalInteger(pickDefinedValue(body, ["repeated_hits", "repeatedHits"]), "命中次数") ??
      undefined,
    confidence: asOptionalNumber(pickDefinedValue(body, ["confidence"]), "置信度") ?? undefined,
    conflictWith: asOptionalBodyText(
      pickDefinedValue(body, ["conflict_with", "conflictWith"]),
      "冲突经验 ID",
    ),
    supersededBy: asOptionalBodyText(
      pickDefinedValue(body, ["superseded_by", "supersededBy"]),
      "替代经验 ID",
    ),
    createdAt:
      asOptionalTimestampText(pickDefinedValue(body, ["created_at", "createdAt"]), "创建时间") ??
      undefined,
    updatedAt:
      asOptionalTimestampText(pickDefinedValue(body, ["updated_at", "updatedAt"]), "更新时间") ??
      currentTimestampText(),
    lastSeenAt: asOptionalTimestampText(
      pickDefinedValue(body, ["last_seen_at", "lastSeenAt"]),
      "最后命中时间",
    ),
    validFrom: asOptionalTimestampText(
      pickDefinedValue(body, ["valid_from", "validFrom"]),
      "生效时间",
    ),
    expiresAt: asOptionalTimestampText(
      pickDefinedValue(body, ["expires_at", "expiresAt"]),
      "失效时间",
    ),
    risk: asOptionalBodyText(pickDefinedValue(body, ["risk"]), "风险等级") as
      | "low"
      | "medium"
      | "high"
      | undefined,
  });

  const experience = getExperienceById(id);
  if (!experience) {
    throw new ApiError(500, "保存经验失败");
  }

  res.status(existed ? 200 : 201).json(experience);
});

router.patch("/items/:id", (req, res) => {
  const id = readRouteParam(req.params.id, "经验 ID");
  const body = requireRecord(req.body);
  const status = asRequiredText(pickDefinedValue(body, ["status"]), "经验状态");
  const updatedAt =
    asOptionalTimestampText(pickDefinedValue(body, ["updated_at", "updatedAt"]), "更新时间") ??
    currentTimestampText();

  updateExperienceStatus(id, status, updatedAt);

  const experience = getExperienceById(id);
  if (!experience) {
    throw new ApiError(500, "更新经验状态失败");
  }

  res.json(experience);
});

router.post("/items/:id/promote", (req, res) => {
  const id = readRouteParam(req.params.id, "经验 ID");
  promoteExperience(id);

  const experience = getExperienceById(id);
  if (!experience) {
    throw new ApiError(500, "晋升经验失败");
  }

  res.json(experience);
});

router.post("/items/:id/deprecate", (req, res) => {
  const id = readRouteParam(req.params.id, "经验 ID");
  deprecateExperience(id);

  const experience = getExperienceById(id);
  if (!experience) {
    throw new ApiError(500, "降级经验失败");
  }

  res.json(experience);
});

router.post("/items/:id/reject", (req, res) => {
  const id = readRouteParam(req.params.id, "经验 ID");
  rejectExperience(id);

  const experience = getExperienceById(id);
  if (!experience) {
    throw new ApiError(500, "淘汰经验失败");
  }

  res.json(experience);
});

router.get("/inject", (req, res) => {
  const groupId = asRequiredText(req.query.groupId, "项目组 ID");

  res.json(
    getExperiencesForInject({
      agentId: asOptionalText(req.query.agentId, "Agent ID") ?? undefined,
      groupId,
      taskType: asOptionalText(req.query.taskType, "任务类型") ?? undefined,
      limit: asOptionalInteger(req.query.limit, "limit") ?? undefined,
    }),
  );
});

export default router;
