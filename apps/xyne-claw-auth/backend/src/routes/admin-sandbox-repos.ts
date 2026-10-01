import { Prisma } from "@prisma/client";
import { Router } from "express";
import { REPO_CONFIGS } from "xyne-claw-shared";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http.js";
import { getRequesterId } from "../middleware/agent-acl.js";
import { sandboxRepoConfigRepository } from "../repositories/index.js";
import {
  SANDBOX_REPO_KEY_PATTERN,
  loadEffectiveRepoConfigs,
  parseRepoSetupConfig,
} from "../lib/sandbox-repo-configs.js";
import { createLogger } from "../logger.js";

const log = createLogger("admin-sandbox-repos");

export const adminSandboxReposRouter = Router();

adminSandboxReposRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const [rows, effective] = await Promise.all([sandboxRepoConfigRepository.list(), loadEffectiveRepoConfigs()]);
    const keys = new Set([...Object.keys(REPO_CONFIGS), ...rows.map((row) => row.key)]);
    const data = [...keys].sort().map((key) => {
      const row = rows.find((r) => r.key === key);
      return {
        key,
        source: row ? "database" : "default",
        hasDefault: key in REPO_CONFIGS,
        enabled: row ? row.enabled : true,
        active: key in effective,
        config: row ? row.config : REPO_CONFIGS[key],
        updatedAt: row?.updatedAt ?? null,
        updatedByUserId: row?.updatedByUserId ?? null,
      };
    });
    ok(res, data);
  }),
);

adminSandboxReposRouter.put(
  "/:key",
  asyncHandler(async (req, res) => {
    const key = String(req.params["key"] ?? "");
    if (!SANDBOX_REPO_KEY_PATTERN.test(key)) {
      throw badRequest("key must be lowercase letters, digits, '.', '_' or '-' (max 64 chars)");
    }
    const body = (req.body ?? {}) as { config?: unknown; enabled?: unknown };
    const parsed = parseRepoSetupConfig(body.config);
    if (!parsed.ok) throw badRequest(`invalid config — ${parsed.error}`);
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") throw badRequest("enabled must be a boolean");
    const requesterId = getRequesterId(req) ?? null;
    const row = await sandboxRepoConfigRepository.upsert(
      key,
      parsed.config as unknown as Prisma.InputJsonValue,
      body.enabled ?? true,
      requesterId,
    );
    log.info(`[admin-sandbox-repos] ${requesterId ?? "unknown"} saved "${key}" (enabled=${row.enabled})`);
    ok(res, row);
  }),
);

adminSandboxReposRouter.delete(
  "/:key",
  asyncHandler(async (req, res) => {
    const key = String(req.params["key"] ?? "");
    try {
      await sandboxRepoConfigRepository.delete(key);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        throw notFound(`no stored config for "${key}"`);
      }
      throw err;
    }
    log.info(`[admin-sandbox-repos] ${getRequesterId(req) ?? "unknown"} deleted stored config "${key}"`);
    ok(res, { key, revertedToDefault: key in REPO_CONFIGS });
  }),
);
