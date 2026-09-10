import { getSpacesAuthForUser, getWorkspaceIdForUser, type SpacesAuthCaller } from "../../lib/spaces-db.js";
import { createLogger } from "../../logger.js";

const log = createLogger("spaces-user-auth");

export interface UserSpacesAuth {
  token: string;
  sessionId?: string;
  workspaceId?: string;
  cookieHeader: string;
}

// Spaces auth middleware (backend/src/middleware/auth.ts) needs the JWT
// AND a session cookie to silently refresh expired JWTs. Pure Bearer-only
// 401s the moment the JWT TTL elapses. We cover all three cookie name
// aliases (legacy + workspace + V2) so any of Spaces' middleware variants
// can find what it needs.
export async function resolveUserSpacesAuth(
  userId: string,
  caller: SpacesAuthCaller = "unknown",
): Promise<UserSpacesAuth | null> {
  const live = await getSpacesAuthForUser(userId, caller).catch(() => null);
  if (!live) {
    log.info(`No live Spaces session for user ${userId} (caller=${caller})`);
    return null;
  }
  let workspaceId: string | undefined = live.workspaceId;
  if (!workspaceId) {
    workspaceId = (await getWorkspaceIdForUser(userId, caller).catch(() => null)) ?? undefined;
  }
  const parts = [`google_access_token=${live.token}`];
  if (live.sessionId) {
    parts.push(`user_session_id=${live.sessionId}`, `xyne_session=${live.sessionId}`);
  }
  if (workspaceId) parts.push(`xyne_last_workspace=${workspaceId}`);
  log.info(`Resolved Spaces creds from live DB for user ${userId} workspaceId=${workspaceId ?? "(none)"}`);
  return {
    token: live.token,
    ...(live.sessionId ? { sessionId: live.sessionId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    cookieHeader: parts.join("; "),
  };
}
