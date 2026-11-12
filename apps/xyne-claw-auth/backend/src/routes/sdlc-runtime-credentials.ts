import { Router, type Request, type Response } from "express";
import { CONFIG } from "../config.js";
import { errMsg } from "../lib/errors.js";
import { spacesUserIdForClawUser, userIdAliasesFor } from "../lib/users-jit.js";
import { requireRuntime, serviceAuthHeaders } from "../lib/service-assertion.js";
import { requireSessionToken } from "../middleware/require-session-token.js";

const router = Router();

// Scoped to /sdlc: a bare "/:sessionId" guard shadows other /sessions/:id routes (see routes/mcp.ts).
router.use("/:sessionId/sdlc", requireRuntime, requireSessionToken);

// xyne-claw has no Spaces URL, so it bootstraps sandbox git credentials through here.
// The actor comes from the run's session token, not the body. Bodies carry the envelope: never log them.
router.post("/:sessionId/sdlc/runtime-credentials/bootstrap", async (req: Request, res: Response) => {
  // The session token pins the canonical Claw id, while the pod's hub context
  // carries the workspace-scoped Spaces id (SdlcAgentContextService
  // actorUserId). Accept ANY id form of the token's own user — and no one
  // else's — as the binding.
  const userId = req.session!.userId;
  const body = req.body as { actorUserId?: unknown; workspaceId?: unknown } | undefined;
  const actorUserId = typeof body?.actorUserId === "string" ? body.actorUserId.trim() : "";
  const aliases = await userIdAliasesFor(userId).catch(() => [userId]);
  if (!actorUserId || !aliases.includes(actorUserId)) {
    res.status(403).json({ success: false, error: "SDLC runtime credential binding mismatch" });
    return;
  }
  // Spaces keys acting users by the workspace-scoped id — forward that form.
  const workspaceId =
    typeof body?.workspaceId === "string" && body.workspaceId.trim() ? body.workspaceId.trim() : undefined;
  const actingUserId = await spacesUserIdForClawUser(userId, workspaceId).catch(() => userId);
  try {
    const url = `${CONFIG.spacesInternalUrl}/api/internal/sdlc/vcs/runtime-credentials/bootstrap`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...serviceAuthHeaders("xyne-spaces", "POST", url),
        "x-xyne-acting-user-id": actingUserId,
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
