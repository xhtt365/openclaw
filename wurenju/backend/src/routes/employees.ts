import { Router } from "express";
import { db, nowIso, type EmployeeRow, runTransaction } from "../db";
import { ApiError } from "../errors";
import {
  asBooleanInteger,
  asOptionalInteger,
  asOptionalText,
  asRequiredText,
  readRouteParam,
  requireRecord,
} from "../utils";

type EmployeeMutationParams = {
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

const router = Router();

const listEmployeesStmt = db.prepare<[], EmployeeRow>(`
  SELECT
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
  FROM employees
  ORDER BY pinned DESC, sort_order DESC, name COLLATE NOCASE ASC, id ASC
`);

const getEmployeeStmt = db.prepare<{ id: string }, EmployeeRow>(`
  SELECT
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
  FROM employees
  WHERE id = @id
`);

const insertEmployeeStmt = db.prepare<EmployeeMutationParams>(`
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
`);

const updateEmployeeStmt = db.prepare<EmployeeMutationParams>(`
  UPDATE employees
  SET
    name = @name,
    avatar = @avatar,
    position = @position,
    department = @department,
    description = @description,
    pinned = @pinned,
    sort_order = @sort_order,
    updated_at = @updated_at
  WHERE id = @id
`);

const deleteEmployeeStmt = db.prepare<{ id: string }>(`
  DELETE FROM employees
  WHERE id = @id
`);

const deleteEmployeeGroupMembersStmt = db.prepare<{ agent_id: string }>(`
  DELETE FROM group_members
  WHERE agent_id = @agent_id
`);

const clearGroupOwnerStmt = db.prepare<{ owner_agent_id: string; updated_at: string }>(`
  UPDATE groups
  SET
    owner_agent_id = NULL,
    updated_at = @updated_at
  WHERE owner_agent_id = @owner_agent_id
`);

router.get("/", (_req, res) => {
  res.json(listEmployeesStmt.all());
});

router.get("/:id", (req, res) => {
  const id = readRouteParam(req.params.id, "员工 ID");
  const employee = getEmployeeStmt.get({ id });

  if (!employee) {
    throw new ApiError(404, "员工不存在");
  }

  res.json(employee);
});

router.post("/", (req, res) => {
  const body = requireRecord(req.body);
  const id = asRequiredText(body.id, "员工 ID");
  if (getEmployeeStmt.get({ id })) {
    throw new ApiError(409, "员工已存在");
  }

  const createdAt = nowIso();
  const payload: EmployeeMutationParams = {
    id,
    name: asOptionalText(body.name, "员工名称"),
    avatar: asOptionalText(body.avatar, "头像"),
    position: asOptionalText(body.position, "职位"),
    department: asOptionalText(body.department, "所属部门"),
    description: asOptionalText(body.description, "简介"),
    pinned: asBooleanInteger(body.pinned, "是否置顶", 0),
    sort_order: asOptionalInteger(body.sort_order ?? body.sortOrder, "排序权重") ?? 0,
    created_at: createdAt,
    updated_at: createdAt,
  };

  insertEmployeeStmt.run(payload);

  res.status(201).json(getEmployeeStmt.get({ id }));
});

router.put("/:id", (req, res) => {
  const id = readRouteParam(req.params.id, "员工 ID");
  const current = getEmployeeStmt.get({ id });
  if (!current) {
    throw new ApiError(404, "员工不存在");
  }

  const body = requireRecord(req.body);
  const payload: EmployeeMutationParams = {
    ...current,
    name: body.name !== undefined ? asOptionalText(body.name, "员工名称") : current.name,
    avatar: body.avatar !== undefined ? asOptionalText(body.avatar, "头像") : current.avatar,
    position:
      body.position !== undefined ? asOptionalText(body.position, "职位") : current.position,
    department:
      body.department !== undefined
        ? asOptionalText(body.department, "所属部门")
        : current.department,
    description:
      body.description !== undefined
        ? asOptionalText(body.description, "简介")
        : current.description,
    pinned:
      body.pinned !== undefined
        ? asBooleanInteger(body.pinned, "是否置顶", current.pinned)
        : current.pinned,
    sort_order:
      body.sort_order !== undefined || body.sortOrder !== undefined
        ? (asOptionalInteger(body.sort_order ?? body.sortOrder, "排序权重") ?? 0)
        : current.sort_order,
    updated_at: nowIso(),
  };

  updateEmployeeStmt.run(payload);

  res.json(getEmployeeStmt.get({ id }));
});

router.delete("/:id", (req, res) => {
  const id = readRouteParam(req.params.id, "员工 ID");
  const current = getEmployeeStmt.get({ id });
  if (!current) {
    throw new ApiError(404, "员工不存在");
  }

  runTransaction(() => {
    deleteEmployeeGroupMembersStmt.run({ agent_id: id });
    clearGroupOwnerStmt.run({ owner_agent_id: id, updated_at: nowIso() });
    deleteEmployeeStmt.run({ id });
  });

  res.json({ success: true });
});

export default router;
