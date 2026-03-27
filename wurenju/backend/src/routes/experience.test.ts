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
  tempHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "xiaban-experience-route-"));
  process.env.HOME = tempHomeDir;

  const express = (await import("express")).default;
  const experiencesRouter = (await import("./experience")).default;
  const { ApiError } = await import("../errors");
  dbModule = await import("../db");

  const app = express();
  app.use(
    express.json({
      limit: "10mb",
    }),
  );
  app.use("/experience", experiencesRouter);
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
    DELETE FROM process_events;
    DELETE FROM experience_items;
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

void test("GET /experience/inject 在空库时返回 verified 和 recent 两个数组", async () => {
  const response = await fetch(`${baseUrl}/experience/inject?groupId=group-1`);
  assert.equal(response.status, 200);

  const payload = (await response.json()) as {
    verified: unknown[];
    recent: unknown[];
  };
  assert.deepEqual(payload, {
    verified: [],
    recent: [],
  });
});

void test("POST /experience/events 会写入事件并支持按 groupId 查询", async () => {
  const createdAt = String(Date.now());
  let response = await fetch(`${baseUrl}/experience/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: "event-1",
      sessionKey: "agent:agent-1:group:group-1",
      groupId: "group-1",
      targetAgentId: "agent-1",
      feedbackType: "negative_explicit",
      senderId: "user-1",
      senderName: "用户",
      content: "这次答错了",
      normalizedContent: "答错",
      taskTypeJson: ["介绍", "汇报进度"],
      confidenceDelta: 0.8,
      createdAt,
    }),
  });
  assert.equal(response.status, 201);

  response = await fetch(
    `${baseUrl}/experience/events?groupId=group-1&targetAgentId=agent-1&limit=10`,
  );
  assert.equal(response.status, 200);

  const payload = (await response.json()) as Array<{
    id: string;
    task_type_json: string | null;
    created_at: string;
  }>;
  assert.equal(payload.length, 1);
  assert.equal(payload[0]?.id, "event-1");
  assert.equal(payload[0]?.task_type_json, JSON.stringify(["介绍", "汇报进度"]));
  assert.equal(payload[0]?.created_at, createdAt);
});

void test("POST /experience/items 写入候选后可查询并可通过 promote 进入 verified 注入列表", async () => {
  const createdAt = String(Date.now());
  let response = await fetch(`${baseUrl}/experience/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: "exp-1",
      kind: "lesson",
      taskTypeJson: ["介绍"],
      trigger: "介绍自己",
      rule: "先一句话给结论，再补细节。",
      antiPattern: "先铺垫很久再进入重点。",
      groupId: "group-1",
      sessionKey: "agent:agent-1:group:group-1",
      feedbackScore: 0.8,
      repeatedHits: 2,
      confidence: 0.7,
      createdAt,
      updatedAt: createdAt,
      lastSeenAt: createdAt,
      risk: "medium",
    }),
  });
  assert.equal(response.status, 201);

  response = await fetch(`${baseUrl}/experience/items?status=pending&kind=lesson`);
  assert.equal(response.status, 200);
  const listPayload = (await response.json()) as Array<{ id: string; status: string }>;
  assert.equal(listPayload.length, 1);
  assert.equal(listPayload[0]?.id, "exp-1");
  assert.equal(listPayload[0]?.status, "pending");

  response = await fetch(`${baseUrl}/experience/items/exp-1/promote`, {
    method: "POST",
  });
  assert.equal(response.status, 200);

  response = await fetch(
    `${baseUrl}/experience/inject?groupId=group-1&agentId=agent-1&taskType=%E4%BB%8B%E7%BB%8D`,
  );
  assert.equal(response.status, 200);

  const injectPayload = (await response.json()) as {
    verified: Array<{ id: string; status: string }>;
    recent: Array<{ id: string; status: string }>;
  };
  assert.equal(injectPayload.verified.length, 1);
  assert.equal(injectPayload.verified[0]?.id, "exp-1");
  assert.equal(injectPayload.verified[0]?.status, "verified");
  assert.deepEqual(injectPayload.recent, []);
});
