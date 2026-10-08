import { Router } from "express";
import { asyncHandler, ok } from "../lib/http.js";
import { SBX_GIT } from "xyne-claw-shared";
import { loadEffectiveRepoConfigs } from "../lib/sandbox-repo-configs.js";

const router = Router();

/**
 * Catalog of sandbox repo setups for the agent-config UI (the "Sandbox
 * repository" dropdown). Source: the effective sandbox repo configs — the static
 * REPO_CONFIGS in xyne-claw-shared overlaid with rows from sandbox_repo_configs
 * (admin-managed), the SAME merged map the xyne-claw runtime fetches from
 * /internal/sandbox-repos to actually set the sandbox up.
 *
 * GET /api/v1/sandbox/repos → { success, data: [{ key, name, description }] }
 */
router.get("/repos", asyncHandler(async (_req, res) => {
  const data = Object.entries(await loadEffectiveRepoConfigs()).map(([key, c]) => ({
    key,
    name: c.name,
    description: c.description,
  }));
  ok(res, data);
}));

/**
 * The individual repos cloned into the shared read-only sbx-git sandbox
 * (SBX_GIT.repoPaths — the SAME list the prebake clones). Used by the agent-config
 * UI's "Repo context" multi-select for read-only (forceReadOnlySandbox) agents.
 *
 * GET /api/v1/sandbox/sbx-git-repos → { success, data: [{ key, path }] }
 */
router.get("/sbx-git-repos", (_req, res) => {
  const data = Object.entries(SBX_GIT.repoPaths).map(([key, path]) => ({ key, path }));
  ok(res, data);
});

export default router;
