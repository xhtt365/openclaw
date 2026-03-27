import { Router } from "express";
import { db, nowIso, type DepartmentRow } from "../db";
import { ApiError } from "../errors";
import {
  asOptionalInteger,
  asOptionalText,
  asRequiredText,
  readRouteParam,
  requireRecord,
} from "../utils";

type DepartmentMutationParams = {
  id: string;
  name: string | null;
  icon: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

const router = Router();

const listDepartmentsStmt = db.prepare<[], DepartmentRow>(`
  SELECT
    id,
    name,
    icon,
    sort_order,
    created_at,
    updated_at
  FROM departments
  ORDER BY sort_order ASC, name COLLATE NOCASE ASC, id ASC
`);

const getDepartmentStmt = db.prepare<{ id: string }, DepartmentRow>(`
  SELECT
    id,
    name,
    icon,
    sort_order,
    created_at,
    updated_at
  FROM departments
  WHERE id = @id
`);

const insertDepartmentStmt = db.prepare<DepartmentMutationParams>(`
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
`);

const updateDepartmentStmt = db.prepare<DepartmentMutationParams>(`
  UPDATE departments
  SET
    name = @name,
    icon = @icon,
    sort_order = @sort_order,
    updated_at = @updated_at
  WHERE id = @id
`);

const deleteDepartmentStmt = db.prepare<{ id: string }>(`
  DELETE FROM departments
  WHERE id = @id
`);

router.get("/", (_req, res) => {
  res.json(listDepartmentsStmt.all());
});

router.post("/", (req, res) => {
  const body = requireRecord(req.body);
  const id = asRequiredText(body.id, "部门 ID");
  if (getDepartmentStmt.get({ id })) {
    throw new ApiError(409, "部门已存在");
  }

  const createdAt = nowIso();
  const payload: DepartmentMutationParams = {
    id,
    name: asOptionalText(body.name, "部门名称"),
    icon: asOptionalText(body.icon, "部门图标"),
    sort_order: asOptionalInteger(body.sort_order ?? body.sortOrder, "排序值") ?? 0,
    created_at: createdAt,
    updated_at: createdAt,
  };

  insertDepartmentStmt.run(payload);

  res.status(201).json(getDepartmentStmt.get({ id }));
});

router.put("/:id", (req, res) => {
  const id = readRouteParam(req.params.id, "部门 ID");
  const current = getDepartmentStmt.get({ id });
  if (!current) {
    throw new ApiError(404, "部门不存在");
  }

  const body = requireRecord(req.body);
  const payload: DepartmentMutationParams = {
    ...current,
    name: body.name !== undefined ? asOptionalText(body.name, "部门名称") : current.name,
    icon: body.icon !== undefined ? asOptionalText(body.icon, "部门图标") : current.icon,
    sort_order:
      body.sort_order !== undefined || body.sortOrder !== undefined
        ? (asOptionalInteger(body.sort_order ?? body.sortOrder, "排序值") ?? 0)
        : current.sort_order,
    updated_at: nowIso(),
  };

  updateDepartmentStmt.run(payload);

  res.json(getDepartmentStmt.get({ id }));
});

router.delete("/:id", (req, res) => {
  const id = readRouteParam(req.params.id, "部门 ID");
  const current = getDepartmentStmt.get({ id });
  if (!current) {
    throw new ApiError(404, "部门不存在");
  }

  deleteDepartmentStmt.run({ id });

  res.json({ success: true });
});

export default router;
