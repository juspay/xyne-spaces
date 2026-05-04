import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { encrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { hasConnectorDefinition } from "../mcp/connector-definitions.js";
import { syncToolsForServer } from "../tool-sync.js";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  try {
    const { id, email, name, spacesToken } = req.body as {
      id?: string;
      email?: string;
      name?: string;
      spacesToken?: string;
    };

    if (!id || typeof id !== "string" || id.trim().length === 0) {
      res.status(400).json({ success: false, error: "id is required" });
      return;
    }

    if (!email || typeof email !== "string" || email.trim().length === 0) {
      res.status(400).json({ success: false, error: "email is required" });
      return;
    }

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ success: false, error: "name is required" });
      return;
    }

    const user = await prisma.user.upsert({
      where: { id: id.trim() },
      create: { id: id.trim(), email: email.trim(), name: name.trim() },
      update: { email: email.trim(), name: name.trim() },
    });

    // Auto-configure xyne-spaces MCP connection if token provided
    if (spacesToken && typeof spacesToken === "string") {
      autoConfigureSpaces(user.id, spacesToken).catch((err) => {
        console.error("[users] auto-configure xyne-spaces failed:", err);
      });
    }

    res.json({ success: true, data: user });
  } catch (err) {
    console.error("[users] upsert error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

async function autoConfigureSpaces(userId: string, token: string): Promise<void> {
  const serverType = "xyne-spaces";

  // Find or create the xyne-spaces MCP server
  let server = await prisma.mcpServer.findFirst({ where: { type: serverType } });
  if (!server) {
    server = await prisma.mcpServer.create({
      data: {
        name: "Xyne Spaces",
        type: serverType,
        url: "",
        description: "Internal Xyne Spaces platform integration",
      },
    });
  }

  const spacesUrl = CONFIG.spacesBackendUrl;
  const credentials = { url: spacesUrl, token };
  const encrypted = encrypt(JSON.stringify(credentials), CONFIG.encryptionKey);

  await prisma.userMcpConnection.upsert({
    where: { userId_mcpServerId: { userId, mcpServerId: server.id } },
    create: {
      userId,
      mcpServerId: server.id,
      encryptedCreds: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    },
    update: {
      encryptedCreds: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    },
  });

  // Sync tools
  if (await hasConnectorDefinition(serverType)) {
    syncToolsForServer(userId, serverType, server.name, credentials).catch((err) => {
      console.error(`[users] tool sync failed for ${serverType}:`, err);
    });
  }

  console.log(`[users] Auto-configured xyne-spaces for user ${userId}`);
}

router.get("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
    });

    if (!user) {
      res.status(404).json({ success: false, error: "User not found" });
      return;
    }

    res.json({ success: true, data: user });
  } catch (err) {
    console.error("[users] get error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as usersRouter };
