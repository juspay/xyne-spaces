/**
 * Onyx eval callback receiver — claw's S2S POST of the ask-ai run's terminal
 * payload lands here, and the full result is stashed to Redis so the onyx
 * eval worker can pick it up deterministically.
 *
 * This is the ONLY endpoint under the onyx routes family that claw reaches;
 * mounted WITHOUT requireAuth/requireClawAdmin — the S2S key is the auth.
 *
 * The callback payload (per claw's sendCallback contract): { sessionId,
 * conversationId, agentSlug, status, lastTurn?, result?, toolInvocations? } —
 * normalised by the worker; this route persists it VERBATIM as the audit trail.
 */
import { Router, type Request, type Response } from "express";
import { stashOnyxCompletion, type OnyxAgentRunOutcome } from "../../services/onyx/onyxAgentClient.js";
import * as store from "../../services/onyx/onyxEvalStore.js";

// Stash key format: runId→questionId round-trip happens purely in the
// conversationId — the worker doesn't need a second marker channel.
import { createLogger } from "../../logger.js";
const log = createLogger("onyx-evals-callback");

const router = Router();

// The payload's per-run conversation convention: `onyx_<runId>_<questionIdSan>_<epoch>`
function refFrom(conversationId: string): { runId: string; epoch: number } | null {
  const m = /^onyx_(?<runId>[A-Za-z0-9-]+?)_/.exec(conversationId);
  if (!m?.groups?.["runId"]) return null;
  const epochMatch = /_(?<epoch>\d+)$/.exec(conversationId);
  return { runId: m.groups["runId"], epoch: Number(epochMatch?.groups?.["epoch"] ?? 0) };
}

// Mounted at `${BASE}/onyx-evals/callback` — the claw → claw-auth call surface
// for bench runs ONLY (its S2S guard fires there; admin routes land elsewhere).
router.post("/", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const conversationId = typeof body["conversationId"] === "string" ? body["conversationId"] : null;
  if (!conversationId || !conversationId.startsWith("onyx_")) {
    log.warn(`[onyx-evals-callback] rejected (no onyx_ prefix): ${JSON.stringify(body).slice(0, 200)}`);
    res.status(400).json({ success: false, error: "bench run callback comes only from a bench-spawned conversation" });
    return;
  }
  const ref = refFrom(conversationId);
  if (!ref) {
    res.status(400).json({ success: false, error: "no run+question ref embedded in conversationId" });
    return;
  }
  const runRow = await store.getRun(ref.runId);
  if (!runRow) {
    res.status(404).json({ success: false, error: `run ${ref.runId} not found — stale callback` });
    return;
  }
  // questionId discovery: middle segment after `onyx_<runId>_` and before
  // the trailing `_<epoch>`. Benchmark ids are already kebab-safe (their
  // sanitisation round-trip is the identity), so the raw id round-trips.
  const middle = conversationId.slice("onyx_".length + ref.runId.length + 1);
  const lastUnderscore = middle.lastIndexOf("_");
  if (lastUnderscore < 0) {
    res.status(400).json({ success: false, error: "malformed bench conversationId — no epoch suffix" });
    return;
  }
  const questionId = middle.slice(0, lastUnderscore);

  const statusMap: Record<string, OnyxAgentRunOutcome["status"]> = {
    completed: "completed",
    failed: "failed",
    cancelled: "cancelled",
    handoff: "completed",
  };
  const status = statusMap[String(body["status"] ?? "completed")] ?? "completed";

  const rawAnswer = String(body["result"] ?? body["lastTurn"] ?? "");
  const toolInvocations = Array.isArray(body["toolInvocations"]) ? (body["toolInvocations"] as unknown[]) : null;
  const outcome: OnyxAgentRunOutcome = {
    sessionId: String(body["sessionId"] ?? ""),
    status,
    answerText: rawAnswer.trim() || null,
    toolInvocations,
    rawPayload: body,
    error: status !== "completed" ? String(body["error"] ?? status) : null,
  };
  await stashOnyxCompletion({ runId: ref.runId, questionId }, outcome);

  res.json({ success: true });
});

export { router as onyxEvalsCallbackRouter };
