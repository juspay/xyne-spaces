import { Router, type Request, type Response } from "express";
import { asyncHandler, ok, badRequest, notFound, HttpError } from "../lib/http.js";
import { prisma } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { validateCredentials } from "../validation.js";
import { checkHealth } from "../health.js";
import { verifyMcpCredentials } from "../lib/mcp-credential-verify.js";
import { availabilityForServerIds } from "../lib/connector-availability.js";
import { hasConnectorDefinition } from "../mcp/connector-definitions.js";
import { evictSession } from "../mcp/runner.js";
import { syncToolsForServer } from "../tool-sync.js";
import { pinUserIdParam } from "../middleware/pin-user-id-param.js";
import { getWorkspaceIdForUser } from "../lib/spaces-db.js";

import { createLogger } from "../logger.js";
const log = createLogger("connections");

const router = Router();

router.use("/:userId", pinUserIdParam);

router.get("/:userId/connections", asyncHandler(async (req: Request<{ userId: string }>, res: Response) => {
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

  ok(res, data);
}));

// GET /:userId/connections/availability
router.get("/:userId/connections/availability", asyncHandler(async (req: Request<{ userId: string }>, res: Response) => {
  const userId = req.params.userId;
  const servers = await prisma.mcpServer.findMany({ where: { enabled: true }, select: { id: true, type: true } });
  const availability = await availabilityForServerIds(userId, servers.map((s) => s.id));

  ok(
    res,
    servers.map((server) => ({
      mcpServerId: server.id,
      type: server.type,
      personal: availability.personal.has(server.id),
      org: availability.org.has(server.id),
    })),
  );
}));

