import { db, nowIso, runTransaction, type ExperienceRow, type ProcessEventRow } from "../db";
import { ApiError } from "../errors";

const EXPERIENCE_STATUS = ["pending", "verified", "deprecated", "rejected", "superseded"] as const;
const EXPERIENCE_KIND = ["lesson", "anti_pattern"] as const;
const EXPERIENCE_RISK = ["low", "medium", "high"] as const;
const PROCESS_EVENT_TYPE = ["feedback"] as const;
const PROCESS_EVENT_FEEDBACK_TYPE = [
  "negative_explicit",
  "positive_explicit",
  "positive_weak",
  "neutral",
] as const;

type ExperienceStatus = (typeof EXPERIENCE_STATUS)[number];
type ExperienceKind = (typeof EXPERIENCE_KIND)[number];
type ExperienceRisk = (typeof EXPERIENCE_RISK)[number];
type ProcessEventType = (typeof PROCESS_EVENT_TYPE)[number];
type ProcessEventFeedbackType = (typeof PROCESS_EVENT_FEEDBACK_TYPE)[number];

export type ProcessEventInput = {
  id: string;
  sessionKey: string;
  groupId: string;
  targetAgentId: string;
  type: ProcessEventType;
  feedbackType: ProcessEventFeedbackType;
  senderId: string;
  senderName?: string | null;
  content: string;
  normalizedContent?: string | null;
  taskTypeJson?: string | null;
  confidenceDelta?: number | null;
  createdAt?: string;
};

export type ExperienceItemInput = {
  id: string;
  status?: ExperienceStatus;
  kind?: ExperienceKind;
  taskTypeJson?: string | null;
  trigger?: string | null;
  rule?: string;
  antiPattern?: string | null;
  groupId?: string | null;
  sessionKey?: string | null;
  feedbackScore?: number | null;
  repeatedHits?: number;
  confidence?: number;
  conflictWith?: string | null;
  supersededBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  lastSeenAt?: string | null;
  validFrom?: string | null;
  expiresAt?: string | null;
  risk?: ExperienceRisk;
};

type ProcessEventMutationParams = {
  id: string;
  session_key: string;
  group_id: string;
  target_agent_id: string;
  type: ProcessEventType;
  feedback_type: ProcessEventFeedbackType;
  sender_id: string;
  sender_name: string | null;
  content: string;
  normalized_content: string | null;
  task_type_json: string | null;
  confidence_delta: number;
  created_at: string;
};

type ExperienceMutationParams = {
  id: string;
  status: ExperienceStatus;
  kind: ExperienceKind;
  task_type_json: string | null;
  trigger: string | null;
  rule: string;
  anti_pattern: string | null;
  group_id: string | null;
  session_key: string | null;
  feedback_score: number | null;
  repeated_hits: number;
  confidence: number;
  conflict_with: string | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
  valid_from: string | null;
  expires_at: string | null;
  risk: ExperienceRisk;
};

type ProcessEventsQueryParams = {
  group_id: string | null;
  target_agent_id: string | null;
  session_key: string | null;
  limit: number;
};

type ExperienceListQueryParams = {
  status: ExperienceStatus | null;
  kind: ExperienceKind | null;
  limit: number;
};

type ExperienceInjectQueryParams = {
  group_id: string;
  agent_session_pattern: string | null;
  task_type_pattern: string | null;
  limit: number;
};

type LastFeedbackQueryParams = {
  group_id: string;
  target_agent_id: string;
  session_key: string | null;
};

const insertProcessEventStmt = db.prepare<ProcessEventMutationParams>(`
  INSERT INTO process_events (
    id,
    session_key,
    group_id,
    target_agent_id,
    type,
    feedback_type,
    sender_id,
    sender_name,
    content,
    normalized_content,
    task_type_json,
    confidence_delta,
    created_at
  ) VALUES (
    @id,
    @session_key,
    @group_id,
    @target_agent_id,
    @type,
    @feedback_type,
    @sender_id,
    @sender_name,
    @content,
    @normalized_content,
    @task_type_json,
    @confidence_delta,
    @created_at
  )
`);

