/**
 * Evals — import from Spaces: channel listing, folder-scoped + channel-first
 * imports (background jobs), import-job polling.
 */
import { Router, type Request, type Response } from "express";
import { evalRepository } from "../../repositories/index.js";
import { getRequesterId } from "../../middleware/agent-acl.js";
import { getSpacesAuthForUser } from "../../lib/spaces-db.js";
import { listSpacesChannels, type ImportKind } from "../../services/spacesEvalImport.js";
import {
  enqueueEvalImport,
  getEvalImportStatus,
  cancelEvalImport,
  type EvalImportJobData,
} from "../../queue/eval-import-queue.js";

import { createLogger } from "../../logger.js";
const log = createLogger("import");

const router = Router();

// GET /evals/spaces-channels — list the user's Spaces channels for the import
// picker (ACL-scoped). Returns [] if the user has no active Spaces session.
router.get("/spaces-channels", async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: "Unauthenticated" });
    return;
  }
  try {
    const spacesAuth = await getSpacesAuthForUser(userId, "unknown");
    if (!spacesAuth) {
      res.json({ success: true, channels: [], spacesAuth: false });
      return;
    }
    const channels = await listSpacesChannels({
      token: spacesAuth.token,
      sessionId: spacesAuth.sessionId,
      workspaceId: spacesAuth.workspaceId,
    });
    res.json({ success: true, channels, spacesAuth: true });
  } catch (err) {
    log.error("[evals] spaces-channels error:", err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Failed to list channels" });
  }
});

/** Map a time-range preset to a [from, to] window. "all" walks back to 2000. */
function rangeToWindow(range: string): { from: Date; to: Date } {
  const to = new Date();
  const days: Record<string, number> = { "7d": 7, "30d": 30, "3m": 90, "6m": 180, "1y": 365 };
  if (range === "all") return { from: new Date("2000-01-01T00:00:00Z"), to };
  const d = days[range] ?? 30;
  return { from: new Date(to.getTime() - d * 24 * 3600 * 1000), to };
}

// POST /evals/folders/:id/import-from-spaces — enqueue a background import that
// pulls a thread / chat channel / email channel from Spaces (over a time range),
// extracts (query, response) pairs, and creates EvalConversations. Returns a
// jobId immediately; poll GET /import-jobs/:jobId for progress.
// Body: { kind, channelId?, conversationId?, model?, range? }.
router.post("/folders/:id/import-from-spaces", async (req: Request<{ id: string }>, res: Response) => {
  const { kind, channelId, conversationId, model, range } = req.body as {
    kind?: ImportKind;
    channelId?: string;
    conversationId?: string;
    model?: string;
    range?: string;
  };
  if (!kind || !["thread", "channel", "email-channel"].includes(kind)) {
    res.status(400).json({ success: false, error: "kind must be thread | channel | email-channel" });
    return;
  }
  if (kind === "thread" ? !conversationId : !channelId) {
    res.status(400).json({ success: false, error: kind === "thread" ? "conversationId required" : "channelId required" });
    return;
  }
  const userId = getRequesterId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: "Unauthenticated" });
    return;
  }
  const folder = await evalRepository.getFolder(req.params.id);
  if (!folder) {
    res.status(404).json({ success: false, error: "Folder not found" });
    return;
  }
  // Fail fast if there's no Spaces session — better than a job that errors later.
  const spacesAuth = await getSpacesAuthForUser(userId, "scheduled-job");
  if (!spacesAuth) {
    res.status(400).json({
      success: false,
      error: "No active Spaces session for this user (log into Spaces, or SPACES_DB_URL is not configured).",
    });
    return;
  }

  try {
    const data: EvalImportJobData = {
      folderId: req.params.id,
      userId,
      kind,
      ...(channelId ? { channelId } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(model ? { model } : {}),
    };
    if (kind !== "thread") {
      const { from, to } = rangeToWindow(range ?? "30d");
      data.from = from.toISOString();
      data.to = to.toISOString();
    }
    const jobId = await enqueueEvalImport(data);
    res.json({ success: true, jobId });
  } catch (err) {
    log.error("[evals] enqueue import error:", err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Failed to start import" });
  }
});

// POST /evals/import-from-channel — channel-first import. Find-or-creates the
// folder bound to the channel (one folder per channel, stable across renames),
// then enqueues the same background import. Returns { jobId, folderId, folderName }
// so the UI can open/expand the channel's folder. Body: { kind, channelId, model?, range? }.
router.post("/import-from-channel", async (req: Request, res: Response) => {
  const { kind, channelId, model, range } = req.body as {
    kind?: ImportKind;
    channelId?: string;
    model?: string;
    range?: string;
  };
  if (!kind || !["channel", "email-channel"].includes(kind)) {
    res.status(400).json({ success: false, error: "kind must be channel | email-channel" });
    return;
  }
  if (!channelId) {
    res.status(400).json({ success: false, error: "channelId required" });
    return;
  }
  const userId = getRequesterId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: "Unauthenticated" });
    return;
  }
  const spacesAuth = await getSpacesAuthForUser(userId, "scheduled-job");
  if (!spacesAuth) {
    res.status(400).json({
      success: false,
      error: "No active Spaces session for this user (log into Spaces, or SPACES_DB_URL is not configured).",
    });
    return;
  }
  try {
    // Resolve the channel's display name for the folder label (best-effort).
    const channels = await listSpacesChannels({
      token: spacesAuth.token,
      sessionId: spacesAuth.sessionId,
      workspaceId: spacesAuth.workspaceId,
    });
    const name = channels.find((c) => c.id === channelId)?.name?.trim() || channelId;
    const folder = await evalRepository.findOrCreateChannelFolder({ channelId, name, sourceKind: kind, createdBy: userId });

    const { from, to } = rangeToWindow(range ?? "30d");
    const data: EvalImportJobData = {
      folderId: folder.id,
      userId,
      kind,
      channelId,
      from: from.toISOString(),
      to: to.toISOString(),
      ...(model ? { model } : {}),
    };
    const jobId = await enqueueEvalImport(data);
    res.json({ success: true, jobId, folderId: folder.id, folderName: folder.name });
  } catch (err) {
    log.error("[evals] import-from-channel error:", err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Failed to start import" });
  }
});

// GET /evals/import-jobs/:jobId — poll background import progress.
router.get("/import-jobs/:jobId", async (req: Request<{ jobId: string }>, res: Response) => {
  try {
    const status = await getEvalImportStatus(req.params.jobId);
    if (!status) {
      res.status(404).json({ success: false, error: "Job not found" });
      return;
    }
    res.json({ success: true, ...status });
  } catch (err) {
    log.error("[evals] import-job status error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch job status" });
  }
});

// POST /evals/import-jobs/:jobId/cancel — request cancellation.
router.post("/import-jobs/:jobId/cancel", async (req: Request<{ jobId: string }>, res: Response) => {
  try {
    const ok = await cancelEvalImport(req.params.jobId);
    res.json({ success: ok });
  } catch (err) {
    log.error("[evals] import-job cancel error:", err);
    res.status(500).json({ success: false, error: "Failed to cancel job" });
  }
});

export { router as evalsRouter };

export { router as evalImportRouter };
