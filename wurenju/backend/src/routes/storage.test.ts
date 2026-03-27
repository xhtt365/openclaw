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
  tempHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "xiaban-storage-route-"));
  process.env.HOME = tempHomeDir;

  const express = (await import("express")).default;
  const storageRouter = (await import("./storage")).default;
  const { ApiError } = await import("../errors");
  dbModule = await import("../db");

  const app = express();
  app.use(
    express.json({
      limit: "10mb",
    }),
  );
  app.use("/storage", storageRouter);
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
    DELETE FROM settings;
    DELETE FROM archive_tombstones;
    DELETE FROM archives;
    DELETE FROM group_members;
    DELETE FROM groups;
    DELETE FROM users;
    DELETE FROM agent_avatars;
    DELETE FROM channel_configs;
    DELETE FROM model_providers;
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

void test("GET /storage/user-profile 会把旧浏览器私有 userId 迁移到共享 self", async () => {
  let response = await fetch(`${baseUrl}/storage/user-profile`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId: "browser-a",
      name: "跨浏览器用户",
      avatar: "data:image/jpeg;base64,avatar-a",
    }),
  });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/storage/user-profile`);
  assert.equal(response.status, 200);

  const payload = (await response.json()) as {
    userId: string;
    name: string | null;
    avatar: string | null;
    source: string;
  };

  assert.equal(payload.userId, "self");
  assert.equal(payload.name, "跨浏览器用户");
  assert.equal(payload.avatar, "data:image/jpeg;base64,avatar-a");
  assert.equal(payload.source, "legacy-migrated");

  const selfRow = dbModule?.db
    .prepare<[], { id: string; name: string | null }>(
      "SELECT id, name FROM users WHERE id = 'self'",
    )
    .get();
  assert.equal(selfRow?.id, "self");
  assert.equal(selfRow?.name, "跨浏览器用户");
});

void test("GET /storage/groups 会把旧浏览器私有快照迁移到共享 self 并保留消息和归档", async () => {
  const snapshot = {
    groups: [
      {
        id: "group-1",
        name: "跨浏览器项目组",
        members: [{ id: "lead", name: "群主" }],
        leaderId: "lead",
        createdAt: "2026-03-27T00:00:00.000Z",
      },
    ],
    selectedGroupId: "group-1",
    selectedArchiveId: "archive-1",
    messagesByGroupId: {
      "group-1": [
        {
          id: "message-1",
          role: "assistant",
          content: "这条聊天记录需要跨浏览器显示",
          timestamp: 1_742_000_000_000,
        },
      ],
    },
    archives: [
      {
        id: "archive-1",
        groupId: "group-1",
        groupName: "跨浏览器项目组",
        title: "归档记录",
        createdAt: "2026-03-27T00:05:00.000Z",
        messages: [
          {
            id: "message-1",
            role: "assistant",
            content: "归档消息",
            timestamp: 1_742_000_000_000,
          },
        ],
      },
    ],
  };

  let response = await fetch(`${baseUrl}/storage/groups`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId: "browser-a",
      snapshot,
    }),
  });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/storage/groups`);
  assert.equal(response.status, 200);

  const payload = (await response.json()) as {
    userId: string;
    snapshot: typeof snapshot;
    source: string;
  };

  assert.equal(payload.userId, "self");
  assert.equal(payload.source, "legacy-migrated");
  assert.equal(payload.snapshot.selectedGroupId, "group-1");
  assert.equal(payload.snapshot.selectedArchiveId, "archive-1");
  assert.equal(payload.snapshot.messagesByGroupId["group-1"]?.length, 1);
  assert.equal(
    payload.snapshot.messagesByGroupId["group-1"]?.[0]?.content,
    "这条聊天记录需要跨浏览器显示",
  );
  assert.equal(payload.snapshot.archives.length, 1);
  assert.equal(payload.snapshot.archives[0]?.title, "归档记录");

  const selfSetting = dbModule?.db
    .prepare<[], { key: string; value: string }>(
      "SELECT key, value FROM settings WHERE key = 'storage.groups.snapshot.self'",
    )
    .get();
  assert.equal(selfSetting?.key, "storage.groups.snapshot.self");
  assert.equal(typeof selfSetting?.value, "string");
});