const getProcessEventsStmt = db.prepare<ProcessEventsQueryParams, ProcessEventRow>(`
  SELECT
    id,
    session_key,
    group_id,
    target_agent_id,
    type,
    feedback_type,
    sender_id,
    sender_name,
    content,
    normalized_content,
    task_type_json,
    confidence_delta,
    created_at
  FROM process_events
  WHERE (@group_id IS NULL OR group_id = @group_id)
    AND (@target_agent_id IS NULL OR target_agent_id = @target_agent_id)
    AND (@session_key IS NULL OR session_key = @session_key)
  ORDER BY CAST(created_at AS INTEGER) DESC, id DESC
  LIMIT @limit
`);

const getLastFeedbackEventStmt = db.prepare<LastFeedbackQueryParams, ProcessEventRow>(`
  SELECT
    id,
    session_key,
    group_id,
    target_agent_id,
    type,
    feedback_type,
    sender_id,
    sender_name,
    content,
    normalized_content,
    task_type_json,
    confidence_delta,
    created_at
  FROM process_events
  WHERE group_id = @group_id
    AND target_agent_id = @target_agent_id
    AND (@session_key IS NULL OR session_key = @session_key)
    AND type = 'feedback'
  ORDER BY CAST(created_at AS INTEGER) DESC, id DESC
  LIMIT 1
`);

const getExperienceByIdStmt = db.prepare<{ id: string }, ExperienceRow>(`
  SELECT
    id,
    status,
    kind,
    task_type_json,
    trigger,
    rule,
    anti_pattern,
    group_id,
    session_key,
    feedback_score,
    repeated_hits,
    confidence,
    conflict_with,
    superseded_by,
    created_at,
    updated_at,
    last_seen_at,
    valid_from,
    expires_at,
    risk
  FROM experience_items
  WHERE id = @id
`);

const listExperienceItemsStmt = db.prepare<ExperienceListQueryParams, ExperienceRow>(`
  SELECT
    id,
    status,
    kind,
    task_type_json,
    trigger,
    rule,
    anti_pattern,
    group_id,
    session_key,
    feedback_score,
    repeated_hits,
    confidence,
    conflict_with,
    superseded_by,
    created_at,
    updated_at,
    last_seen_at,
    valid_from,
    expires_at,
    risk
  FROM experience_items
  WHERE (@status IS NULL OR status = @status)
    AND (@kind IS NULL OR kind = @kind)
  ORDER BY CAST(updated_at AS INTEGER) DESC, CAST(created_at AS INTEGER) DESC, id ASC
  LIMIT @limit
`);

const getExperienceItemsByStatusStmt = db.prepare<{ status: ExperienceStatus }, ExperienceRow>(`
  SELECT
    id,
    status,
    kind,
    task_type_json,
    trigger,
    rule,
    anti_pattern,
    group_id,
    session_key,
    feedback_score,
    repeated_hits,
    confidence,
    conflict_with,
    superseded_by,
    created_at,
    updated_at,
    last_seen_at,
    valid_from,
    expires_at,
    risk
  FROM experience_items
  WHERE status = @status
  ORDER BY CAST(updated_at AS INTEGER) DESC, CAST(created_at AS INTEGER) DESC, id ASC
`);

const insertExperienceItemStmt = db.prepare<ExperienceMutationParams>(`
  INSERT INTO experience_items (
    id,
    status,
    kind,
    task_type_json,
    trigger,
    rule,
    anti_pattern,
    group_id,
    session_key,
    feedback_score,
    repeated_hits,
    confidence,
    conflict_with,
    superseded_by,
    created_at,
    updated_at,
    last_seen_at,
    valid_from,
    expires_at,
    risk
  ) VALUES (
    @id,
    @status,
    @kind,
    @task_type_json,
    @trigger,
    @rule,
    @anti_pattern,
    @group_id,
    @session_key,
    @feedback_score,
    @repeated_hits,
    @confidence,
    @conflict_with,
    @superseded_by,
    @created_at,
    @updated_at,
    @last_seen_at,
    @valid_from,
    @expires_at,
    @risk
  )
`);

const updateExperienceItemStmt = db.prepare<ExperienceMutationParams>(`
  UPDATE experience_items
  SET
    status = @status,
    kind = @kind,
    task_type_json = @task_type_json,
    trigger = @trigger,
    rule = @rule,
    anti_pattern = @anti_pattern,
    group_id = @group_id,
    session_key = @session_key,
    feedback_score = @feedback_score,
    repeated_hits = @repeated_hits,
    confidence = @confidence,
    conflict_with = @conflict_with,
    superseded_by = @superseded_by,
    updated_at = @updated_at,
    last_seen_at = @last_seen_at,
    valid_from = @valid_from,
    expires_at = @expires_at,
    risk = @risk
  WHERE id = @id
`);

