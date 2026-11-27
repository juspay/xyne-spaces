import type { Request } from "express";
import { CONFIG } from "../../config.js";
import { getWorkspaceIdForUser } from "../../lib/spaces-db.js";
import { getRequesterId, getOrgId } from "../../middleware/agent-acl.js";
import type { SpacesAuthContext } from "../../mcp/servers/xyne-spaces-client.js";
import { createLogger } from "../../logger.js";

const log = createLogger("spaces-identity");

export function getCookieValue(req: Request, name: string): string | undefined {
  const cookie = req.headers["cookie"] ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export function extractSpacesUserToken(req: Request): string | undefined {
  const bodyToken = (req.body as { userToken?: string } | undefined)?.userToken;
  if (bodyToken) return bodyToken;

  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);

  const lastWorkspace = getCookieValue(req, "xyne_last_workspace");
  if (lastWorkspace) {
    const workspaceToken = getCookieValue(req, `xyne_ws_${lastWorkspace}_token`);
    if (workspaceToken) return workspaceToken;
  }

  const legacy = getCookieValue(req, "google_access_token");
  if (legacy && legacy.split(".").length === 3) return legacy;

  return undefined;
}

export function extractSpacesSessionId(req: Request): string | undefined {
  const header = req.headers["x-session-id"];
  if (typeof header === "string" && header.trim()) return header.trim();
  return getCookieValue(req, "xyne_session") ?? getCookieValue(req, "user_session_id");
}

export function extractSpacesWorkspaceId(req: Request): string | undefined {
  const verifiedHeader = req.headers["x-spaces-workspace-id"];
  if (typeof verifiedHeader === "string" && verifiedHeader.trim()) return verifiedHeader.trim();
  const header = req.headers["x-workspace-id"];
  if (typeof header === "string" && header.trim()) return header.trim();
  return getCookieValue(req, "xyne_last_workspace");
}

export async function resolveSpacesAuth(req: Request, userId: string): Promise<SpacesAuthContext | undefined> {
  const spacesUserIdHeader = req.headers["x-spaces-user-id"];
  const spacesUserId = typeof spacesUserIdHeader === "string" && spacesUserIdHeader.trim()
    ? spacesUserIdHeader.trim()
    : userId;
  const verifiedWorkspaceId = extractSpacesWorkspaceId(req);
  const cookie = req.headers.cookie;
  if (typeof cookie === "string" && cookie.trim()) {
    return {
      cookie,
      baseUrl: CONFIG.spacesInternalUrl,
      ...(verifiedWorkspaceId ? { workspaceId: verifiedWorkspaceId } : {}),
    };
  }

  const token = extractSpacesUserToken(req);
  if (!token) return undefined;
  const sessionId = extractSpacesSessionId(req);
  const workspaceIdFromRequest = verifiedWorkspaceId;
  const workspaceId = workspaceIdFromRequest ?? await getWorkspaceIdForUser(spacesUserId, "agent-chat").catch(() => null) ?? undefined;
  if (!workspaceIdFromRequest && workspaceId) {
    log.info(`[spaces-identity] resolved workspaceId=${workspaceId} from user row for request Spaces auth userId=${userId}`);
  }
  return {
    token,
    baseUrl: CONFIG.spacesInternalUrl,
    ...(sessionId ? { sessionId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
  };
}

export interface SpacesActor {
  kind: "user";
  userId: string;
  orgId: string;
}

export type SpacesActorResult =
  | { ok: true; actor: SpacesActor }
  | { ok: false; status: number; error: string };

export function resolveSpacesActor(req: Request): SpacesActorResult {
  const userId = getRequesterId(req);
  const orgId = getOrgId(req);
  if (!userId || !orgId) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true, actor: { kind: "user", userId, orgId } };
}

export async function resolveSpacesAuthFromRequest(
  req: Request,
  userId?: string,
): Promise<SpacesAuthContext | undefined> {
  try {
    // Parse cookies — may be absent, header/Authorization fallbacks still apply.
    const cookieMap = new Map<string, string>();
    const cookies = req.headers.cookie;
    if (cookies) {
      for (const cookie of cookies.split(";")) {
        const [name, ...rest] = cookie.trim().split("=");
        if (name && rest.length > 0) {
          cookieMap.set(name, rest.join("="));
        }
      }
    }

    // Workspace id: VERIFIED x-spaces-workspace-id (requireAuth derived it
    // from the session's active workspace) → x-workspace-id header →
    // xyne_last_workspace cookie. The verified header must win: the others
    // are client-supplied conveniences.
    const verifiedWorkspaceHeader = req.headers["x-spaces-workspace-id"];
    const verifiedWorkspaceId =
      typeof verifiedWorkspaceHeader === "string" && verifiedWorkspaceHeader.trim()
        ? verifiedWorkspaceHeader.trim()
        : undefined;
    const workspaceHeader = req.headers["x-workspace-id"];
    const workspaceId =
      verifiedWorkspaceId ??
      (typeof workspaceHeader === "string" && workspaceHeader.trim()
        ? workspaceHeader.trim()
        : cookieMap.get("xyne_last_workspace"));

    // Token: workspace-scoped JWT → legacy google_access_token JWT → Authorization Bearer
    let token: string | undefined;
    if (workspaceId) {
      const wsToken = cookieMap.get(`xyne_ws_${workspaceId}_token`);
      if (wsToken && wsToken.split(".").length === 3) {
        token = wsToken;
      }
    }
    if (!token) {
      const legacy = cookieMap.get("google_access_token");
      if (legacy && legacy.split(".").length === 3) {
        token = legacy;
      }
    }
    if (!token) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        token = authHeader.slice(7);
      }
    }

    // Session id: x-session-id header → xyne_session cookie → user_session_id cookie.
    // Spaces' authV2 sets `user_session_id`, not `xyne_session` — checking both
    // keeps legacy callers working while fixing the dominant miss.
    const sessionHeader = req.headers["x-session-id"];
    const sessionId =
      typeof sessionHeader === "string" && sessionHeader.trim()
        ? sessionHeader.trim()
        : (cookieMap.get("xyne_session") ?? cookieMap.get("user_session_id"));

    if (!token && !sessionId) return undefined;

    const spacesUserIdHeader = req.headers["x-spaces-user-id"];
    const spacesUserId = typeof spacesUserIdHeader === "string" && spacesUserIdHeader.trim()
      ? spacesUserIdHeader.trim()
      : userId;
    const effectiveWorkspaceId =
      workspaceId ??
      (spacesUserId ? await getWorkspaceIdForUser(spacesUserId, "require-auth").catch(() => null) : null) ??
      undefined;
    if (!workspaceId && effectiveWorkspaceId) {
      log.info(
        `[run] resolved Spaces workspaceId=${effectiveWorkspaceId} from user row for userId=${userId ?? "unknown"}`,
      );
    }

    return {
      ...(token ? { token } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(effectiveWorkspaceId ? { workspaceId: effectiveWorkspaceId } : {}),
    };
  } catch (err) {
    log.warn("[run] Failed to resolve Spaces auth from request:", err);
    return undefined;
  }
}
