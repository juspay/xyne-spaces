/**
 * Search Evals router — composed from focused sub-routers. Mounted behind
 * requireAuth + requireSearchEvalAccess in main.ts (CLAW_ADMIN or the
 * narrower SEARCH_EVAL_ACCESS role — see middleware/agent-acl.ts).
 */
import { Router } from "express";
import { searchEvalSheetsRouter } from "./sheets.js";
import { searchEvalRunsRouter } from "./runs.js";
import { searchEvalExportRouter } from "./export.js";
import { searchEvalRankProfilesRouter } from "./rank-profiles.js";

const router = Router();
router.use(searchEvalSheetsRouter);
router.use(searchEvalRunsRouter);
router.use(searchEvalExportRouter);
router.use(searchEvalRankProfilesRouter);

export { router as searchEvalsRouter };