const updateExperienceStatusStmt = db.prepare<{
  id: string;
  status: ExperienceStatus;
  updated_at: string;
}>(`
  UPDATE experience_items
  SET
    status = @status,
    updated_at = @updated_at
  WHERE id = @id
`);

const promoteExperienceStmt = db.prepare<{ id: string; updated_at: string }>(`
  UPDATE experience_items
  SET
    status = 'verified',
    updated_at = @updated_at,
    valid_from = COALESCE(valid_from, @updated_at)
  WHERE id = @id
`);

const deprecateExperienceStmt = db.prepare<{ id: string; updated_at: string }>(`
  UPDATE experience_items
  SET
    status = 'deprecated',
    updated_at = @updated_at
  WHERE id = @id
`);

const rejectExperienceStmt = db.prepare<{ id: string; updated_at: string }>(`
  UPDATE experience_items
  SET
    status = 'rejected',
    updated_at = @updated_at
  WHERE id = @id
`);

const findConflictStmt = db.prepare<
  {
    trigger: string;
    rule: string;
    exclude_id: string | null;
  },
  ExperienceRow
>(`
  SELECT
    id,
    status,
    kind,
    task_type_json,
    trigger,
    rule,
    anti_pattern,
    group_id,
    session_key,
    feedback_score,
    repeated_hits,
    confidence,
    conflict_with,
    superseded_by,
    created_at,
    updated_at,
    last_seen_at,
    valid_from,
    expires_at,
    risk
  FROM experience_items
  WHERE trigger = @trigger
    AND rule != @rule
    AND status IN ('pending', 'verified')
    AND (@exclude_id IS NULL OR id != @exclude_id)
  ORDER BY CASE status WHEN 'verified' THEN 0 ELSE 1 END,
    confidence DESC,
    CAST(updated_at AS INTEGER) DESC,
    id ASC
  LIMIT 1
`);

const getVerifiedExperiencesForInjectStmt = db.prepare<ExperienceInjectQueryParams, ExperienceRow>(`
  SELECT
    id,
    status,
    kind,
    task_type_json,
    trigger,
    rule,
    anti_pattern,
    group_id,
    session_key,
    feedback_score,
    repeated_hits,
    confidence,
    conflict_with,
    superseded_by,
    created_at,
    updated_at,
    last_seen_at,
    valid_from,
    expires_at,
    risk
  FROM experience_items
  WHERE status = 'verified'
    AND (group_id = @group_id OR group_id IS NULL)
    AND (@agent_session_pattern IS NULL OR session_key IS NULL OR session_key LIKE @agent_session_pattern ESCAPE '\\')
    AND (@task_type_pattern IS NULL OR task_type_json IS NULL OR task_type_json LIKE @task_type_pattern ESCAPE '\\')
  ORDER BY confidence DESC,
    repeated_hits DESC,
    CAST(COALESCE(last_seen_at, updated_at, created_at) AS INTEGER) DESC,
    id ASC
  LIMIT @limit
`);

const getRecentExperiencesForInjectStmt = db.prepare<ExperienceInjectQueryParams, ExperienceRow>(`
  SELECT
    id,
    status,
    kind,
    task_type_json,
    trigger,
    rule,
    anti_pattern,
    group_id,
    session_key,
    feedback_score,
    repeated_hits,
    confidence,
    conflict_with,
    superseded_by,
    created_at,
    updated_at,
    last_seen_at,
    valid_from,
    expires_at,
    risk
  FROM experience_items
  WHERE status = 'pending'
    AND (group_id = @group_id OR group_id IS NULL)
    AND (@agent_session_pattern IS NULL OR session_key IS NULL OR session_key LIKE @agent_session_pattern ESCAPE '\\')
    AND (@task_type_pattern IS NULL OR task_type_json IS NULL OR task_type_json LIKE @task_type_pattern ESCAPE '\\')
  ORDER BY CAST(COALESCE(last_seen_at, updated_at, created_at) AS INTEGER) DESC,
    confidence DESC,
    repeated_hits DESC,
    id ASC
  LIMIT @limit
`);

