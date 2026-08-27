import { Router } from "express";
import { ok } from "../lib/http.js";
import { REPO_CONFIGS, SBX_GIT } from "xyne-claw-shared";

const router = Router();

/**
 * Catalog of sandbox repo setups for the agent-config UI (the "Sandbox
 * repository" dropdown). Single source of truth: REPO_CONFIGS in
 * xyne-claw-shared — the SAME object the xyne-claw runtime uses to actually set
 * the sandbox up. Add a repo to REPO_CONFIGS and it appears here automatically;
 * no hardcoding / drift.
 *
 * GET /api/v1/sandbox/repos → { success, data: [{ key, name, description }] }
 */
router.get("/repos", (_req, res) => {
  const data = Object.entries(REPO_CONFIGS).map(([key, c]) => ({
    key,
    name: c.name,
    description: c.description,
  }));
  ok(res, data);
});

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
