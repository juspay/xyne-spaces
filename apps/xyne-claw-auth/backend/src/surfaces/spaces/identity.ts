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
