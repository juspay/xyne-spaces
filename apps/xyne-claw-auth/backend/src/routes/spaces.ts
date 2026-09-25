import { Router, type Request, type Response } from "express";
import { interact, spacesFetch, type SpacesAuthContext } from "../mcp/servers/xyne-spaces-client.js";
import { spacesAppFetchGet } from "../lib/spaces-api.js";
import { prisma } from "../db.js";
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { getRequesterId, getOrgId } from "../middleware/agent-acl.js";
import { getSpacesAuthForUser, getWorkspaceIdForUser, requestWorkspaceHint } from "../lib/spaces-db.js";

import { createLogger } from "../logger.js";
const log = createLogger("spaces");

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

interface SpacesProjectRow {
  id: string;
  name: string;
  description?: string | null;
  updatedAt?: string | Date | null;
}

interface SpacesBoardRow {
  id: string;
  name: string;
  description?: string | null;
  projectId?: string | null;
  updatedAt?: string | Date | null;
  project?: { name?: string | null } | null;
}

const router = Router();

async function resolveUserSpacesAuth(userId: string, workspaceHint?: string): Promise<SpacesAuthContext | null> {
  // Prefer a LIVE token from the Spaces session DB. getSpacesAuthForUser reads
  // the user's active session and, if the access token has expired, refreshes
  // it via Spaces' /api/auth/refresh-session — the same mechanism the MCP
  // runner uses. Without this we decrypt the token cached in userMcpConnection
  // at connect-time and use it verbatim; once it expires (Spaces JWTs are
  // short-lived) every call here 401s with "Invalid or expired session" until
  // the user re-connects. This is why some users hit that error on the channel
  // picker "always".
  const live = await getSpacesAuthForUser(userId, "require-auth", workspaceHint).catch(() => null);
  if (live?.token) {
    return {
      token: live.token,
      baseUrl: CONFIG.spacesInternalUrl,
      ...(live.sessionId ? { sessionId: live.sessionId } : {}),
      workspaceId: live.workspaceId,
    };
  }

  // Fallback: the cached MCP-connection credentials (works until they expire).
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
  const workspaceIdRaw = credentials["workspaceId"];

  const token = typeof tokenRaw === "string" ? tokenRaw.trim() : "";
  if (!token) return null;

  const baseUrl = typeof urlRaw === "string" && urlRaw.trim() ? urlRaw.trim() : CONFIG.spacesInternalUrl;
  const sessionId = typeof sessionIdRaw === "string" && sessionIdRaw.trim() ? sessionIdRaw.trim() : undefined;
  const workspaceIdFromCreds = typeof workspaceIdRaw === "string" && workspaceIdRaw.trim() ? workspaceIdRaw.trim() : undefined;
  const workspaceId = workspaceIdFromCreds ?? await getWorkspaceIdForUser(userId, "require-auth", workspaceHint).catch(() => null) ?? undefined;
  if (!workspaceIdFromCreds && workspaceId) {
    log.info(`[spaces] resolved workspaceId=${workspaceId} from user row for cached auth userId=${userId}`);
  }

  return {
    token,
    baseUrl,
    ...(sessionId ? { sessionId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
  };
}

async function resolveAgentAppToken(orgId: string | undefined, agentSlug?: string): Promise<string | null> {
  if (!orgId) {
    log.error(`[spaces] orgId is required; refusing global app-token lookup agentSlug=${agentSlug ?? "none"}`);
    return null;
  }
  const agent = await prisma.agent.findFirst({
    where: agentSlug
      ? { orgId, slug: agentSlug, spacesAppToken: { not: null } }
      : { orgId, isDefault: true, spacesAppToken: { not: null } },
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
  const orgId = getOrgId(req)
    ?? (await prisma.user.findUnique({ where: { id: requesterId }, select: { orgId: true } }))?.orgId;
  const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
  const scopeType =
    typeof req.query["scopeType"] === "string" ? req.query["scopeType"] : "DEFAULT";
  const limitRaw = Number(req.query["limit"] ?? 50);
  const limit = Math.max(1, Math.min(isFinite(limitRaw) ? limitRaw : 50, 200));
  const memberOnly = req.query["memberOnly"] === "true";

  const userAuth = await resolveUserSpacesAuth(requesterId, requestWorkspaceHint(req)).catch((err) => {
    log.error("[spaces/channels] failed to load MCP credentials:", err);
    return null;
  });

  // Path 1: user MCP connection — existing /api/query flow
  if (userAuth) {
    const where: Record<string, unknown> = {};
    // Channel names are stored WITHOUT the leading "#" (the UI renders "#name").
    // Users naturally type "#merchant" copying what they see, which would make
    // `name contains "#merchant"` match nothing. Strip a leading #/@ and trim so
    // the substring match works against the stored name.
    const term = q.replace(/^[#@\s]+/, "").trim();
    if (term.length > 0) where["name"] = { contains: term, mode: "insensitive" };
    if (scopeType) where["scopeType"] = { equals: scopeType };

    if (memberOnly) {
      try {
        const meRes = await spacesFetch("/api/auth/me", undefined, userAuth) as { user?: { id?: string } };
        const spacesUserId = meRes?.user?.id;
        if (spacesUserId) {
          where["participants"] = { some: { userId: spacesUserId } };
        }
      } catch (err) {
        log.warn("[spaces/channels] memberOnly: could not resolve Spaces userId, skipping filter:", err);
      }
    }

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
      log.error("[spaces/channels] list error:", err);
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : "Failed to list channels",
      });
    }
    return;
  }

  // Path 2: no user MCP connection — use agent app token with /api/apps/channel/list
  const appToken = await resolveAgentAppToken(orgId, agentSlug).catch((err) => {
    log.error("[spaces/channels] failed to load agent app token:", err);
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
    // /api/apps/channel/list has NO server-side name search and applies its
    // `limit` BEFORE returning. With a small display limit (e.g. 20) the
    // client-side name filter below can only ever see the first 20 channels —
    // so searching for a channel that sorts past position 20 returns nothing
    // even though it exists (this is the "q=spa → []" bug). When the user is
    // searching, fetch a large page so the match isn't truncated, filter in
    // memory, then cap to the requested display `limit`.
    //
    // Proper long-term fix lives on the Spaces backend: add a `q`/`search`
    // param to /api/apps/channel/list so the filter runs in-query before the
    // limit (mirrors Path 1's server-side `where.name.contains`).
    const SEARCH_FETCH_LIMIT = 1000;
    const fetchLimit = q ? SEARCH_FETCH_LIMIT : limit;
    const params = new URLSearchParams({ limit: String(fetchLimit), scopeType });
    const result = (await spacesAppFetchGet(
      `/channel/list?${params.toString()}`,
      appToken,
    )) as AppChannelListResponse;

    let items = result.items ?? [];

    if (q) {
      // Match Path 1: strip a leading #/@ since stored names have no "#".
      const lq = q.replace(/^[#@\s]+/, "").trim().toLowerCase();
      if (lq.length > 0) {
        items = items.filter((c) => c.name.toLowerCase().includes(lq)).slice(0, limit);
      } else {
        items = items.slice(0, limit);
      }
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
    log.error("[spaces/channels] app-token list error:", err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to list channels",
    });
  }
});

// GET /api/v1/spaces/projects?q=&limit=
router.get("/projects", async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "x-user-id required" });
    return;
  }

  const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
  const limitRaw = Number(req.query["limit"] ?? 50);
  const limit = Math.max(1, Math.min(isFinite(limitRaw) ? limitRaw : 50, 200));

  const userAuth = await resolveUserSpacesAuth(requesterId, requestWorkspaceHint(req)).catch((err) => {
    log.error("[spaces/projects] failed to load Spaces auth:", err);
    return null;
  });
  if (!userAuth) {
    res.status(412).json({
      success: false,
      error: "Xyne Spaces MCP connection not found for this user. Connect Spaces first.",
    });
    return;
  }

  try {
    const where: Record<string, unknown> = {};
    if (q) where["name"] = { contains: q, mode: "insensitive" };
    const rows = (await interact({
      model: "project",
      operation: "findMany",
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: limit,
    }, userAuth)) as SpacesProjectRow[];

    res.json({
      success: true,
      data: rows.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description ?? null,
        updatedAt: p.updatedAt ? new Date(p.updatedAt).toISOString() : null,
      })),
    });
  } catch (err) {
    log.error("[spaces/projects] list error:", err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to list projects",
    });
  }
});

