/**
 * Evals router — composed from focused sub-routers. All routes are mounted
 * behind requireAuth + requireClawAdmin in main.ts (evals are admin-only).
 */
import { Router } from "express";
import { evalFoldersRouter } from "./folders.js";
import { evalGenerationsRouter } from "./generations.js";
import { evalJudgingRouter } from "./judging.js";
import { evalImportRouter } from "./import.js";

const router = Router();
router.use(evalFoldersRouter);
router.use(evalGenerationsRouter);
router.use(evalJudgingRouter);
router.use(evalImportRouter);

export { router as evalsRouter };
