/**
 * Search Evals — sheet upload/list/detail. The frontend parses the uploaded
 * CSV client-side (same convention as evals/folders.ts's paste-import: the
 * browser does the parsing, the backend just validates the resulting rows)
 * and posts structured rows here.
 */
import { Router, type Request, type Response } from "express";
import { searchEvalRepository, type SearchEvalQueryInput } from "../../repositories/index.js";
import { getRequesterId, getOrgId } from "../../middleware/agent-acl.js";

import { createLogger } from "../../logger.js";
const log = createLogger("search-evals/sheets");

const router = Router();

const MAX_QUERIES_PER_SHEET = 2000;
const VALID_PERMISSION_MODES = new Set(["with", "without"]);

function normalizeQueries(raw: unknown): { queries: SearchEvalQueryInput[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "queries must be a non-empty array" };
  }
  if (raw.length > MAX_QUERIES_PER_SHEET) {
    return { error: `queries exceeds the maximum of ${MAX_QUERIES_PER_SHEET} rows (got ${raw.length})` };
  }
  const queries: SearchEvalQueryInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] as {
      query?: unknown;
      goldAnswer?: unknown;
      goldId?: unknown;
    };
    if (!row || typeof row.query !== "string" || !row.query.trim()) {
      return { error: `row ${i}: query is required` };
    }
    if (typeof row.goldId !== "string" || !row.goldId.trim()) {
      return { error: `row ${i}: goldId is required` };
    }
    queries.push({
      query: row.query.trim(),
      goldAnswer: typeof row.goldAnswer === "string" ? row.goldAnswer : null,
      goldId: row.goldId.trim(),
    });
  }
  return { queries };
}

// POST /search-evals/sheets — upload a parsed sheet
router.post("/sheets", async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(400).json({ success: false, error: "Could not resolve org for this request" });
    return;
  }
  const { name, description, queries: rawQueries, permissionMode, asOfTimestamp } = req.body as {
    name?: unknown;
    description?: unknown;
    queries?: unknown;
    permissionMode?: unknown;
    asOfTimestamp?: unknown;
  };
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ success: false, error: "name is required" });
    return;
  }
  const descriptionValue = typeof description === "string" && description.trim() ? description.trim() : null;
  if (typeof permissionMode !== "string" || !VALID_PERMISSION_MODES.has(permissionMode)) {
    res.status(400).json({ success: false, error: 'permissionMode must be "with" or "without"' });
    return;
  }
  let asOf: Date | null = null;
  if (typeof asOfTimestamp === "string" && asOfTimestamp.trim()) {
    const parsed = new Date(asOfTimestamp);
    if (Number.isNaN(parsed.getTime())) {
      res.status(400).json({ success: false, error: "asOfTimestamp is not a valid date" });
      return;
    }
    asOf = parsed;
  }
  const normalized = normalizeQueries(rawQueries);
  if ("error" in normalized) {
    res.status(400).json({ success: false, error: normalized.error });
    return;
  }
  try {
    const sheet = await searchEvalRepository.createSheet({
      name: name.trim(),
      description: descriptionValue,
      orgId,
      permissionMode: permissionMode as "with" | "without",
      asOfTimestamp: asOf,
      createdBy: getRequesterId(req) ?? null,
      queries: normalized.queries,
    });
    res.json({ success: true, sheet });
  } catch (err) {
    log.error("[search-evals] createSheet error:", err);
    res.status(500).json({ success: false, error: "Failed to create sheet" });
  }
});

// GET /search-evals/sheets — list sheets for the caller's org
router.get("/sheets", async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(400).json({ success: false, error: "Could not resolve org for this request" });
    return;
  }
  try {
    const sheets = await searchEvalRepository.listSheets(orgId);
    res.json({ success: true, sheets });
  } catch (err) {
    log.error("[search-evals] listSheets error:", err);
    res.status(500).json({ success: false, error: "Failed to list sheets" });
  }
});

// GET /search-evals/sheets/:id — sheet detail incl. its query rows
router.get("/sheets/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const sheet = await searchEvalRepository.getSheet(req.params.id);
    if (!sheet) {
      res.status(404).json({ success: false, error: "Sheet not found" });
      return;
    }
    res.json({ success: true, sheet });
  } catch (err) {
    log.error("[search-evals] getSheet error:", err);
    res.status(500).json({ success: false, error: "Failed to load sheet" });
  }
});

export { router as searchEvalSheetsRouter };
