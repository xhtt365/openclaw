import { Router } from "express";
import { db, nowIso, type SettingRow } from "../db";
import { ApiError } from "../errors";
import { asJsonText, readRouteParam, requireRecord } from "../utils";

type SettingMutationParams = {
  key: string;
  value: string | null;
  created_at: string;
  updated_at: string;
};

const router = Router();

const listSettingsStmt = db.prepare<[], SettingRow>(`
  SELECT
    key,
    value,
    created_at,
    updated_at
  FROM settings
  ORDER BY key ASC
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

const upsertSettingStmt = db.prepare<SettingMutationParams>(`
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

router.get("/", (_req, res) => {
  res.json(listSettingsStmt.all());
});

router.get("/:key", (req, res) => {
  const key = readRouteParam(req.params.key, "设置键");
  const setting = getSettingStmt.get({ key });
  if (!setting) {
    throw new ApiError(404, "设置不存在");
  }

  res.json(setting);
});

router.put("/:key", (req, res) => {
  const key = readRouteParam(req.params.key, "设置键");
  const body = requireRecord(req.body);
  if (!("value" in body)) {
    throw new ApiError(400, "value 不能为空");
  }

  const existing = getSettingStmt.get({ key });
  const createdAt = existing?.created_at ?? nowIso();

  upsertSettingStmt.run({
    key,
    value: asJsonText(body.value),
    created_at: createdAt,
    updated_at: nowIso(),
  });

  const setting = getSettingStmt.get({ key });
  if (!setting) {
    throw new ApiError(500, "保存设置失败");
  }

  res.json(setting);
});

export default router;
