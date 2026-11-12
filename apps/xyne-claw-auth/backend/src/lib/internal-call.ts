/**
 * Authentication for calls claw-auth makes to the xyne-claw runtime and to its
 * own routes. No shared key: each call carries a one-shot service assertion
 * signed with claw-auth's own key (lib/service-assertion.ts).
 *
 * A call to one of claw-auth's own routes that must act for a user carries a
 * short run token for that user (lib/session-tokens.ts, claw-auth's own HMAC),
 * which requireAuth / requireRunUser accept only together with the assertion.
 * The user never travels as an x-user-id header.
 */

import { randomUUID } from "node:crypto";
import { serviceAuthHeaders, serviceSigningConfigured } from "./service-assertion.js";
import { mintSessionToken } from "./session-tokens.js";

const SELF_CALL_TOKEN_TTL_SECONDS = 10 * 60;

/** True when claw-auth can sign service assertions (CLAW_SERVICE_PRIVATE_KEY set). */
export function serviceCallsConfigured(): boolean {
  return serviceSigningConfigured();
}

/** Headers for claw-auth → xyne-claw runtime. Throws when claw-auth can't sign. */
export function runtimeAuthHeaders(method: string, url: string): Record<string, string> {
  return serviceAuthHeaders("xyne-claw", method, url);
}

export interface SelfCallUser {
  userId: string;
  /** Session the call belongs to; a fresh internal id when the call isn't tied to one. */
  sessionId?: string | undefined;
  agentSlug?: string | undefined;
  spacesAppId?: string | undefined;
}

/** A run token naming `user`, for a claw-auth → claw-auth call made on their behalf. */
export function selfCallRunToken(user: SelfCallUser, ttlSeconds = SELF_CALL_TOKEN_TTL_SECONDS): string {
  return mintSessionToken({
    sessionId: user.sessionId || `internal-${randomUUID()}`,
    userId: user.userId,
    ...(user.agentSlug ? { agentSlug: user.agentSlug } : {}),
    ...(user.spacesAppId ? { spacesAppId: user.spacesAppId } : {}),
    ttlSeconds,
  });
}

/**
 * Headers for claw-auth calling its own route `url`. With `user`, the call acts
 * for that user (run token); without, it names no user. Throws when claw-auth
 * can't sign.
 */
export function selfAuthHeaders(method: string, url: string, user?: SelfCallUser): Record<string, string> {
  return {
    ...serviceAuthHeaders("xyne-claw-auth", method, url),
    ...(user?.userId ? { "x-session-token": selfCallRunToken(user) } : {}),
  };
}
