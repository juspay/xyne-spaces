/**
 * S2S endpoint exposing the eval-pair extractor to claw-auth.
 *
 * claw-auth fetches a thread from Spaces, normalizes it (role tags, quote
 * stripping), POSTs the ordered messages here, and gets back the selected
 * (query, response) pairs — reconstructed verbatim from the thread.
 */
import { Router, type Request, type Response } from "express";
import { validateS2SKey } from "../middleware/auth.js";
import { extractEvalPairs, type ThreadMessage } from "../eval-extract.js";

const router = Router();

const ROLES = new Set(["customer", "human-agent", "bot", "other"]);

router.post("/eval-extract", validateS2SKey, async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { messages?: unknown; kind?: unknown; model?: unknown; copilot?: { token?: unknown; model?: unknown } } | undefined;
  if (!body || !Array.isArray(body.messages)) {
    res.status(400).json({ success: false, error: "messages array is required" });
    return;
  }

  const messages: ThreadMessage[] = [];
  for (const m of body.messages) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    if (typeof o["id"] !== "string" || typeof o["text"] !== "string") continue;
    messages.push({
      id: o["id"],
      text: o["text"],
      role: ROLES.has(o["role"] as string) ? (o["role"] as ThreadMessage["role"]) : "other",
    });
  }
  if (messages.length === 0) {
    res.status(400).json({ success: false, error: "no valid messages (need {id, text, role})" });
    return;
  }

  const copilot =
    body.copilot && typeof body.copilot.token === "string" && typeof body.copilot.model === "string"
      ? { token: body.copilot.token, model: body.copilot.model }
      : undefined;
  const result = await extractEvalPairs({
    messages,
    ...(copilot ? { copilot } : {}),
    kind: body.kind === "email" ? "email" : "chat",
    model: typeof body.model === "string" ? body.model : undefined,
  });

  res.json({ success: true, ...result });
});

export { router as evalExtractRouter };
