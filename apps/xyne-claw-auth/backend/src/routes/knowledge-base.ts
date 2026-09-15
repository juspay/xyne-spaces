import { Router, type Request, type Response } from "express";
import { asyncHandler, ok, unauthorized } from "../lib/http.js";
import { getRequesterId } from "../middleware/agent-acl.js";
import { fetchAccessibleKb } from "../lib/spaces-kb.js";
import { createLogger } from "../logger.js";

const log = createLogger("knowledge-base");
const router = Router();

/**
 * Frontend KB picker entry point.
 *
 * GET /claw/api/v1/knowledge-base/tree?includeItems=1
 *
 * Returns the requesting user's accessible spaces collections (and, when
 * includeItems=1, their full sub-folder + file trees). The handler holds NO
 * permission logic of its own — it forwards to spaces `/api/collections/
 * accessible` using the user's active session, so anything that surfaces here
 * is something the user can already open in spaces' KB UI. Driven by
 * lib/spaces-kb.ts.
 *
 * Used by the "Knowledge Base" section in the Create/Edit-Agent UI to render
 * a per-file picker.
 */
router.get("/tree", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized();
  }

  const includeItems = req.query.includeItems === "1" || req.query.includeItems === "true";
  const scopeType = typeof req.query.scopeType === "string" ? req.query.scopeType : undefined;
  const scopeId = typeof req.query.scopeId === "string" ? req.query.scopeId : undefined;

  const tree = await fetchAccessibleKb(requesterId, {
    includeItems,
    ...(scopeType ? { scopeType } : {}),
    ...(scopeId ? { scopeId } : {}),
  });
  if (tree === null) {
    // No active spaces session — the picker should ask the user to log in
    // to spaces. Surface a 200 with empty collections + a flag so the
    // frontend can render the right state.
    ok(res, undefined, { collections: [] as unknown[], noSpacesSession: true });
    return;
  }

  ok(res, undefined, { collections: tree });
}));

export { router as knowledgeBaseRouter };