function normalizeRequiredText(value: string | null | undefined, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, `${label}不能为空`);
  }

  return value.trim();
}

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeFiniteNumber(value: number | null | undefined, label: string) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Number.isFinite(value)) {
    throw new ApiError(400, `${label}必须是数字`);
  }

  return value;
}

function normalizeNonNegativeInteger(value: number | undefined, label: string, fallback: number) {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value)) {
    throw new ApiError(400, `${label}必须是数字`);
  }

  return Math.max(0, Math.trunc(value));
}

function normalizeLimit(limit: number | undefined, fallback: number) {
  if (limit === undefined) {
    return fallback;
  }

  if (!Number.isFinite(limit)) {
    throw new ApiError(400, "limit 必须是数字");
  }

  return Math.max(1, Math.min(100, Math.trunc(limit)));
}

function normalizeEnumValue<T extends readonly string[]>(
  value: string | null | undefined,
  label: string,
  allowedValues: T,
  fallback?: T[number],
) {
  if (value === undefined || value === null || !value.trim()) {
    if (fallback !== undefined) {
      return fallback;
    }

    throw new ApiError(400, `${label}不能为空`);
  }

  const normalized = value.trim().toLowerCase();
  if ((allowedValues as readonly string[]).includes(normalized)) {
    return normalized as T[number];
  }

  throw new ApiError(400, `${label}不合法`);
}

function ensureTimestampText(value: string | undefined, fallback?: string) {
  const candidate = value?.trim() || fallback;
  if (!candidate) {
    throw new ApiError(400, "时间戳不能为空");
  }

  if (!/^\d+$/.test(candidate)) {
    throw new ApiError(400, "时间戳必须是 Unix ms 字符串");
  }

  return candidate;
}

function normalizeOptionalTimestampText(value: string | null | undefined, _label: string) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }

  return ensureTimestampText(normalized, undefined);
}

function resolveOptionalTextInput(
  nextValue: string | null | undefined,
  currentValue: string | null | undefined,
) {
  if (nextValue === undefined) {
    return normalizeOptionalText(currentValue);
  }

  return normalizeOptionalText(nextValue);
}

function resolveOptionalNumberInput(
  nextValue: number | null | undefined,
  currentValue: number | null | undefined,
  label: string,
) {
  if (nextValue === undefined) {
    return normalizeFiniteNumber(currentValue, label);
  }

  return normalizeFiniteNumber(nextValue, label);
}

function resolveNonNegativeIntegerInput(
  nextValue: number | undefined,
  currentValue: number | undefined,
  label: string,
  fallback: number,
) {
  if (nextValue === undefined) {
    return normalizeNonNegativeInteger(currentValue, label, fallback);
  }

  return normalizeNonNegativeInteger(nextValue, label, fallback);
}

function resolveOptionalTimestampInput(
  nextValue: string | null | undefined,
  currentValue: string | null | undefined,
  label: string,
) {
  if (nextValue === undefined) {
    return normalizeOptionalTimestampText(currentValue, label);
  }

  return normalizeOptionalTimestampText(nextValue, label);
}

// `nowIso()` 仍被旧模块当作 ISO 字符串使用；experience 新表单独落毫秒时间戳，避免破坏现有接口。
function currentTimestampText() {
  const candidate = nowIso();
  return /^\d+$/.test(candidate) ? candidate : String(Date.now());
}

function escapeLikePattern(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function ensureExperienceExists(id: string) {
  const row = getExperienceByIdStmt.get({ id });
  if (!row) {
    throw new ApiError(404, "经验不存在");
  }

  return row;
}

export function writeProcessEvent(event: ProcessEventInput) {
  const payload: ProcessEventMutationParams = {
    id: normalizeRequiredText(event.id, "事件 ID"),
    session_key: normalizeRequiredText(event.sessionKey, "会话键"),
    group_id: normalizeRequiredText(event.groupId, "项目组 ID"),
    target_agent_id: normalizeRequiredText(event.targetAgentId, "目标 Agent ID"),
    type: normalizeEnumValue(event.type, "事件类型", PROCESS_EVENT_TYPE),
    feedback_type: normalizeEnumValue(event.feedbackType, "反馈类型", PROCESS_EVENT_FEEDBACK_TYPE),
    sender_id: normalizeRequiredText(event.senderId, "发送者 ID"),
    sender_name: normalizeOptionalText(event.senderName),
    content: normalizeRequiredText(event.content, "反馈内容"),
    normalized_content: normalizeOptionalText(event.normalizedContent),
    task_type_json: normalizeOptionalText(event.taskTypeJson),
    confidence_delta: normalizeFiniteNumber(event.confidenceDelta ?? 0, "置信度变化") ?? 0,
    created_at: ensureTimestampText(event.createdAt, currentTimestampText()),
  };

  runTransaction(() => {
    try {
      insertProcessEventStmt.run(payload);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("UNIQUE constraint failed: process_events.id")
      ) {
        throw new ApiError(409, "反馈事件已存在");
      }

      throw error;
    }
  });
}

