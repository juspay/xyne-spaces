import { Prisma } from "@prisma/client";
import { Router } from "express";
import { DEFAULT_REPO_CONFIGS, type RepoSetupConfig } from "xyne-claw-shared";
import { asyncHandler, badRequest, conflict, notFound, ok } from "../lib/http.js";
import { isClawAdmin } from "../middleware/agent-acl.js";
import { sandboxRepoConfigRepository } from "../repositories/index.js";
import {
  SANDBOX_REPO_KEY_PATTERN,
  loadEffectiveRepoConfigs,
  parseRepoSetupConfig,
  sameRepoConfig,
} from "../lib/sandbox-repo-configs.js";
import { listSandboxTemplates } from "../lib/sandbox-templates.js";
import { createLogger } from "../logger.js";

const log = createLogger("sandbox-profiles-internal");

/**
 * Spaces → sandbox profile editor (INTERNAL_S2S_KEY). Spaces decides who may edit; this layer only
 * keeps ownership straight: a workspace's profile is reachable only with that workspaceId.
 */
export const sandboxProfilesInternalRouter = Router();

export interface SandboxProfileRow {
  key: string;
  config: RepoSetupConfig;
  enabled: boolean;
  builtIn: boolean;
  /** A built-in whose stored copy differs from the code version. */
  overridden: boolean;
  workspaceId: string | null;
  createdByUserId: string | null;
}

const isBuiltIn = (key: string): boolean => Object.hasOwn(DEFAULT_REPO_CONFIGS, key);

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Built-ins (with any global override) plus the workspace's own rows, disabled ones included. */
sandboxProfilesInternalRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const workspaceId = str(req.query["workspaceId"]);
    if (!workspaceId) throw badRequest("workspaceId is required");
    const rows = new Map((await sandboxRepoConfigRepository.list()).map((row) => [row.key, row]));
    const profiles: SandboxProfileRow[] = [];
    for (const [key, builtIn] of Object.entries(DEFAULT_REPO_CONFIGS)) {
      const row = rows.get(key);
      const parsed = row ? parseRepoSetupConfig(row.config) : undefined;
      const config = parsed?.ok ? parsed.config : builtIn;
      profiles.push({
        key,
        config,
        enabled: row?.enabled ?? true,
        builtIn: true,
        overridden: !sameRepoConfig(config, builtIn),
        workspaceId: null,
        createdByUserId: null,
      });
    }
    for (const row of rows.values()) {
      if (isBuiltIn(row.key) || row.workspaceId !== workspaceId) continue;
      const parsed = parseRepoSetupConfig(row.config);
      if (!parsed.ok) continue;
      profiles.push({
        key: row.key,
        config: parsed.config,
        enabled: row.enabled,
        builtIn: false,
        overridden: false,
        workspaceId: row.workspaceId,
        createdByUserId: row.createdByUserId,
      });
    }
    ok(res, profiles.sort((a, b) => a.key.localeCompare(b.key)));
  }),
);

sandboxProfilesInternalRouter.get(
  "/templates",
  asyncHandler(async (_req, res) => {
    ok(res, await listSandboxTemplates(await loadEffectiveRepoConfigs()));
  }),
);

sandboxProfilesInternalRouter.get(
  "/claw-admin",
  asyncHandler(async (req, res) => {
    const userId = str(req.query["userId"]);
    if (!userId) throw badRequest("userId is required");
    ok(res, { isAdmin: await isClawAdmin(userId) });
  }),
);

/** A workspace's own row, or 404: a key from another workspace must look missing. */
async function ownedRow(key: string, workspaceId: string) {
  const row = await sandboxRepoConfigRepository.find(key);
  if (!isBuiltIn(key) && (!row || row.workspaceId !== workspaceId)) {
    throw notFound(`no sandbox profile "${key}"`, "sandbox_profile_not_found");
  }
  return row;
}

sandboxProfilesInternalRouter.put(
  "/:key",
  asyncHandler(async (req, res) => {
    const key = String(req.params["key"] ?? "");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const workspaceId = str(body["workspaceId"]);
    const actorUserId = str(body["actorUserId"]);
    if (!workspaceId || !actorUserId) throw badRequest("workspaceId and actorUserId are required");
    const parsed = parseRepoSetupConfig(body["config"]);
    if (!parsed.ok) throw badRequest(`invalid config — ${parsed.error}`, "invalid_config");
    const config = parsed.config as unknown as Prisma.InputJsonValue;

    if (body["create"] === true) {
      if (!SANDBOX_REPO_KEY_PATTERN.test(key)) {
        throw badRequest("key must be lowercase letters, digits, '.', '_' or '-' (max 64 chars)");
      }
      if (isBuiltIn(key) || (await sandboxRepoConfigRepository.find(key))) {
        throw conflict(`sandbox profile "${key}" already exists`, "sandbox_profile_exists");
      }
      const row = await sandboxRepoConfigRepository.upsert(key, config, true, actorUserId, {
        workspaceId,
        createdByUserId: actorUserId,
      });
      log.info(`[sandbox-profiles] ${actorUserId} created "${key}" in ${workspaceId}`);
      ok(res, row);
      return;
    }

    const existing = await ownedRow(key, workspaceId);
    const row = await sandboxRepoConfigRepository.upsert(key, config, existing?.enabled ?? true, actorUserId);
    log.info(`[sandbox-profiles] ${actorUserId} updated "${key}"`);
    ok(res, row);
  }),
);

sandboxProfilesInternalRouter.post(
  "/:key/enabled",
  asyncHandler(async (req, res) => {
    const key = String(req.params["key"] ?? "");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const workspaceId = str(body["workspaceId"]);
    const actorUserId = str(body["actorUserId"]);
    if (!workspaceId || !actorUserId) throw badRequest("workspaceId and actorUserId are required");
    if (typeof body["enabled"] !== "boolean") throw badRequest("enabled must be a boolean");
    const enabled = body["enabled"];
    const existing = await ownedRow(key, workspaceId);
    log.info(`[sandbox-profiles] ${actorUserId} set "${key}" enabled=${enabled}`);
    // A built-in back on with an unedited copy: drop the row so code updates reach it again.
    if (enabled && existing && isBuiltIn(key) && sameRepoConfig(existing.config, DEFAULT_REPO_CONFIGS[key])) {
      await sandboxRepoConfigRepository.delete(key);
      ok(res, { key, enabled });
      return;
    }
    // A built-in with no row yet: "off" has to live somewhere, so store the code version with the flag.
    const row = existing
      ? await sandboxRepoConfigRepository.setEnabled(key, enabled, actorUserId)
      : await sandboxRepoConfigRepository.upsert(
          key,
          DEFAULT_REPO_CONFIGS[key] as unknown as Prisma.InputJsonValue,
          enabled,
          actorUserId,
        );
    ok(res, row);
  }),
);

/** Built-in only: drop the stored copy so the code version applies again. */
sandboxProfilesInternalRouter.post(
  "/:key/reset",
  asyncHandler(async (req, res) => {
    const key = String(req.params["key"] ?? "");
    const actorUserId = str((req.body as Record<string, unknown> | undefined)?.["actorUserId"]);
    if (!isBuiltIn(key)) throw badRequest("only a built-in sandbox profile can be reset");
    if (await sandboxRepoConfigRepository.find(key)) await sandboxRepoConfigRepository.delete(key);
    log.info(`[sandbox-profiles] ${actorUserId || "unknown"} reset "${key}" to built-in`);
    ok(res, { key });
  }),
);
