import { Router } from "express";
import { ApiError } from "../errors";
import { storageService } from "../storage/service";
import { requireRecord } from "../utils";

const router = Router();

function readOptionalQueryText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isObjectMap(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

router.get("/:type", (req, res) => {
  const type = typeof req.params.type === "string" ? req.params.type.trim() : "";

  switch (type) {
    case "health":
      res.json(storageService.health());
      return;
    case "user-profile":
      res.json(storageService.getUserProfile(readOptionalQueryText(req.query.userId) ?? "self"));
      return;
    case "groups":
      res.json(storageService.getGroups(readOptionalQueryText(req.query.userId) ?? "self"));
      return;
    case "agent-avatars":
      res.json(storageService.listAgentAvatars());
      return;
    case "channel-configs": {
      const agentId = readOptionalQueryText(req.query.agentId);
      res.json(
        agentId ? storageService.getChannelConfig(agentId) : storageService.listChannelConfigs(),
      );
      return;
    }
    case "model-providers":
      res.json(storageService.listModelProviders());
      return;
    default:
      throw new ApiError(404, `不支持的 storage 类型: ${type || "unknown"}`);
  }
});

router.post("/:type", (req, res) => {
  const type = typeof req.params.type === "string" ? req.params.type.trim() : "";
  const body = requireRecord(req.body);

  switch (type) {
    case "user-profile":
      res
        .status(201)
        .json(storageService.upsertUserProfile(readOptionalQueryText(body.userId) ?? "self", body));
      return;
    case "groups":
      res
        .status(201)
        .json(
          storageService.putGroups(readOptionalQueryText(body.userId) ?? "self", body.snapshot),
        );
      return;
    case "agent-avatars":
      if (isObjectMap(body.items)) {
        res.status(201).json(storageService.replaceAgentAvatars(body.items));
        return;
      }

      res
        .status(201)
        .json(storageService.upsertAgentAvatar(String(body.agentId ?? ""), body.avatar));
      return;
    case "channel-configs":
      res
        .status(201)
        .json(storageService.upsertChannelConfig(String(body.agentId ?? ""), body.config));
      return;
    case "model-providers":
      if (isObjectMap(body.items)) {
        res.status(201).json(storageService.replaceModelProviders(body.items));
        return;
      }

      res
        .status(201)
        .json(storageService.upsertModelProvider(String(body.providerId ?? ""), body.config));
      return;
    default:
      throw new ApiError(404, `不支持的 storage 类型: ${type || "unknown"}`);
  }
});

router.put("/:type", (req, res) => {
  const type = typeof req.params.type === "string" ? req.params.type.trim() : "";
  const body = requireRecord(req.body);

  switch (type) {
    case "user-profile":
      res.json(
        storageService.upsertUserProfile(readOptionalQueryText(body.userId) ?? "self", body),
      );
      return;
    case "groups":
      res.json(
        storageService.putGroups(readOptionalQueryText(body.userId) ?? "self", body.snapshot),
      );
      return;
    case "agent-avatars":
      if (isObjectMap(body.items)) {
        res.json(storageService.replaceAgentAvatars(body.items));
        return;
      }

      res.json(storageService.upsertAgentAvatar(String(body.agentId ?? ""), body.avatar));
      return;
    case "channel-configs":
      res.json(storageService.upsertChannelConfig(String(body.agentId ?? ""), body.config));
      return;
    case "model-providers":
      if (isObjectMap(body.items)) {
        res.json(storageService.replaceModelProviders(body.items));
        return;
      }

      res.json(storageService.upsertModelProvider(String(body.providerId ?? ""), body.config));
      return;
    default:
      throw new ApiError(404, `不支持的 storage 类型: ${type || "unknown"}`);
  }
});

router.delete("/:type", (req, res) => {
  const type = typeof req.params.type === "string" ? req.params.type.trim() : "";

  switch (type) {
    case "user-profile":
      res.json(storageService.deleteUserProfile(readOptionalQueryText(req.query.userId) ?? "self"));
      return;
    case "groups":
      res.json(
        storageService.deleteGroups(
          readOptionalQueryText(req.query.userId) ?? "self",
          readOptionalQueryText(req.query.groupId) ?? undefined,
        ),
      );
      return;
    case "agent-avatars":
      res.json(storageService.deleteAgentAvatar(readOptionalQueryText(req.query.agentId) ?? ""));
      return;
    case "channel-configs":
      res.json(storageService.deleteChannelConfig(readOptionalQueryText(req.query.agentId) ?? ""));
      return;
    case "model-providers":
      res.json(
        storageService.deleteModelProvider(
          readOptionalQueryText(req.query.providerId) ?? undefined,
        ),
      );
      return;
    default:
      throw new ApiError(404, `不支持的 storage 类型: ${type || "unknown"}`);
  }
});

export default router;
