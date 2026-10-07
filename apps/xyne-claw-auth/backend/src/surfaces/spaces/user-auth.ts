import { mintSpacesToken, spacesAuthHeaders, type SpacesAuthCaller } from "../../lib/spaces-auth.js";
import { createLogger } from "../../logger.js";

const log = createLogger("spaces-user-auth");

export interface UserSpacesAuth {
  /** Short-lived Spaces workspace JWT for the user. */
  token: string;
  workspaceId: string;
  /** `Authorization: Bearer` + `x-workspace-id` — everything a Spaces user
   *  route needs. Spread into the outbound request's headers. */
  headers: Record<string, string>;
}

/**
 * The credential to call Spaces user routes as `userId`, minted over S2S
 * (lib/spaces-auth.ts). There is no cookie to forge any more: Spaces sessions
 * are opaque + hashed, and the minted JWT is accepted as a plain Bearer with
 * `x-workspace-id`. `null` = the user has no live Spaces session anywhere.
 */
export async function resolveUserSpacesAuth(
  userId: string,
  caller: SpacesAuthCaller = "unknown",
): Promise<UserSpacesAuth | null> {
  const live = await mintSpacesToken({ userId }, caller).catch(() => null);
  if (!live) {
    log.info(`No live Spaces session for user ${userId} (caller=${caller})`);
    return null;
  }
  log.info(`Minted Spaces credential for user ${userId} workspaceId=${live.workspaceId} (caller=${caller})`);
  return {
    token: live.token,
    workspaceId: live.workspaceId,
    headers: spacesAuthHeaders(live),
  };
}
