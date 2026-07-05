import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { encrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { hasConnectorDefinition } from "../mcp/connector-definitions.js";
import { syncToolsForServer } from "../tool-sync.js";

import { createLogger } from "../logger.js";
const log = createLogger("users");
const router = Router();

/**
 * GET /users[?q=<substr>]
 *
 * List claw users for the Contributors typeahead. Only returns people who
 * already exist locally — sharing is limited to people who've actually
 * interacted with claw (webhook, dashboard, scheduled job). New Spaces
 * users become resolvable automatically once they trigger any JIT path.
 *
 * The `q` filter does a case-insensitive substring match on both `email`
 * and `name`. Capped at 20 to keep the dropdown payload small.
 *
 * Response: `{ success: true, data: [{ id, email, name }, ...] }`
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const qRaw = req.query["q"];
    const q = typeof qRaw === "string" ? qRaw.trim() : "";

    const users = await prisma.user.findMany({
      ...(q
        ? {
            where: {
              OR: [
                { email: { contains: q, mode: "insensitive" as const } },
                { name: { contains: q, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
      select: { id: true, email: true, name: true },
      orderBy: { name: "asc" },
      take: 20,
    });

    res.json({ success: true, data: users });
  } catch (err) {
    log.error("[users] list error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

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

    const sessionUserId = req.headers["x-user-id"];
    if (typeof sessionUserId === "string" && sessionUserId && sessionUserId !== id.trim()) {
      res.status(403).json({ success: false, error: "Body id does not match authenticated session" });
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
        log.error("[users] auto-configure xyne-spaces failed:", err);
      });
    }

    res.json({ success: true, data: user });
  } catch (err) {
    log.error("[users] upsert error:", err);
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

  const spacesUrl = CONFIG.spacesInternalUrl;
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
      log.error(`[users] tool sync failed for ${serverType}:`, err);
    });
  }

  log.info(`[users] Auto-configured xyne-spaces for user ${userId}`);

  // Also auto-connect xyne-spaces-app-tools for this user.
  // Stores the default agent's spacesAppToken so the MCP server can post autonomously
  // without user approval (bot action, not user action).
  try {
    let appToolsServer = await prisma.mcpServer.findFirst({ where: { type: "xyne-spaces-app-tools" } });
    if (!appToolsServer) {
      appToolsServer = await prisma.mcpServer.create({
        data: {
          name: "Xyne Spaces App Tools",
          type: "xyne-spaces-app-tools",
          url: "",
          description: "Bot/app-credential write tools for Xyne Spaces — uses agent app token (not user token).",
        },
      });
    }

    // Resolve the default agent's app token — this is the bot identity the server will post as.
    const defaultAgent = await prisma.agent.findFirst({ where: { isDefault: true } });
    let decryptedAppToken = "";
    if (defaultAgent?.spacesAppToken) {
      const { decrypt } = await import("../crypto.js");
      const { CONFIG: cfg } = await import("../config.js");
      const parts = defaultAgent.spacesAppToken.split(":");
      if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
        try {
          decryptedAppToken = decrypt(parts[0], parts[1], parts[2], cfg.encryptionKey);
        } catch {
          log.error("[users] failed to decrypt agent spacesAppToken for xyne-spaces-app-tools");
        }
      }
    }

    const appToolsCredentials = { url: spacesUrl, app_token: decryptedAppToken };
    const encryptedAppTools = encrypt(JSON.stringify(appToolsCredentials), CONFIG.encryptionKey);
    await prisma.userMcpConnection.upsert({
      where: { userId_mcpServerId: { userId, mcpServerId: appToolsServer.id } },
      create: {
        userId,
        mcpServerId: appToolsServer.id,
        encryptedCreds: encryptedAppTools.ciphertext,
        iv: encryptedAppTools.iv,
        authTag: encryptedAppTools.authTag,
      },
      update: {
        encryptedCreds: encryptedAppTools.ciphertext,
        iv: encryptedAppTools.iv,
        authTag: encryptedAppTools.authTag,
      },
    });

    const appToolsType = "xyne-spaces-app-tools";
    if (await hasConnectorDefinition(appToolsType)) {
      syncToolsForServer(userId, appToolsType, appToolsServer.name, appToolsCredentials).catch((err) => {
        log.error(`[users] tool sync failed for ${appToolsType}:`, err);
      });
    }

    log.info(`[users] Auto-configured xyne-spaces-app-tools for user ${userId}`);
  } catch (err) {
    log.error(`[users] auto-configure xyne-spaces-app-tools failed for user ${userId}:`, err);
    // Non-fatal — don't block the spaces configuration
  }
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
    log.error("[users] get error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as usersRouter };
