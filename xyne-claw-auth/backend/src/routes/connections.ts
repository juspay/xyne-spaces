import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { validateCredentials } from "../validation.js";
import { checkHealth } from "../health.js";
import { listToolsForUser, hasAdapter } from "../mcp/runner.js";
import { syncToolsForServer } from "../tool-sync.js";

const router = Router();

router.get("/:userId/connections", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const userId = req.params.userId;

    const connections = await prisma.userMcpConnection.findMany({
      where: { userId },
      include: { mcpServer: true },
      orderBy: { createdAt: "desc" },
    });

    const data = connections.map((c: typeof connections[number]) => ({
      id: c.id,
      userId: c.userId,
      mcpServerId: c.mcpServerId,
      mcpServer: c.mcpServer,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error("[connections] list error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/:userId/connections", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const userId = req.params.userId;
    const { mcpServerId, credentials } = req.body as {
      mcpServerId?: string;
      credentials?: Record<string, unknown>;
    };

    if (!mcpServerId || typeof mcpServerId !== "string") {
      res.status(400).json({ success: false, error: "mcpServerId is required" });
      return;
    }

    if (!credentials || typeof credentials !== "object") {
      res.status(400).json({ success: false, error: "credentials is required and must be an object" });
      return;
    }

    const serverExists = await prisma.mcpServer.findUnique({ where: { id: mcpServerId } });
    if (!serverExists) {
      res.status(404).json({ success: false, error: "MCP server not found" });
      return;
    }

    const validation = validateCredentials(serverExists.type, credentials);
    if (!validation.valid) {
      res.status(400).json({ success: false, error: validation.error });
      return;
    }

    const encrypted = encrypt(JSON.stringify(credentials), CONFIG.encryptionKey);

    const connection = await prisma.userMcpConnection.upsert({
      where: { userId_mcpServerId: { userId, mcpServerId } },
      create: {
        userId,
        mcpServerId,
        encryptedCreds: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      },
      update: {
        encryptedCreds: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      },
      include: { mcpServer: true },
    });

    // Auto-register tools from this MCP server
    if (hasAdapter(serverExists.type)) {
      syncToolsForServer(userId, serverExists.type, serverExists.name, credentials as Record<string, unknown>).catch((err) => {
        console.error(`[connections] tool sync failed for ${serverExists.type}:`, err);
      });
    }

    res.status(201).json({
      success: true,
      data: {
        id: connection.id,
        userId: connection.userId,
        mcpServerId: connection.mcpServerId,
        mcpServer: connection.mcpServer,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      },
    });
  } catch (err) {
    console.error("[connections] create error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.delete("/:userId/connections/:id", async (req: Request<{ userId: string; id: string }>, res: Response) => {
  try {
    const userId = req.params.userId;
    const id = req.params.id;

    const connection = await prisma.userMcpConnection.findFirst({
      where: { id, userId },
    });

    if (!connection) {
      res.status(404).json({ success: false, error: "Connection not found" });
      return;
    }

    await prisma.userMcpConnection.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error("[connections] delete error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/:userId/connections/:id/credentials", async (req: Request<{ userId: string; id: string }>, res: Response) => {
  try {
    const userId = req.params.userId;
    const id = req.params.id;

    const connection = await prisma.userMcpConnection.findFirst({
      where: { id, userId },
      include: { mcpServer: true },
    });

    if (!connection) {
      res.status(404).json({ success: false, error: "Connection not found" });
      return;
    }

    const decrypted = decrypt(
      connection.encryptedCreds,
      connection.iv,
      connection.authTag,
      CONFIG.encryptionKey,
    );

    res.json({
      success: true,
      data: {
        mcpServerId: connection.mcpServerId,
        mcpServer: connection.mcpServer,
        credentials: JSON.parse(decrypted) as Record<string, unknown>,
      },
    });
  } catch (err) {
    console.error("[connections] credentials error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/:userId/connections/:id/health", async (req: Request<{ userId: string; id: string }>, res: Response) => {
  try {
    const userId = req.params.userId;
    const id = req.params.id;

    const connection = await prisma.userMcpConnection.findFirst({
      where: { id, userId },
      include: { mcpServer: true },
    });

    if (!connection) {
      res.status(404).json({ success: false, error: "Connection not found" });
      return;
    }

    const decrypted = decrypt(
      connection.encryptedCreds,
      connection.iv,
      connection.authTag,
      CONFIG.encryptionKey,
    );

    const credentials = JSON.parse(decrypted) as Record<string, unknown>;
    const result = await checkHealth(userId, connection.mcpServer.type, connection.mcpServer.name, credentials);

    res.json({ success: true, data: result });
  } catch (err) {
    console.error("[connections] health check error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/:userId/connections/auto-connect-spaces", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const userId = req.params.userId;
    const { spacesToken } = req.body as { spacesToken?: string };

    if (!spacesToken || typeof spacesToken !== "string") {
      res.status(400).json({ success: false, error: "spacesToken is required" });
      return;
    }

    const serverType = "xyne-spaces";
    let server = await prisma.mcpServer.findFirst({ where: { type: serverType } });
    if (!server) {
      server = await prisma.mcpServer.create({
        data: { name: "Xyne Spaces", type: serverType, url: "", description: "Internal Xyne Spaces platform integration" },
      });
    }

    const credentials = { url: CONFIG.spacesBackendUrl, token: spacesToken };
    const encrypted = encrypt(JSON.stringify(credentials), CONFIG.encryptionKey);

    const connection = await prisma.userMcpConnection.upsert({
      where: { userId_mcpServerId: { userId, mcpServerId: server.id } },
      create: { userId, mcpServerId: server.id, encryptedCreds: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag },
      update: { encryptedCreds: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag },
      include: { mcpServer: true },
    });

    if (hasAdapter(serverType)) {
      syncToolsForServer(userId, serverType, server.name, credentials).catch((err) => {
        console.error(`[connections] tool sync failed for ${serverType}:`, err);
      });
    }

    console.log(`[connections] Auto-connected xyne-spaces for user ${userId}`);
    res.json({ success: true, data: { id: connection.id, mcpServer: connection.mcpServer } });
  } catch (err) {
    console.error("[connections] auto-connect-spaces error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as connectionsRouter };