export function getProcessEvents(params: {
  groupId?: string;
  targetAgentId?: string;
  sessionKey?: string;
  limit?: number;
}) {
  return getProcessEventsStmt.all({
    group_id: normalizeOptionalText(params.groupId),
    target_agent_id: normalizeOptionalText(params.targetAgentId),
    session_key: normalizeOptionalText(params.sessionKey),
    limit: normalizeLimit(params.limit, 50),
  });
}

export function getLastFeedbackEvent(
  groupId: string,
  targetAgentId: string,
  sessionKey?: string | null,
) {
  return (
    getLastFeedbackEventStmt.get({
      group_id: normalizeRequiredText(groupId, "项目组 ID"),
      target_agent_id: normalizeRequiredText(targetAgentId, "目标 Agent ID"),
      session_key: normalizeOptionalText(sessionKey),
    }) ?? null
  );
}

export function getExperienceById(id: string) {
  return getExperienceByIdStmt.get({ id: normalizeRequiredText(id, "经验 ID") }) ?? null;
}

export function listExperienceItems(params: { status?: string; kind?: string; limit?: number }) {
  return listExperienceItemsStmt.all({
    status:
      params.status === undefined
        ? null
        : normalizeEnumValue(params.status, "经验状态", EXPERIENCE_STATUS),
    kind:
      params.kind === undefined
        ? null
        : normalizeEnumValue(params.kind, "经验类型", EXPERIENCE_KIND),
    limit: normalizeLimit(params.limit, 50),
  });
}

export function getExperienceItemsByStatus(status: string) {
  return getExperienceItemsByStatusStmt.all({
    status: normalizeEnumValue(status, "经验状态", EXPERIENCE_STATUS),
  });
}

export function upsertExperienceCandidate(item: ExperienceItemInput) {
  const id = normalizeRequiredText(item.id, "经验 ID");

  runTransaction(() => {
    const existing = getExperienceByIdStmt.get({ id });
    const createdAt = ensureTimestampText(
      item.createdAt,
      existing?.created_at ?? currentTimestampText(),
    );
    const updatedAt = ensureTimestampText(item.updatedAt, currentTimestampText());
    const kind = normalizeEnumValue(item.kind ?? existing?.kind, "经验类型", EXPERIENCE_KIND);
    const rule = normalizeRequiredText(item.rule ?? existing?.rule, "经验规则");
    const trigger = normalizeOptionalText(item.trigger ?? existing?.trigger);
    const conflict = trigger ? findConflict(trigger, rule, id) : null;

    const payload: ExperienceMutationParams = {
      id,
      status: normalizeEnumValue(
        item.status ?? existing?.status,
        "经验状态",
        EXPERIENCE_STATUS,
        "pending",
      ),
      kind,
      task_type_json: resolveOptionalTextInput(item.taskTypeJson, existing?.task_type_json),
      trigger,
      rule,
      anti_pattern: resolveOptionalTextInput(item.antiPattern, existing?.anti_pattern),
      group_id: resolveOptionalTextInput(item.groupId, existing?.group_id),
      session_key: resolveOptionalTextInput(item.sessionKey, existing?.session_key),
      feedback_score: resolveOptionalNumberInput(
        item.feedbackScore,
        existing?.feedback_score,
        "反馈分数",
      ),
      repeated_hits: resolveNonNegativeIntegerInput(
        item.repeatedHits,
        existing?.repeated_hits,
        "命中次数",
        0,
      ),
      confidence:
        normalizeFiniteNumber(item.confidence ?? existing?.confidence ?? 0.5, "置信度") ?? 0.5,
      conflict_with:
        item.conflictWith !== undefined
          ? normalizeOptionalText(item.conflictWith)
          : (conflict?.id ?? existing?.conflict_with ?? null),
      superseded_by: resolveOptionalTextInput(item.supersededBy, existing?.superseded_by),
      created_at: createdAt,
      updated_at: updatedAt,
      last_seen_at: resolveOptionalTimestampInput(
        item.lastSeenAt,
        existing?.last_seen_at,
        "最后命中时间",
      ),
      valid_from: resolveOptionalTimestampInput(item.validFrom, existing?.valid_from, "生效时间"),
      expires_at: resolveOptionalTimestampInput(item.expiresAt, existing?.expires_at, "失效时间"),
      risk: normalizeEnumValue(item.risk ?? existing?.risk, "风险等级", EXPERIENCE_RISK, "medium"),
    };

    if (existing) {
      updateExperienceItemStmt.run(payload);
      return;
    }

    insertExperienceItemStmt.run(payload);
  });
}

