import { Router, type Request, type Response } from "express";
import { interact, type SpacesAuthContext } from "../mcp/servers/xyne-spaces-client.js";
import { spacesAppFetchGet } from "../lib/spaces-api.js";
import { prisma } from "../db.js";
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { getRequesterId } from "../middleware/agent-acl.js";

interface SpacesChannelRow {
  id: string;
  name: string;
  scopeType: string;
  visibility: string;
  participantCount?: number;
  lastActivityAt?: string;
  project?: { name?: string } | null;
}

// Shape returned by GET /api/apps/channel/list on the Spaces backend
interface AppChannelListItem {
  id: string;
  name: string;
  description?: string;
  scopeType: string;
  projectId: string;
  createdBy: string;
  createdAt: string;
}

interface AppChannelListResponse {
  items: AppChannelListItem[];
  hasMore: boolean;
  nextCursor?: string;
}

const router = Router();

async function resolveUserSpacesAuth(userId: string): Promise<SpacesAuthContext | null> {
  const connection = await prisma.userMcpConnection.findFirst({
    where: { userId, mcpServer: { type: "xyne-spaces" } },
  });
  if (!connection) return null;

  const decrypted = decrypt(
    connection.encryptedCreds,
    connection.iv,
    connection.authTag,
    CONFIG.encryptionKey,
  );
  const credentials = JSON.parse(decrypted) as Record<string, unknown>;
  const tokenRaw = credentials["token"];
  const urlRaw = credentials["url"];
  const sessionIdRaw = credentials["sessionId"];

  const token = typeof tokenRaw === "string" ? tokenRaw.trim() : "";
  if (!token) return null;

  const baseUrl = typeof urlRaw === "string" && urlRaw.trim() ? urlRaw.trim() : CONFIG.spacesInternalUrl;
  const sessionId = typeof sessionIdRaw === "string" && sessionIdRaw.trim() ? sessionIdRaw.trim() : undefined;

  return {
    token,
    baseUrl,
    ...(sessionId ? { sessionId } : {}),
  };
}

async function resolveAgentAppToken(agentSlug?: string): Promise<string | null> {
  const agent = await prisma.agent.findFirst({
    where: agentSlug
      ? { slug: agentSlug, spacesAppToken: { not: null } }
      : { spacesAppToken: { not: null } },
    select: { spacesAppToken: true },
  });
  if (!agent?.spacesAppToken) return null;

  const parts = agent.spacesAppToken.split(":");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;

  return decrypt(parts[0], parts[1], parts[2], CONFIG.encryptionKey) || null;
}

// GET /api/v1/spaces/channels?q=&limit=&scopeType=&agentSlug=
//
// Channel picker proxy. Two auth paths:
//   1. User has a Spaces MCP connection → use their token with /api/query
//      (ACL-scoped to what they can see).
//   2. No user connection → use the agent's app token with
//      GET /api/apps/channel/list (authenticateApp, no user session needed).
router.get("/channels", async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "x-user-id required" });
    return;
  }

  const agentSlug = typeof req.query["agentSlug"] === "string" ? req.query["agentSlug"].trim() : undefined;
  const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
  const scopeType =
    typeof req.query["scopeType"] === "string" ? req.query["scopeType"] : "DEFAULT";
  const limitRaw = Number(req.query["limit"] ?? 50);
  const limit = Math.max(1, Math.min(isFinite(limitRaw) ? limitRaw : 50, 200));

  const userAuth = await resolveUserSpacesAuth(requesterId).catch((err) => {
    console.error("[spaces/channels] failed to load MCP credentials:", err);
    return null;
  });

  // Path 1: user MCP connection — existing /api/query flow
  if (userAuth) {
    const where: Record<string, unknown> = {};
    if (q.length > 0) where["name"] = { contains: q, mode: "insensitive" };
    if (scopeType) where["scopeType"] = { equals: scopeType };

    try {
      const rows = (await interact({
        model: "channel",
        operation: "findMany",
        where,
        orderBy: [{ lastActivityAt: "desc" }],
        take: limit,
        include: { project: { select: { name: true } } },
      }, userAuth)) as SpacesChannelRow[];

      res.json({
        success: true,
        data: rows.map((r) => ({
          id: r.id,
          name: r.name,
          scopeType: r.scopeType,
          visibility: r.visibility,
          participantCount: r.participantCount ?? 0,
          lastActivityAt: r.lastActivityAt ?? null,
          projectName: r.project?.name ?? null,
        })),
      });
    } catch (err) {
      console.error("[spaces/channels] list error:", err);
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : "Failed to list channels",
      });
    }
    return;
  }

  // Path 2: no user MCP connection — use agent app token with /api/apps/channel/list
  const appToken = await resolveAgentAppToken(agentSlug).catch((err) => {
    console.error("[spaces/channels] failed to load agent app token:", err);
    return null;
  });

  if (!appToken) {
    res.status(412).json({
      success: false,
      error: "Xyne Spaces MCP connection not found for this user. Connect Spaces first.",
    });
    return;
  }

  try {
    const params = new URLSearchParams({ limit: String(limit), scopeType });
    const result = (await spacesAppFetchGet(
      `/channel/list?${params.toString()}`,
      appToken,
    )) as AppChannelListResponse;

    let items = result.items ?? [];

    // /api/apps/channel/list doesn't support name search — filter client-side
    if (q) {
      const lq = q.toLowerCase();
      items = items.filter((c) => c.name.toLowerCase().includes(lq));
    }

    res.json({
      success: true,
      data: items.map((c) => ({
        id: c.id,
        name: c.name,
        scopeType: c.scopeType,
        visibility: "PUBLIC",
        participantCount: 0,
        lastActivityAt: null,
        projectName: null,
      })),
    });
  } catch (err) {
    console.error("[spaces/channels] app-token list error:", err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to list channels",
    });
  }
});

export { router as spacesRouter };