// GET /api/v1/spaces/boards?q=&limit=&projectId=
router.get("/boards", async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "x-user-id required" });
    return;
  }

  const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
  const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"].trim() : "";
  const limitRaw = Number(req.query["limit"] ?? 50);
  const limit = Math.max(1, Math.min(isFinite(limitRaw) ? limitRaw : 50, 200));

  const userAuth = await resolveUserSpacesAuth(requesterId, requestWorkspaceHint(req)).catch((err) => {
    log.error("[spaces/boards] failed to load Spaces auth:", err);
    return null;
  });
  if (!userAuth) {
    res.status(412).json({
      success: false,
      error: "Xyne Spaces MCP connection not found for this user. Connect Spaces first.",
    });
    return;
  }

  try {
    const where: Record<string, unknown> = {};
    if (q) where["name"] = { contains: q, mode: "insensitive" };
    if (projectId) where["projectId"] = { equals: projectId };
    const rows = (await interact({
      model: "board",
      operation: "findMany",
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: limit,
      include: { project: { select: { name: true } } },
    }, userAuth)) as SpacesBoardRow[];

    res.json({
      success: true,
      data: rows.map((b) => ({
        id: b.id,
        name: b.name,
        description: b.description ?? null,
        projectId: b.projectId ?? null,
        projectName: b.project?.name ?? null,
        updatedAt: b.updatedAt ? new Date(b.updatedAt).toISOString() : null,
      })),
    });
  } catch (err) {
    log.error("[spaces/boards] list error:", err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to list boards",
    });
  }
});

