import { Router } from "express";
import { asyncHandler, badRequest, notFound, ok } from "../lib/http.js";
import { loadEffectiveRepoConfigs } from "../lib/sandbox-repo-configs.js";
import { findSandboxKeys } from "../lib/repo-url.js";

export const sandboxReposInternalRouter = Router();

sandboxReposInternalRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    ok(res, await loadEffectiveRepoConfigs());
  }),
);

export const sandboxRepoResolveRouter = Router();

sandboxRepoResolveRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const repoUrl = typeof req.query["repoUrl"] === "string" ? req.query["repoUrl"].trim() : "";
    if (!repoUrl) throw badRequest("repoUrl is required");
    const keys = findSandboxKeys(await loadEffectiveRepoConfigs(), repoUrl);
    if (keys.length === 0) throw notFound(`no sandbox config for ${repoUrl}`, "sandbox_repo_not_found");
    ok(res, { sandboxKey: keys[0], sandboxKeys: keys });
  }),
);
