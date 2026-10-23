/**
 * How an SDK call reaches claw-auth as its caller.
 *
 * claw-auth never verifies a Spaces JWT itself: `requireAuth` forwards the
 * request's Cookie header to Spaces `/api/auth/me`, which reads
 * `xyne_last_workspace` and then `xyne_ws_<workspaceId>_token`. An SDK caller
 * already holds that same session JWT, as a Bearer header or as the cookie, so
 * the cookie is rebuilt from it. claw-auth then sees the user's ordinary
 * browser session: it passes `requireAuth`, the cookie-only `requireUserAuth`
 * and `requireNoAccessToken`, and every claw ACL runs as the real user. No S2S
 * key is sent and no identity header is trusted.
 */

import type { Request } from 'express';
import { isGuestToken } from '@/apps/core/guestToken';
import { SdkApiError } from '../errors';

export interface ClawSession {
  /** `xyne_last_workspace=<ws>; xyne_ws_<ws>_token=<jwt>` */
  readonly cookie: string;
  readonly workspaceId: string;
}

function bearer(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  const token = header.slice('Bearer '.length).trim();
  return token || undefined;
}

/**
 * The caller's session as a claw-auth cookie.
 *
 * Read after `authMiddleware.authenticate`, which prefers the Bearer header and
 * otherwise the workspace cookie (refreshing it in place when it had expired),
 * so the token found here is the one that just authenticated the request.
 */
export function clawSession(req: Request): ClawSession {
  const user = req.user;
  if (!user) throw new SdkApiError('unauthenticated', 'Missing authenticated principal.');

  const header = bearer(req);
  // An app guest is a Spaces identity scoped to one app, not a Claw user.
  if (header && isGuestToken(header)) {
    throw new SdkApiError('forbidden', 'Claw is not available to app guest sessions.');
  }

  const workspaceId = user.workspaceId;
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  const token = header ?? cookies?.[`xyne_ws_${workspaceId}_token`];
  if (!token || !workspaceId) {
    throw new SdkApiError('unauthenticated', 'No Spaces session to act as.');
  }

  return {
    cookie: `xyne_last_workspace=${workspaceId}; xyne_ws_${workspaceId}_token=${token}`,
    workspaceId,
  };
}
