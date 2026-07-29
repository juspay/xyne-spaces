/**
 * Evals — folder tree + conversation CRUD (manual paste-import included).
 * Split out of the old single evals router; mounted by ./index.ts.
 */
import { Router, type Request, type Response } from "express";
import { evalRepository, type ImportConversationInput } from "../../repositories/index.js";
import { getRequesterId } from "../../middleware/agent-acl.js";

import { createLogger } from "../../logger.js";
const log = createLogger("folders");

const router = Router();

function normalizeImport(raw: unknown): { conversations: ImportConversationInput[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "conversations must be a non-empty array" };
  }
  const conversations: ImportConversationInput[] = [];
  for (let c = 0; c < raw.length; c++) {
    const conv = raw[c] as { title?: unknown; source?: unknown; externalId?: unknown; turns?: unknown };
    if (!conv || typeof conv !== "object" || !Array.isArray(conv.turns) || conv.turns.length === 0) {
      return { error: `conversation ${c} must have a non-empty turns array` };
    }
    const turns = [];
    for (let t = 0; t < conv.turns.length; t++) {
      const turn = conv.turns[t] as { message?: unknown; expectedResponse?: unknown };
      if (!turn || typeof turn.message !== "string" || !turn.message.trim()) {
        return { error: `conversation ${c} turn ${t}: message is required` };
      }
      turns.push({
        message: turn.message,
        expectedResponse: typeof turn.expectedResponse === "string" ? turn.expectedResponse : null,
      });
    }
    conversations.push({
      title: typeof conv.title === "string" ? conv.title : null,
      source: typeof conv.source === "string" ? conv.source : null,
      externalId: typeof conv.externalId === "string" ? conv.externalId : null,
      turns,
    });
  }
  return { conversations };
}


// ── Folders ─────────────────────────────────────────────────────────────

// GET /evals/folders — full folder tree (flat list with counts; UI builds tree)
router.get("/folders", async (_req: Request, res: Response) => {
  try {
    const folders = await evalRepository.listFolders();
    res.json({ success: true, folders });
  } catch (err) {
    log.error("[evals] listFolders error:", err);
    res.status(500).json({ success: false, error: "Failed to list folders" });
  }
});

// POST /evals/folders — create a folder
router.post("/folders", async (req: Request, res: Response) => {
  const { name } = req.body as { name?: string };
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ success: false, error: "name is required" });
    return;
  }
  try {
    const folder = await evalRepository.createFolder({
      name: name.trim(),
      createdBy: getRequesterId(req) ?? null,
    });
    res.json({ success: true, folder });
  } catch (err) {
    log.error("[evals] createFolder error:", err);
    res.status(500).json({ success: false, error: "Failed to create folder" });
  }
});

// DELETE /evals/folders/:id — delete folder + its conversations (cascade)
router.delete("/folders/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    await evalRepository.deleteFolder(req.params.id);
    res.json({ success: true });
  } catch (err) {
    log.error("[evals] deleteFolder error:", err);
    res.status(500).json({ success: false, error: "Failed to delete folder" });
  }
});

// ── Conversations ─────────────────────────────────────────────────────────

// GET /evals/folders/:id/conversations?skip=&take=&search=
router.get("/folders/:id/conversations", async (req: Request<{ id: string }>, res: Response) => {
  const skip = Number(req.query["skip"] ?? 0) || 0;
  const take = Math.min(Number(req.query["take"] ?? 100) || 100, 500);
  const search = typeof req.query["search"] === "string" ? (req.query["search"] as string) : undefined;
  try {
    const result = await evalRepository.listConversations(req.params.id, { skip, take, search });
    res.json({ success: true, ...result });
  } catch (err) {
    log.error("[evals] listConversations error:", err);
    res.status(500).json({ success: false, error: "Failed to list conversations" });
  }
});

// POST /evals/folders/:id/conversations — bulk import conversations into folder
router.post("/folders/:id/conversations", async (req: Request<{ id: string }>, res: Response) => {
  const folder = await evalRepository.getFolder(req.params.id);
  if (!folder) {
    res.status(404).json({ success: false, error: "Folder not found" });
    return;
  }
  const normalized = normalizeImport((req.body as { conversations?: unknown }).conversations);
  if ("error" in normalized) {
    res.status(400).json({ success: false, error: normalized.error });
    return;
  }
  try {
    const result = await evalRepository.importConversations(
      req.params.id,
      normalized.conversations,
      getRequesterId(req) ?? null,
    );
    res.json({ success: true, imported: result.count });
  } catch (err) {
    log.error("[evals] importConversations error:", err);
    res.status(500).json({ success: false, error: "Failed to import conversations" });
  }
});

// GET /evals/conversations/:id — full conversation with turns
router.get("/conversations/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const conversation = await evalRepository.getConversation(req.params.id);
    if (!conversation) {
      res.status(404).json({ success: false, error: "Conversation not found" });
      return;
    }
    res.json({ success: true, conversation });
  } catch (err) {
    log.error("[evals] getConversation error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch conversation" });
  }
});

// DELETE /evals/conversations/:id
router.delete("/conversations/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    await evalRepository.deleteConversation(req.params.id);
    res.json({ success: true });
  } catch (err) {
    log.error("[evals] deleteConversation error:", err);
    res.status(500).json({ success: false, error: "Failed to delete conversation" });
  }
});


export { router as evalFoldersRouter };
