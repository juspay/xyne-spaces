import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { asyncHandler, ok, badRequest, forbidden, notFound, HttpError } from "../lib/http.js";
import { prisma } from "../db.js";
import { encrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { hasConnectorDefinition } from "../mcp/connector-definitions.js";
import { syncToolsForServer } from "../tool-sync.js";
import {
  getDefaultOrgId,
  ensureOrgMembership,
  ensureUserExists,
  resolveClawUserIdForSpacesIdentity,
} from "../lib/users-jit.js";
import { getOrgId, getRequesterId } from "../middleware/agent-acl.js";
import { getWorkspaceIdForUser } from "../lib/spaces-db.js";
import { getCanonicalRequesterId, matchesAuthenticatedUserId } from "../middleware/pin-user-id-param.js";

import { createLogger } from "../logger.js";
const log = createLogger("users");
const router = Router();

/**
 * GET /users/me
 *
 * The Spaces cookie identifies a workspace-scoped Spaces user, whereas Claw
 * owns the canonical person id. `requireAuth` resolves that identity before
 * this handler runs and stamps both values onto the request. The SPA must use
 * `userId` for every Claw URL; retaining the raw Spaces id here is useful only
 * to callers that also need to call Spaces directly.
 */
router.get("/me", (req: Request, res: Response) => {
  const userId = req.headers["x-user-id"];
  if (typeof userId !== "string" || !userId) {
    res.status(401).json({ success: false, error: "authenticated user required" });
    return;
  }

  const spacesUserId = req.headers["x-spaces-user-id"];
  const spacesWorkspaceId = req.headers["x-spaces-workspace-id"];
  const spacesOrgMemberId = req.headers["x-spaces-org-member-id"];
  res.json({
    success: true,
    data: {
      userId,
      ...(typeof spacesUserId === "string" && spacesUserId ? { spacesUserId } : {}),
      ...(typeof spacesWorkspaceId === "string" && spacesWorkspaceId ? { spacesWorkspaceId } : {}),
      ...(typeof spacesOrgMemberId === "string" && spacesOrgMemberId ? { spacesOrgMemberId } : {}),
    },
  });
});

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

  if (getCanonicalRequesterId(req) && !matchesAuthenticatedUserId(req, id.trim())) {
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
    const clawUserId = await resolveClawUserIdForSpacesIdentity(id.trim());
    if (!clawUserId) {
      log.error(`[users] JIT resolved Spaces user ${id.trim()} but no Claw identity exists`);
      throw new HttpError(503, "User identity is still being synchronized");
    }
    user = await prisma.user.update({
      where: { id: clawUserId },
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
    user = await prisma.user.create({
      data: {
        id: `claw-user-${randomUUID()}`,
        email: email.trim(),
        name: name.trim(),
        orgId,
      },
    });
    await ensureOrgMembership(user.id, orgId);
  }

  // Auto-configure xyne-spaces MCP connection if token provided
  if (spacesToken && typeof spacesToken === "string") {
    autoConfigureSpaces(user.id, id.trim(), spacesToken).catch((err) => {
      log.error("[users] auto-configure xyne-spaces failed:", err);
    });
  }

  ok(res, user);
}));

async function autoConfigureSpaces(clawUserId: string, spacesUserId: string, token: string): Promise<void> {
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
  const workspaceId = await getWorkspaceIdForUser(spacesUserId, "require-auth").catch(() => null);
  const credentials = {
    url: spacesUrl,
    token,
    ...(workspaceId ? { workspaceId } : {}),
  };
  if (workspaceId) {
    log.info(`[users] Auto-configured xyne-spaces workspaceId=${workspaceId} for user ${clawUserId}`);
  }
  const encrypted = encrypt(JSON.stringify(credentials), CONFIG.encryptionKey);

  await prisma.userMcpConnection.upsert({
    where: { userId_mcpServerId: { userId: clawUserId, mcpServerId: server.id } },
    create: {
      userId: clawUserId,
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
    syncToolsForServer(clawUserId, serverType, server.name, credentials).catch((err) => {
      log.error(`[users] tool sync failed for ${serverType}:`, err);
    });
  }

  log.info(`[users] Auto-configured xyne-spaces for user ${clawUserId}`);

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

    const user = await prisma.user.findUnique({ where: { id: clawUserId }, select: { orgId: true } });
    if (!user?.orgId) {
      log.error(`[users] orgId is required; refusing global default-agent lookup for xyne-spaces-app-tools userId=${clawUserId}`);
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
      where: { userId_mcpServerId: { userId: clawUserId, mcpServerId: appToolsServer.id } },
      create: {
        userId: clawUserId,
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
      syncToolsForServer(clawUserId, appToolsType, appToolsServer.name, appToolsCredentials).catch((err) => {
        log.error(`[users] tool sync failed for ${appToolsType}:`, err);
      });
    }

    log.info(`[users] Auto-configured xyne-spaces-app-tools for user ${clawUserId}`);
  } catch (err) {
    log.error(`[users] auto-configure xyne-spaces-app-tools failed for user ${clawUserId}:`, err);
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
