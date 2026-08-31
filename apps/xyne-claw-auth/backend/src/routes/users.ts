import { Router, type Request, type Response } from "express";
import { asyncHandler, ok, badRequest, forbidden, notFound, HttpError } from "../lib/http.js";
import { prisma } from "../db.js";
import { encrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { hasConnectorDefinition } from "../mcp/connector-definitions.js";
import { syncToolsForServer } from "../tool-sync.js";
import { getDefaultOrgId, ensureOrgMembership, ensureUserExists } from "../lib/users-jit.js";
import { getOrgId, getRequesterId } from "../middleware/agent-acl.js";
import { getWorkspaceIdForUser } from "../lib/spaces-db.js";

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
router.get("/", asyncHandler(async (req: Request, res: Response) => {
  const qRaw = req.query["q"];
  const q = typeof qRaw === "string" ? qRaw.trim() : "";
  const requesterId = getRequesterId(req);
  const orgId = getOrgId(req)
    ?? (requesterId
      ? (await prisma.user.findUnique({ where: { id: requesterId }, select: { orgId: true } }))?.orgId
      : undefined);
  if (!orgId) {
    log.error(`[users] orgId is required; refusing global user typeahead requesterId=${requesterId ?? "none"} q=${q || "none"}`);
    throw badRequest("orgId is required");
  }

  const users = await prisma.user.findMany({
    where: {
      orgId,
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" as const } },
              { name: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: { id: true, email: true, name: true },
    orderBy: { name: "asc" },
    take: 20,
  });

  ok(res, users);
}));

router.post("/", asyncHandler(async (req: Request, res: Response) => {
  const { id, email, name, spacesToken } = req.body as {
    id?: string;
    email?: string;
    name?: string;
    spacesToken?: string;
  };

  if (!id || typeof id !== "string" || id.trim().length === 0) {
    throw badRequest("id is required");
  }

  if (!email || typeof email !== "string" || email.trim().length === 0) {
    throw badRequest("email is required");
  }

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw badRequest("name is required");
  }

  const sessionUserId = req.headers["x-user-id"];
  if (typeof sessionUserId === "string" && sessionUserId && sessionUserId !== id.trim()) {
    throw forbidden("Body id does not match authenticated session");
  }

  // Org placement (§13): prefer the mapping-aware JIT path so a second-tenant
  // user lands in the RIGHT org (via SurfaceTenantLink), not the default. It
  // creates the row (with the mapped org + membership) if new, then we sync the
  // client-supplied email/name. If JIT can't resolve the Spaces profile
  // (transient DB miss / user not in Spaces), fall back to creating from the
  // request body in the default org — preserves this endpoint's resilience.
  let user;
  const jitOk = await ensureUserExists(id.trim(), "require-auth");
  if (jitOk) {
    user = await prisma.user.update({
      where: { id: id.trim() },
      data: { email: email.trim(), name: name.trim() },
    });
    // Gap 8: re-assert OrgMembership for a pre-existing user (ensureUserExists
    // short-circuits without touching it when the row already exists). Idempotent.
    await ensureOrgMembership(user.id, user.orgId);
  } else {
    // orgId is NOT NULL — a new user row must carry it at insert time.
    const orgId = await getDefaultOrgId();
    if (!orgId) {
      log.error(`[users] default org not provisioned — cannot create user ${id.trim()}. Run backfill-default-org.ts.`);
      throw new HttpError(503, "Default organization not provisioned");
    }
    user = await prisma.user.upsert({
      where: { id: id.trim() },
      create: { id: id.trim(), email: email.trim(), name: name.trim(), orgId },
      update: { email: email.trim(), name: name.trim() },
    });
    await ensureOrgMembership(user.id, orgId);
  }

  // Auto-configure xyne-spaces MCP connection if token provided
  if (spacesToken && typeof spacesToken === "string") {
    autoConfigureSpaces(user.id, spacesToken).catch((err) => {
      log.error("[users] auto-configure xyne-spaces failed:", err);
    });
  }

  ok(res, user);
}));

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
  const workspaceId = await getWorkspaceIdForUser(userId, "require-auth").catch(() => null);
  const credentials = {
    url: spacesUrl,
    token,
    ...(workspaceId ? { workspaceId } : {}),
  };
  if (workspaceId) {
    log.info(`[users] Auto-configured xyne-spaces workspaceId=${workspaceId} for user ${userId}`);
  }
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

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } });
    if (!user?.orgId) {
      log.error(`[users] orgId is required; refusing global default-agent lookup for xyne-spaces-app-tools userId=${userId}`);
      return;
    }

    // Resolve the default agent's app token — this is the bot identity the server will post as.
    const defaultAgent = await prisma.agent.findFirst({ where: { orgId: user.orgId, isDefault: true } });
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

router.get("/:id", asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const requesterId = getRequesterId(req);
  const orgId =
    getOrgId(req) ??
    (requesterId
      ? (await prisma.user.findUnique({ where: { id: requesterId }, select: { orgId: true } }))?.orgId
      : undefined);
  if (!orgId) {
    log.error(`[users] orgId is required; refusing cross-org user lookup requesterId=${requesterId ?? "none"} id=${req.params.id}`);
    throw badRequest("orgId is required");
  }

  const user = await prisma.user.findFirst({
    where: { id: req.params.id, orgId },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    throw notFound("User not found");
  }

  ok(res, user);
}));

export { router as usersRouter };
