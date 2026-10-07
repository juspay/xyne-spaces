import type { Request, Response } from 'express';
import { CallStatus } from '@xyne/shared';
import { repositories } from '@/database/repositories';
import { resolveRequest } from '@/auth/sessionResolver';

const JOINABLE_CALL_STATUSES = new Set<CallStatus>([
  CallStatus.SCHEDULED,
  CallStatus.ACTIVE,
  CallStatus.IN_PROGRESS,
]);

export type InternalCallRouteResolution =
  | { result: 'internal'; workspaceId: string }
  | { result: 'external' };

class CallInviteRoutingService {
  /**
   * Resolve a public call invite against the caller's session for the call's
   * workspace. Ambient workspace signals (`x-workspace-id`, the last-workspace
   * hint) are intentionally overridden: a user browsing workspace B may still
   * be a member of workspace A for an A call. The resolver authorises the
   * session's account against the call workspace's membership row, so a
   * revoked membership routes to the guest lobby.
   *
   * No Bearer: this is a browser navigation, and nothing is written here
   * (no hint cookie, no inline `xw_<ws>` refresh) — the dashboard load this
   * routes to is an authenticated request and establishes its own workspace
   * context and access cookie.
   *
   * This is only a routing decision. /api/calls/join remains responsible for
   * the host/invitee/channel-member authorization check.
   */
  async resolve(
    req: Request,
    _res: Response,
    externalId: string
  ): Promise<InternalCallRouteResolution> {
    const routing = await repositories.calls.getCallInviteRoutingInfo(externalId);
    if (!routing || !JOINABLE_CALL_STATUSES.has(routing.status)) {
      return { result: 'external' };
    }

    const callWorkspaceId = routing.workspaceId;

    const resolved = await resolveRequest(req, {
      allowBearer: false,
      workspaceId: callWorkspaceId,
      middleware: 'invite',
      inlineRefresh: false,
    });
    if (!resolved.ok) {
      return { result: 'external' };
    }

    return { result: 'internal', workspaceId: callWorkspaceId };
  }
}

export const callInviteRoutingService = new CallInviteRoutingService();
