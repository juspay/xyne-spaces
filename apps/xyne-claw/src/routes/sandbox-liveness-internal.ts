import { Router, type Request, type Response } from "express";
import { checkSandboxLiveness, MAX_LIVENESS_IDS } from "xyne-claw-shared";
import { validateS2SKey } from "../middleware/auth.js";
import { createLogger } from "../logger.js";

const log = createLogger("sandbox-liveness-internal");

const router = Router();

/**
 * XYNE-66339: claw-auth asks which announced sandboxes still exist, so it can
 * mark the previews of ended ones STALE. S2S only. The caller supplies ids, not
 * a namespace: the namespace comes from this pod's platform env.
 *
 * Body: { sandboxIds: string[] } (at most MAX_LIVENESS_IDS)
 * 200:  { success: true, liveness: { [id]: "alive" | "ended" | "unknown" } }
 */
router.post("/internal/sandboxes/liveness", validateS2SKey, async (req: Request, res: Response) => {
  const raw = (req.body as { sandboxIds?: unknown } | undefined)?.sandboxIds;
  if (!Array.isArray(raw) || raw.length > MAX_LIVENESS_IDS) {
    res.status(400).json({ success: false, error: `sandboxIds must be an array of at most ${MAX_LIVENESS_IDS} ids` });
    return;
  }
  try {
    const liveness = await checkSandboxLiveness(raw);
    const ended = Object.values(liveness).filter((v) => v === "ended").length;
    if (ended > 0) log.info(`[sandbox-liveness] ${ended}/${Object.keys(liveness).length} sandbox(es) ended`);
    res.json({ success: true, liveness });
  } catch (err) {
    log.error(`[sandbox-liveness] failed: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({ success: false, error: "Liveness check failed" });
  }
});

export { router as sandboxLivenessInternalRouter };
