import { Router, type Request, type Response } from "express";
import { availableServerTypesSafe } from "../lib/connector-availability.js";
import { createLogger } from "../logger.js";

const log = createLogger("connectors-internal");

const MAX_TYPES = 12;

export const connectorsInternalRouter = Router();

connectorsInternalRouter.post("/available", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { userId?: unknown; serverTypes?: unknown };
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const serverTypes = Array.isArray(body.serverTypes)
    ? [
        ...new Set(
          body.serverTypes
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.trim().toLowerCase())
            .filter((t) => t.length > 0),
        ),
      ].slice(0, MAX_TYPES)
    : [];

  if (!userId || serverTypes.length === 0) {
    res.json({ success: true, connected: [], known: false });
    return;
  }

  const available = await availableServerTypesSafe(userId, serverTypes);
  if (!available) {
    log.warn(`[connectors-internal] availability unknown for user ${userId}`);
    res.json({ success: true, connected: [], known: false });
    return;
  }

  res.json({ success: true, connected: serverTypes.filter((t) => available.has(t)), known: true });
});