export function updateExperienceStatus(id: string, status: string, updatedAt: string) {
  const normalizedId = normalizeRequiredText(id, "经验 ID");
  const normalizedStatus = normalizeEnumValue(status, "经验状态", EXPERIENCE_STATUS);
  const normalizedUpdatedAt = ensureTimestampText(updatedAt, currentTimestampText());

  runTransaction(() => {
    ensureExperienceExists(normalizedId);

    if (normalizedStatus === "verified") {
      promoteExperienceStmt.run({
        id: normalizedId,
        updated_at: normalizedUpdatedAt,
      });
      return;
    }

    if (normalizedStatus === "deprecated") {
      deprecateExperienceStmt.run({
        id: normalizedId,
        updated_at: normalizedUpdatedAt,
      });
      return;
    }

    if (normalizedStatus === "rejected") {
      rejectExperienceStmt.run({
        id: normalizedId,
        updated_at: normalizedUpdatedAt,
      });
      return;
    }

    updateExperienceStatusStmt.run({
      id: normalizedId,
      status: normalizedStatus,
      updated_at: normalizedUpdatedAt,
    });
  });
}

export function promoteExperience(id: string) {
  const normalizedId = normalizeRequiredText(id, "经验 ID");
  const updatedAt = currentTimestampText();

  runTransaction(() => {
    ensureExperienceExists(normalizedId);
    promoteExperienceStmt.run({
      id: normalizedId,
      updated_at: updatedAt,
    });
  });
}

export function deprecateExperience(id: string) {
  const normalizedId = normalizeRequiredText(id, "经验 ID");
  const updatedAt = currentTimestampText();

  runTransaction(() => {
    ensureExperienceExists(normalizedId);
    deprecateExperienceStmt.run({
      id: normalizedId,
      updated_at: updatedAt,
    });
  });
}

export function rejectExperience(id: string) {
  const normalizedId = normalizeRequiredText(id, "经验 ID");
  const updatedAt = currentTimestampText();

  runTransaction(() => {
    ensureExperienceExists(normalizedId);
    rejectExperienceStmt.run({
      id: normalizedId,
      updated_at: updatedAt,
    });
  });
}

export function findConflict(trigger: string, rule: string, excludeId?: string) {
  const normalizedTrigger = normalizeOptionalText(trigger);
  if (!normalizedTrigger) {
    return null;
  }

  return (
    findConflictStmt.get({
      trigger: normalizedTrigger,
      rule: normalizeRequiredText(rule, "经验规则"),
      exclude_id: normalizeOptionalText(excludeId),
    }) ?? null
  );
}

export function getExperiencesForInject(params: {
  agentId?: string;
  groupId: string;
  taskType?: string;
  limit?: number;
}) {
  const normalizedGroupId = normalizeRequiredText(params.groupId, "项目组 ID");
  const normalizedAgentId = normalizeOptionalText(params.agentId);
  const normalizedTaskType = normalizeOptionalText(params.taskType);
  const queryParams: ExperienceInjectQueryParams = {
    group_id: normalizedGroupId,
    agent_session_pattern: normalizedAgentId
      ? `${escapeLikePattern(`agent:${normalizedAgentId}:`)}%`
      : null,
    task_type_pattern: normalizedTaskType ? `%${escapeLikePattern(normalizedTaskType)}%` : null,
    limit: normalizeLimit(params.limit, 6),
  };

  return {
    verified: getVerifiedExperiencesForInjectStmt.all(queryParams),
    recent: getRecentExperiencesForInjectStmt.all(queryParams),
  };
}