router.post("/:userId/connections", asyncHandler(async (req: Request<{ userId: string }>, res: Response) => {
  const userId = req.params.userId;
  const { mcpServerId, credentials } = req.body as {
    mcpServerId?: string;
    credentials?: Record<string, unknown>;
  };

  if (!mcpServerId || typeof mcpServerId !== "string") {
    throw badRequest("mcpServerId is required");
  }

  if (!credentials || typeof credentials !== "object") {
    throw badRequest("credentials is required and must be an object");
  }

  const serverExists = await prisma.mcpServer.findUnique({ where: { id: mcpServerId } });
  if (!serverExists) {
    throw notFound("MCP server not found");
  }

  const validation = await validateCredentials(serverExists.type, credentials);
  if (!validation.valid) {
    throw badRequest(validation.error);
  }

  await evictSession(userId, serverExists.type).catch(() => {});
  const verification = await verifyMcpCredentials({
    sessionKey: userId,
    serverType: serverExists.type,
    serverName: serverExists.name,
    credentials: credentials as Record<string, unknown>,
  });
  if (!verification.ok) {
    throw new HttpError(verification.kind === "rejected" ? 400 : 502, verification.message);
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

  // Auto-register tools from this MCP server. First evict any cached MCP
  // child process for this user+server — its env was baked at spawn time
  // and won't pick up the new credentials we just wrote without a respawn.
  await evictSession(userId, serverExists.type).catch((err) => {
    log.error(`[connections] evictSession failed for ${serverExists.type}:`, err);
  });
  if (await hasConnectorDefinition(serverExists.type)) {
    syncToolsForServer(userId, serverExists.type, serverExists.name, credentials as Record<string, unknown>).catch((err) => {
      log.error(`[connections] tool sync failed for ${serverExists.type}:`, err);
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
}));

router.delete("/:userId/connections/:id", asyncHandler(async (req: Request<{ userId: string; id: string }>, res: Response) => {
  const userId = req.params.userId;
  const id = req.params.id;

  const connection = await prisma.userMcpConnection.findFirst({
    where: { id, userId },
    include: { mcpServer: true },
  });

  if (!connection) {
    throw notFound("Connection not found");
  }

  await prisma.userMcpConnection.delete({ where: { id } });

  // Drop any cached MCP client/transport for this (user, serverType) pair so
  // the next listTools/callTool doesn't hit a stale bearer token.
  await evictSession(userId, connection.mcpServer.type).catch((err) => {
    log.error(`[connections] evictSession failed for ${connection.mcpServer.type}:`, err);
  });

  ok(res);
}));

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

    // Google uses OAuth tokens, not MCP adapters — do a direct API health check
    if (connection.mcpServer.type === "google") {
      const start = Date.now();
      try {
        const token = (credentials as { accessToken?: string }).accessToken;
        if (!token) {
          res.json({ success: true, data: { healthy: false, message: "No access token stored", latencyMs: 0 } });
          return;
        }
        const gRes = await fetch("https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=" + encodeURIComponent(token));
        const latencyMs = Date.now() - start;
        if (gRes.ok) {
          const info = (await gRes.json()) as { email?: string; expires_in?: number };
          res.json({ success: true, data: { healthy: true, message: `Connected as ${info.email ?? "unknown"} (expires in ${info.expires_in ?? "?"}s)`, latencyMs } });
        } else {
          // Token expired but we have a refresh token — still "connected"
          const refreshToken = (credentials as { refreshToken?: string }).refreshToken;
          if (refreshToken) {
            res.json({ success: true, data: { healthy: true, message: "Token expired but refresh token available — will auto-refresh on next use", latencyMs } });
          } else {
            res.json({ success: true, data: { healthy: false, message: "Token expired and no refresh token", latencyMs } });
          }
        }
      } catch (err) {
        res.json({ success: true, data: { healthy: false, message: err instanceof Error ? err.message : "Health check failed", latencyMs: Date.now() - start } });
      }
      return;
    }

    // Microsoft uses OAuth tokens, not MCP adapters — do a direct API health check
    if (connection.mcpServer.type === "microsoft") {
      const start = Date.now();
      try {
        const token = (credentials as { accessToken?: string }).accessToken;
        if (!token) {
          res.json({ success: true, data: { healthy: false, message: "No access token stored", latencyMs: 0 } });
          return;
        }
        const msRes = await fetch("https://graph.microsoft.com/v1.0/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const latencyMs = Date.now() - start;
        if (msRes.ok) {
          const info = (await msRes.json()) as { displayName?: string; mail?: string };
          res.json({ success: true, data: { healthy: true, message: `Connected as ${info.displayName ?? info.mail ?? "unknown"}`, latencyMs } });
        } else if (msRes.status === 401) {
          // Token expired but we have a refresh token — still "connected"
          const refreshToken = (credentials as { refreshToken?: string }).refreshToken;
          if (refreshToken) {
            res.json({ success: true, data: { healthy: true, message: "Token expired but refresh token available — will auto-refresh on next use", latencyMs } });
          } else {
            res.json({ success: true, data: { healthy: false, message: "Token expired and no refresh token", latencyMs } });
          }
        } else {
          const errorText = await msRes.text();
          res.json({ success: true, data: { healthy: false, message: `Microsoft API error: ${msRes.status} ${errorText}`, latencyMs } });
        }
      } catch (err) {
        res.json({ success: true, data: { healthy: false, message: err instanceof Error ? err.message : "Health check failed", latencyMs: Date.now() - start } });
      }
      return;
    }

    // Calendly is an MCP-based adapter — use the standard MCP health check via checkHealth()
    // (Do NOT call Calendly REST API directly as MCP OAuth tokens have different scopes)

    const result = await checkHealth(userId, connection.mcpServer.type, connection.mcpServer.name, credentials);

    // Auto-sync tools on successful health check. The connection-create path
    // already fires syncToolsForServer fire-and-forget at L97, but that can
    // race the MCP child's cold-start (e.g. `npx -y @modelcontextprotocol/server-github`
    // — observed in prod as "Connection closed" → tools table stays empty,
    // health check later succeeds because npx has warmed up).
    //
    // Re-running sync here closes the gap: the user clicks "Health Check",
    // sees ✓, and the tool table is guaranteed to reflect what the MCP server
    // actually exposes. Sync is idempotent (upsert by slug), so this is a
    // no-op when previous sync already succeeded. Fire-and-forget so the
    // health-check response isn't delayed.
    if (result.healthy) {
      syncToolsForServer(
        userId,
        connection.mcpServer.type,
        connection.mcpServer.name,
        credentials,
      ).catch((err) => {
        log.error(`[connections] post-health tool sync failed for ${connection.mcpServer.type}:`, err);
      });
    }

    res.json({ success: true, data: result });
  } catch (err) {
    log.error("[connections] health check error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/:userId/connections/auto-connect-spaces", asyncHandler(async (req: Request<{ userId: string }>, res: Response) => {
  const userId = req.params.userId;

  // No token is required (or stored) any more. Web sessions are the opaque
  // httpOnly `xs` cookie, so the browser carries no JWT to forward; the user
  // was already identified by requireAuth (/api/auth/me). The connection row
  // only records WHO the Spaces tools act as — the runner mints a short-lived
  // token for that user at spawn time (lib/spaces-auth.ts).
  const workspaceHeader = req.headers["x-workspace-id"];
  const hintCookie = /(?:^|;\s*)xyne_last_workspace=([^;]*)/.exec(req.headers.cookie ?? "")?.[1];
  const requestedWorkspaceId =
    (typeof workspaceHeader === "string" && workspaceHeader.trim()) || (hintCookie ? decodeURIComponent(hintCookie) : undefined);

  const serverType = "xyne-spaces";
  let server = await prisma.mcpServer.findFirst({ where: { type: serverType } });
  if (!server) {
    server = await prisma.mcpServer.create({
      data: { name: "Xyne Spaces", type: serverType, url: "", description: "Internal Xyne Spaces platform integration" },
    });
  }

  const credentials: Record<string, string> = { url: CONFIG.spacesInternalUrl, authMode: "session", userId };
  const resolvedWorkspaceId = requestedWorkspaceId ?? await getWorkspaceIdForUser(userId, "require-auth").catch(() => null);
  if (resolvedWorkspaceId) credentials["workspaceId"] = resolvedWorkspaceId;
  const encrypted = encrypt(JSON.stringify(credentials), CONFIG.encryptionKey);

  const connection = await prisma.userMcpConnection.upsert({
    where: { userId_mcpServerId: { userId, mcpServerId: server.id } },
    create: { userId, mcpServerId: server.id, encryptedCreds: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag },
    update: { encryptedCreds: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag },
    include: { mcpServer: true },
  });

  // Evict the cached MCP child so its baked-in env (XYNE_SPACES_TOKEN,
  // XYNE_SPACES_WORKSPACE_ID) is rebuilt from the freshly stored identity on
  // the next mcp/call.
  await evictSession(userId, serverType).catch((err) => {
    log.error(`[connections] evictSession failed for ${serverType}:`, err);
  });
  if (await hasConnectorDefinition(serverType)) {
    syncToolsForServer(userId, serverType, server.name, credentials).catch((err) => {
      log.error(`[connections] tool sync failed for ${serverType}:`, err);
    });
  }

  log.info(`[connections] Auto-connected xyne-spaces for user ${userId}`);
  ok(res, { id: connection.id, mcpServer: connection.mcpServer });
}));

export { router as connectionsRouter };
