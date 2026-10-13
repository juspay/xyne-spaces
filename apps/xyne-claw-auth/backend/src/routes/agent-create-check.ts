import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { createAgentNotGranted, createAgentQueueError } from "../lib/agent-draft-card.js";
import { errMsg } from "../lib/errors.js";
import { createLogger } from "../logger.js";

const log = createLogger("agent-create-check");

export const agentCreateCheckRouter = Router();

agentCreateCheckRouter.post("/check", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { userId?: unknown; params?: unknown };
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const params =
    body.params && typeof body.params === "object" && !Array.isArray(body.params)
      ? (body.params as Record<string, unknown>)
      : null;

  if (!userId || !params) {
    res.json({ success: true, known: false, error: null, notGranted: [] });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } });
    if (!user?.orgId) {
      res.json({ success: true, known: false, error: null, notGranted: [] });
      return;
    }
    const error = await createAgentQueueError(params, user.orgId);
    const notGranted = error ? [] : await createAgentNotGranted(params, user.orgId, userId);
    res.json({ success: true, known: true, error, notGranted });
  } catch (err) {
    log.warn(`[agent-create-check] check failed: ${errMsg(err)}`);
    res.json({ success: true, known: false, error: null, notGranted: [] });
  }
});
