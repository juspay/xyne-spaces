import { Prisma } from "@prisma/client";
import { Router } from "express";
import { DEFAULT_REPO_CONFIGS } from "xyne-claw-shared";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http.js";
import { getRequesterId } from "../middleware/agent-acl.js";
import { sandboxRepoConfigRepository } from "../repositories/index.js";
import {
  SANDBOX_REPO_KEY_PATTERN,
  loadEffectiveRepoConfigs,
  parseRepoSetupConfig,
} from "../lib/sandbox-repo-configs.js";
import { createLogger } from "../logger.js";
import { writeAuditLog } from "../lib/audit.js";

const log = createLogger("admin-sandbox-repos");

export const adminSandboxReposRouter = Router();

function auditRepoConfig(
  actorUserId: string | null,
  key: string,
  action: "saved" | "deleted",
  before: { config: unknown; enabled: boolean } | null,
  after: { config: unknown; enabled: boolean } | null,
): void {
  void writeAuditLog({
    ...(actorUserId ? { actorUserId } : {}),
    eventType: "AGENT_CONFIG_UPDATED",
    targetId: `sandbox-repo:${key}`,
    description: `Sandbox repo config "${key}" ${action}`,
    metadata: { kind: "sandboxRepoConfig", key, before, after },
  });
}

adminSandboxReposRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const [rows, effective] = await Promise.all([sandboxRepoConfigRepository.list(), loadEffectiveRepoConfigs()]);
    const keys = new Set([...Object.keys(DEFAULT_REPO_CONFIGS), ...rows.map((row) => row.key)]);
    const data = [...keys].sort().map((key) => {
      const row = rows.find((r) => r.key === key);
      return {
        key,
        source: row ? "database" : "default",
        hasDefault: key in DEFAULT_REPO_CONFIGS,
        enabled: row ? row.enabled : true,
        active: key in effective,
        config: row ? row.config : DEFAULT_REPO_CONFIGS[key],
        updatedAt: row?.updatedAt ?? null,
        updatedByUserId: row?.updatedByUserId ?? null,
        workspaceId: row?.workspaceId ?? null,
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
    const body = (req.body ?? {}) as { config?: unknown; enabled?: unknown; workspaceId?: unknown };
    const parsed = parseRepoSetupConfig(body.config);
    if (!parsed.ok) throw badRequest(`invalid config — ${parsed.error}`);
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") throw badRequest("enabled must be a boolean");
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
    // A new non-built-in profile must belong to a workspace, or it shows nowhere.
    if (!workspaceId && !(key in DEFAULT_REPO_CONFIGS) && !(await sandboxRepoConfigRepository.find(key))) {
      throw badRequest("workspaceId is required for a new sandbox profile");
    }
    const requesterId = getRequesterId(req) ?? null;
    const previous = await sandboxRepoConfigRepository.find(key);
    const row = await sandboxRepoConfigRepository.upsert(
      key,
      parsed.config as unknown as Prisma.InputJsonValue,
      body.enabled ?? true,
      requesterId,
      { workspaceId: workspaceId || null },
    );
    log.info(`[admin-sandbox-repos] ${requesterId ?? "unknown"} saved "${key}" (enabled=${row.enabled})`);
    auditRepoConfig(
      requesterId,
      key,
      "saved",
      previous ? { config: previous.config, enabled: previous.enabled } : null,
      { config: row.config, enabled: row.enabled },
    );
    ok(res, row);
  }),
);

/** Backfill: give unowned rows a workspace. Dry run unless dryRun is false. */
adminSandboxReposRouter.post(
  "/assign-workspace",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { workspaceId?: unknown; keys?: unknown; dryRun?: unknown };
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
    if (!workspaceId) throw badRequest("workspaceId is required");
    if (body.keys !== undefined && !(Array.isArray(body.keys) && body.keys.every((k) => typeof k === "string"))) {
      throw badRequest("keys must be an array of strings");
    }
    const dryRun = body.dryRun !== false;
    // Built-in overrides stay global, so they never need a workspace.
    const keys = (await sandboxRepoConfigRepository.listUnowned(body.keys as string[] | undefined))
      .map((row) => row.key)
      .filter((key) => !(key in DEFAULT_REPO_CONFIGS));
    if (!dryRun && keys.length > 0) await sandboxRepoConfigRepository.assignWorkspace(keys, workspaceId);
    log.info(`[admin-sandbox-repos] ${getRequesterId(req) ?? "unknown"} assign-workspace ${workspaceId} dryRun=${dryRun} keys=${keys.join(",")}`);
    ok(res, { dryRun, workspaceId, keys });
  }),
);

adminSandboxReposRouter.delete(
  "/:key",
  asyncHandler(async (req, res) => {
    const key = String(req.params["key"] ?? "");
    if (!SANDBOX_REPO_KEY_PATTERN.test(key)) throw notFound(`no stored config for "${key}"`);
    let removed;
    try {
      removed = await sandboxRepoConfigRepository.delete(key);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        throw notFound(`no stored config for "${key}"`);
      }
      throw err;
    }
    const requesterId = getRequesterId(req) ?? null;
    log.info(`[admin-sandbox-repos] ${requesterId ?? "unknown"} deleted stored config "${key}"`);
    auditRepoConfig(requesterId, key, "deleted", { config: removed.config, enabled: removed.enabled }, null);
    ok(res, { key, revertedToDefault: key in DEFAULT_REPO_CONFIGS });
  }),
);
