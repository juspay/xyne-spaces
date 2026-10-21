import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { getRequesterId } from "../middleware/agent-acl.js";
import { checkConversationAccess } from "../lib/conversation-access.js";
import { createLogger } from "../logger.js";

const log = createLogger("sandbox-access");

const router = Router();

const SANDBOX_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/;
const MAX_CONVERSATIONS_CHECKED = 20;

export type SandboxAccessReason = "invalid-sandbox" | "unknown-sandbox" | "owner" | "conversation" | "denied";

export async function resolveSandboxAccess(
  sandboxId: string,
  userId: string,
  // Claw sandbox-owner rows are keyed by the CANONICAL id (`userId`); the Spaces
  // conversation-access check matches channel_participants by the RAW Spaces id.
  // Pass both so a non-owner collaborator is authorized against the right id.
  spacesUserId: string = userId,
): Promise<{ allow: boolean; reason: SandboxAccessReason }> {
  if (!SANDBOX_ID_RE.test(sandboxId)) return { allow: false, reason: "invalid-sandbox" };

  const rows = await prisma.conversationArtifact.findMany({
    where: { refService: "CLAW", refId: sandboxId },
    select: { conversationId: true, createdByUserId: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  if (rows.length === 0) return { allow: false, reason: "unknown-sandbox" };
  if (rows.some((row) => row.createdByUserId === userId)) return { allow: true, reason: "owner" };

  const conversationIds = [...new Set(rows.map((row) => row.conversationId))].slice(0, MAX_CONVERSATIONS_CHECKED);
  for (const conversationId of conversationIds) {
    if ((await checkConversationAccess(conversationId, spacesUserId)) === "ok") {
      return { allow: true, reason: "conversation" };
    }
  }
  return { allow: false, reason: "denied" };
}

router.get("/", async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  const spacesUserId = typeof req.headers["x-spaces-user-id"] === "string" && req.headers["x-spaces-user-id"]
    ? (req.headers["x-spaces-user-id"] as string)
    : userId;
  const sandboxId = typeof req.query["sandboxId"] === "string" ? req.query["sandboxId"].trim() : "";
  if (!userId) {
    res.status(401).json({ allow: false });
    return;
  }
  try {
    const { allow, reason } = await resolveSandboxAccess(sandboxId, userId, spacesUserId);
    if (!allow) log.warn(`[sandbox-access] deny sandbox=${sandboxId} user=${userId} reason=${reason}`);
    res.status(allow ? 200 : 403).json({ allow, reason });
  } catch (err) {
    log.error(`[sandbox-access] lookup failed sandbox=${sandboxId}: ${err instanceof Error ? err.message : String(err)}`);
    res.status(503).json({ allow: false });
  }
});

export default router;
