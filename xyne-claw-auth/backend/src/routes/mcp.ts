import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { prisma } from "../db.js";
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { listToolsForUser, callTool, hasAdapter } from "../mcp/runner.js";

function signAction(action: Record<string, unknown>): string {
  return crypto.createHmac("sha256", CONFIG.encryptionKey).update(JSON.stringify(action)).digest("hex");
}

export function verifyActionSignature(action: Record<string, unknown>, signature: string): boolean {
  const expected = signAction(action);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

const router = Router();

router.get("/:userId/mcp/tools", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;

    const connections = await prisma.userMcpConnection.findMany({
      where: { userId },
      include: { mcpServer: true },
    });

    const results = await Promise.allSettled(
      connections
        .filter((c) => hasAdapter(c.mcpServer.type))
        .map(async (c) => {
          const decrypted = decrypt(c.encryptedCreds, c.iv, c.authTag, CONFIG.encryptionKey);
          const credentials = JSON.parse(decrypted) as Record<string, unknown>;
          return listToolsForUser(userId, c.mcpServer.type, c.mcpServer.name, credentials);
        }),
    );

    const data = results
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof listToolsForUser>>> => r.status === "fulfilled")
      .map((r) => r.value);

    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));

    if (errors.length > 0) {
      console.error("[mcp/tools] Some servers failed to list tools:", errors);
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("[mcp/tools] error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/:userId/mcp/call", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;
    const { serverType, tool, params, permission } = req.body as {
      serverType?: string;
      tool?: string;
      params?: Record<string, unknown>;
      permission?: string;
    };

    if (!serverType || typeof serverType !== "string") {
      res.status(400).json({ success: false, error: "serverType is required" });
      return;
    }

    if (!tool || typeof tool !== "string") {
      res.status(400).json({ success: false, error: "tool is required" });
      return;
    }

    if (!hasAdapter(serverType)) {
      res.status(400).json({ success: false, error: `No adapter for server type: ${serverType}` });
      return;
    }

    const connection = await prisma.userMcpConnection.findFirst({
      where: { userId, mcpServer: { type: serverType } },
      include: { mcpServer: true },
    });

    if (!connection) {
      res.status(404).json({ success: false, error: `No connection found for user and server type: ${serverType}` });
      return;
    }

    const decrypted = decrypt(
      connection.encryptedCreds,
      connection.iv,
      connection.authTag,
      CONFIG.encryptionKey,
    );
    const credentials = JSON.parse(decrypted) as Record<string, unknown>;

    console.log(`[mcp/call] user=${userId} server=${serverType} tool=${tool} permission=${permission ?? "allow"}`);

    if (permission === "ask") {
      const action = { serverType, tool, params: params ?? {}, userId };
      const signature = signAction(action);
      res.json({ success: true, data: { content: `Action queued for approval: ${tool}`, pendingAction: { ...action, signature } } });
      return;
    }

    const result = await callTool(userId, serverType, credentials, tool, params ?? {});

    res.json({ success: true, data: result });
  } catch (err) {
    console.error("[mcp/call] error:", err);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal server error" });
  }
});

export { router as mcpRouter };
