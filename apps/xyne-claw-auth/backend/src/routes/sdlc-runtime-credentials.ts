import { Router, type Request, type Response } from "express";
import { CONFIG } from "../config.js";
import { errMsg } from "../lib/errors.js";
import { requireStrictS2S } from "../middleware/require-auth.js";
import { requireSessionToken } from "../middleware/require-session-token.js";

const router = Router();

// Scoped to /sdlc: a bare "/:sessionId" guard shadows other /sessions/:id routes (see routes/mcp.ts).
router.use("/:sessionId/sdlc", requireStrictS2S, requireSessionToken);

// xyne-claw has no Spaces URL, so it bootstraps sandbox git credentials through here.
// The actor comes from the run's session token, not the body. Bodies carry the envelope: never log them.
router.post("/:sessionId/sdlc/runtime-credentials/bootstrap", async (req: Request, res: Response) => {
  const userId = req.session!.userId;
  if ((req.body as { actorUserId?: unknown } | undefined)?.actorUserId !== userId) {
    res.status(403).json({ success: false, error: "SDLC runtime credential binding mismatch" });
    return;
  }
  try {
    const response = await fetch(`${CONFIG.spacesInternalUrl}/api/internal/sdlc/vcs/runtime-credentials/bootstrap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-s2s-key": process.env["INTERNAL_S2S_KEY"] ?? process.env["XYNE_CLAW_S2S_KEY"] ?? "",
        "x-xyne-acting-user-id": userId,
      },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(20_000),
    });
    res.status(response.status).json(await response.json().catch(() => ({})));
  } catch (e) {
    res.status(502).json({ success: false, error: `Spaces unreachable: ${errMsg(e)}` });
  }
});

export { router as sdlcRuntimeCredentialsRouter };
