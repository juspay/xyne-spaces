/**
 * Search Evals — live rank-profile listing per entity type, read straight
 * off Vespa's deployed .sd schema (see vespa-schema-profiles.ts) instead of
 * a hand-maintained list, so a profile added to a schema and redeployed
 * shows up in the eval UI's "Rank profile" dropdown immediately.
 */
import { Router, type Request, type Response } from "express";
import { resolveArea } from "../../mcp/servers/vespa-search-areas.js";
import { TYPE_TO_AREA, ALL_AREAS } from "../../mcp/servers/search-eval-vespa.js";
import { getSchemaRankProfiles, getCommonRankProfiles } from "../../mcp/servers/vespa-schema-profiles.js";

import { createLogger } from "../../logger.js";
const log = createLogger("search-evals/rank-profiles");

const router = Router();

// GET /search-evals/rank-profiles?type=messages|tickets|files|emails|channels
// Omitted/"" type = "All types" — returns the intersection across every
// area's schema, since Vespa applies exactly ONE ranking.profile to a
// federated query (see buildFederatedYqlFromParams).
router.get("/rank-profiles", async (req: Request, res: Response) => {
  const type = typeof req.query["type"] === "string" ? req.query["type"] : "";
  try {
    if (!type) {
      const sources = ALL_AREAS
        .map((areaName) => resolveArea(areaName)?.source)
        .filter((s): s is string => Boolean(s));
      const profiles = await getCommonRankProfiles(sources);
      res.json({ success: true, profiles });
      return;
    }

    const areaName = TYPE_TO_AREA[type];
    const area = areaName ? resolveArea(areaName) : null;
    if (!area) {
      res.status(400).json({ success: false, error: `Unsupported entity type "${type}".` });
      return;
    }

    const profiles = await getSchemaRankProfiles(area.source);
    res.json({ success: true, profiles });
  } catch (err) {
    log.error(`[search-evals/rank-profiles] failed for type "${type}":`, err instanceof Error ? err.message : err);
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch rank profiles from Vespa's config server.",
    });
  }
});

export { router as searchEvalRankProfilesRouter };
