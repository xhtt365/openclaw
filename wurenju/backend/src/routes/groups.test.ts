import assert from "node:assert/strict";
import fs from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, afterEach, before } from "node:test";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";

const originalHome = process.env.HOME;

let tempHomeDir = "";
let server: Server | null = null;
let baseUrl = "";
let dbModule: typeof import("../db") | null = null;

before(async () => {
  tempHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "xiaban-groups-route-"));
  process.env.HOME = tempHomeDir;
  const legacyDbDir = path.join(tempHomeDir, ".xiaban");
  const legacyDbFile = path.join(legacyDbDir, "data.db");
  await fs.mkdir(legacyDbDir, { recursive: true });

  const BetterSqlite3 = (await import("better-sqlite3")).default;
  const legacyDb = new BetterSqlite3(legacyDbFile);
  legacyDb.exec(`
    CREATE TABLE groups (
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

    CREATE TABLE group_members (
      group_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (group_id, agent_id)
    );
  `);
  legacyDb.close();

  const express = (await import("express")).default;
  const groupsRouter = (await import("./groups")).default;
  const { ApiError } = await import("../errors");
  dbModule = await import("../db");

  const app = express();
  app.use(
    express.json({
      limit: "10mb",
    }),
  );
  app.use("/groups", groupsRouter);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message =
      error instanceof Error && error.message.trim() ? error.message : "服务器内部错误";
    res.status(statusCode).json({ error: message });
  });

  server = await new Promise<Server>((resolve) => {
    const listeningServer = app.listen(0, () => {
      resolve(listeningServer);
    });
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  dbModule?.db.exec(`
    DELETE FROM group_members;
    DELETE FROM groups;
  `);
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  if (tempHomeDir) {
    await fs.rm(tempHomeDir, { recursive: true, force: true });
  }
});

void test("PUT /groups/:id 会同步 camelCase 督促字段和成员列表", async () => {
  let response = await fetch(`${baseUrl}/groups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: "group-1",
      name: "测试项目组",
      ownerAgentId: "lead",
      urgeEnabled: true,
      urgePaused: false,
      urgeIntervalMinutes: 10,
      urgeCount: 2,
      urgeNoResponseCount: 1,
      urgeLastCheckedAt: "2026-03-21T10:00:00.000Z",
      lastUrgeAt: "2026-03-21T09:50:00.000Z",
      urgeStopReason: null,
      members: [
        { agentId: "lead", role: "owner" },
        { agentId: "dev", role: "member" },
      ],
    }),
  });
  assert.equal(response.status, 201);

  response = await fetch(`${baseUrl}/groups/group-1`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      urgeEnabled: false,
      urgePaused: true,
      urgeCount: 6,
      urgeNoResponseCount: 2,
      urgeLastCheckedAt: "2026-03-21T10:15:00.000Z",
      lastUrgeAt: "2026-03-21T10:05:00.000Z",
      urgeStopReason: "连续 2 次无响应",
      members: [{ agentId: "lead", role: "owner" }],
    }),
  });
  assert.equal(response.status, 200);

  const payload = (await response.json()) as {
    urge_enabled: number;
    urge_paused: number;
    urge_interval: number | null;
    urge_count: number;
    urge_no_response_count: number;
    urge_last_checked_at: string | null;
    last_urge_at: string | null;
    urge_stop_reason: string | null;
    members: Array<{ agent_id: string; role: string }>;
  };

  assert.equal(payload.urge_enabled, 0);
  assert.equal(payload.urge_paused, 1);
  assert.equal(payload.urge_interval, 10);
  assert.equal(payload.urge_count, 6);
  assert.equal(payload.urge_no_response_count, 2);
  assert.equal(payload.urge_last_checked_at, "2026-03-21T10:15:00.000Z");
  assert.equal(payload.last_urge_at, "2026-03-21T10:05:00.000Z");
  assert.equal(payload.urge_stop_reason, "连续 2 次无响应");
  assert.deepEqual(
    payload.members.map((member) => member.agent_id),
    ["lead"],
  );
  assert.equal(payload.members[0]?.role, "owner");
});

void test("db 初始化时会自动补齐 groups 表的督促暂停字段", () => {
  const columns = dbModule?.db
    .prepare<[], { name: string }>("PRAGMA table_info(groups)")
    .all()
    .map((column) => column.name);

  assert.equal(columns?.includes("urge_paused"), true);
  assert.equal(columns?.includes("urge_count"), true);
  assert.equal(columns?.includes("urge_no_response_count"), true);
  assert.equal(columns?.includes("urge_last_checked_at"), true);
  assert.equal(columns?.includes("last_urge_at"), true);
  assert.equal(columns?.includes("urge_stop_reason"), true);
});
