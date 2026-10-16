import { Router } from "express";
import { asyncHandler, ok } from "../lib/http.js";
import { loadEffectiveRepoConfigs } from "../lib/sandbox-repo-configs.js";

export const sandboxReposInternalRouter = Router();

sandboxReposInternalRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    ok(res, await loadEffectiveRepoConfigs());
  }),
);