// GET /api/v1/spaces/automations-schema/triggers
// Proxies to Spaces GET /api/automations/schema/triggers using the user's stored Spaces token.
router.get("/automations-schema/triggers", async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "x-user-id required" });
    return;
  }

  const userAuth = await resolveUserSpacesAuth(requesterId, requestWorkspaceHint(req)).catch(() => null);
  if (!userAuth) {
    res.status(412).json({
      success: false,
      error: "Xyne Spaces MCP connection not found for this user. Connect Spaces first.",
    });
    return;
  }

  try {
    const url = `${userAuth.baseUrl}/api/automations/schema/triggers`;
    const spacesRes = await fetch(url, {
      headers: { Authorization: `Bearer ${userAuth.token}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!spacesRes.ok) {
      const text = await spacesRes.text().catch(() => "");
      res.status(spacesRes.status).json({ success: false, error: text.slice(0, 200) });
      return;
    }

    const data = await spacesRes.json();
    res.json(data);
  } catch (err) {
    log.error("[spaces/automations-schema/triggers] error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch trigger schema" });
  }
});

// GET /api/v1/spaces/automations-schema/triggers/:type
// Proxies to Spaces GET /api/automations/schema/triggers/:type using the user's stored Spaces token.
router.get("/automations-schema/triggers/:type", async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "x-user-id required" });
    return;
  }

  const userAuth = await resolveUserSpacesAuth(requesterId, requestWorkspaceHint(req)).catch(() => null);
  if (!userAuth) {
    res.status(412).json({
      success: false,
      error: "Xyne Spaces MCP connection not found for this user. Connect Spaces first.",
    });
    return;
  }

  try {
    const triggerType = req.params.type as string;
    const url = `${userAuth.baseUrl}/api/automations/schema/triggers/${encodeURIComponent(triggerType)}`;
    const spacesRes = await fetch(url, {
      headers: { Authorization: `Bearer ${userAuth.token}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!spacesRes.ok) {
      const text = await spacesRes.text().catch(() => "");
      res.status(spacesRes.status).json({ success: false, error: text.slice(0, 200) });
      return;
    }

    const data = await spacesRes.json();
    res.json(data);
  } catch (err) {
    log.error("[spaces/automations-schema/triggers/:type] error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch trigger schema" });
  }
});

export { router as spacesRouter };
