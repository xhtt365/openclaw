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
  tempHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "xiaban-archives-route-"));
  process.env.HOME = tempHomeDir;

  const express = (await import("express")).default;
  const archivesRouter = (await import("./archives")).default;
  const { ApiError } = await import("../errors");
  dbModule = await import("../db");

  const app = express();
  app.use(
    express.json({
      limit: "10mb",
    }),
  );
  app.use("/archives", archivesRouter);
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
    DELETE FROM archive_tombstones;
    DELETE FROM archives;
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

void test("DELETE /archives/:id 会为 direct 归档写入 tombstone 并阻止旧客户端重建", async () => {
  const payload = {
    id: "direct-archive-1",
    type: "direct",
    source_id: "agent-1",
    source_name: "五爷",
    title: "五爷 - 2026.03.27",
    messages: [],
    message_count: 0,
    archived_at: "2026-03-27T10:00:00.000Z",
  };

  let response = await fetch(`${baseUrl}/archives`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 201);

  response = await fetch(`${baseUrl}/archives/${payload.id}`, {
    method: "DELETE",
  });
  assert.equal(response.status, 200);

  const archiveRow = dbModule?.db
    .prepare<[], { id: string }>("SELECT id FROM archives WHERE id = 'direct-archive-1'")
    .get();
  assert.equal(archiveRow, undefined);

  const tombstoneRow = dbModule?.db
    .prepare<[], { id: string; type: string; source_id: string }>(
      "SELECT id, type, source_id FROM archive_tombstones WHERE id = 'direct-archive-1'",
    )
    .get();
  assert.equal(tombstoneRow?.id, "direct-archive-1");
  assert.equal(tombstoneRow?.type, "direct");
  assert.equal(tombstoneRow?.source_id, "agent-1");

  response = await fetch(`${baseUrl}/archives`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 409);

  const recreatedCount = dbModule?.db
    .prepare<[], { count: number }>(
      "SELECT COUNT(*) AS count FROM archives WHERE id = 'direct-archive-1'",
    )
    .get();
  assert.equal(recreatedCount?.count, 0);
});
