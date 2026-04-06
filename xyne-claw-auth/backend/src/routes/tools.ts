import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { hasAdapter } from "../mcp/runner.js";
import { syncToolsForServer } from "../tool-sync.js";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
    const tools = await prisma.tool.findMany({
      orderBy: [{ source: "asc" }, { name: "asc" }],
    });
    res.json({ success: true, data: tools });
  } catch (err) {
    console.error("[tools] list error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/sync", async (_req: Request, res: Response) => {
  try {
    // Find all connections grouped by server type, pick one per type
    const connections = await prisma.userMcpConnection.findMany({
      include: { mcpServer: true },
      distinct: ["mcpServerId"],
    });

    let totalSynced = 0;
    const errors: string[] = [];

    for (const conn of connections) {
      if (!hasAdapter(conn.mcpServer.type)) continue;

      try {
        const decrypted = decrypt(conn.encryptedCreds, conn.iv, conn.authTag, CONFIG.encryptionKey);
        const credentials = JSON.parse(decrypted) as Record<string, unknown>;
        const count = await syncToolsForServer(conn.userId, conn.mcpServer.type, conn.mcpServer.name, credentials);
        totalSynced += count;
      } catch (err) {
        const msg = `${conn.mcpServer.type}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        console.error(`[tools/sync] ${msg}`);
      }
    }

    // Also ensure builtin tools exist
    const builtins = [
      { slug: "builtin__bash", name: "bash", description: "Execute shell commands", source: "builtin" },
      { slug: "builtin__read", name: "read", description: "Read files", source: "builtin" },
      { slug: "builtin__write", name: "write", description: "Write files", source: "builtin" },
      { slug: "builtin__edit", name: "edit", description: "Edit files", source: "builtin" },
      { slug: "builtin__grep", name: "grep", description: "Search file contents with regex", source: "builtin" },
      { slug: "builtin__find", name: "find", description: "Find files by pattern", source: "builtin" },
      { slug: "builtin__ls", name: "ls", description: "List directory contents", source: "builtin" },
    ];

    for (const b of builtins) {
      await prisma.tool.upsert({
        where: { slug: b.slug },
        create: b,
        update: { name: b.name, description: b.description },
      });
    }
    totalSynced += builtins.length;

    res.json({ success: true, data: { synced: totalSynced, errors } });
  } catch (err) {
    console.error("[tools/sync] error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as toolsRouter };
