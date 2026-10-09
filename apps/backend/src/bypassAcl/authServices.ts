import { UserService } from '@/services/userService';
import { UserSessionService } from '@/services/userSessionService';
import { channelService } from '@/services/channelService';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { asSystem } from './base';

const userService = new UserService();
const userSessionService = new UserSessionService();
const prisma = DatabaseClient.getInstance();

/** Used only by switchWorkspaceData below — same logic as authV2Controller.ts's private
 *  ensureSelfDmForUser, kept local since that method can't be called across modules. */
async function ensureSelfDmForUser(userId: string, workspaceId: string): Promise<string | null> {
  try {
    const selfDmChannelId = await channelService.ensureSelfDmExists(userId, workspaceId);
    logger.info(`[ensureSelfDmForUser] Self-DM ensured for user ${userId}: ${selfDmChannelId}`);
    return selfDmChannelId;
  } catch (error) {
    logger.error(`[ensureSelfDmForUser] Failed to ensure self-DM for user ${userId}:`, error);
    return null;
  }
}

export interface SwitchWorkspaceData {
  targetUser: NonNullable<Awaited<ReturnType<UserService['findUserByEmail']>>>;
  selfDmChannelId: string | null;
  workspace: { landingChannelId: string | null } | null;
  currentSession: Awaited<ReturnType<UserSessionService['getSessionById']>>;
}

/**
 * Relocated from controllers/authV2Controller.ts's switchWorkspace. Switching workspaces is
 * inherently cross-tenant: everything below acts on the TARGET workspace while the ambient
 * session context is still the caller's current (old) one — the per-model ACLs' "must match
 * your current workspace" rule can never be satisfied by definition. Safe to bypass because
 * every lookup here is keyed off `currentUserEmail` (the caller's own verified session), never
 * attacker-supplied — this can only ever act on the caller's own identity in the target
 * workspace. Returns null when the target user has no access to the workspace (403 case) — the
 * caller decides how to respond, this only resolves data.
 *
 * The session lookup lives in here too, not back in the controller: UserSession.workspaceId is
 * stamped once at login and never updated, while a session is deliberately reused across
 * workspace switches — so by the second switch the ambient (old) workspace no longer matches the
 * session row's workspaceId and an ACL-scoped lookup would wrongly come back null.
 */
export function switchWorkspaceData(
  currentUserEmail: string,
  workspaceId: string,
  sessionId: string | undefined,
): Promise<SwitchWorkspaceData | null> {
  return asSystem(
    ['User', 'Channel', 'ChannelParticipant', 'Workspace', 'UserSession'],
    'switch-workspace: acts on target workspace, keyed off caller-verified email only; ' +
      'session lookup included since UserSession.workspaceId is stale for a reused session',
    async () => {
      const targetUser = await userService.findUserByEmail(currentUserEmail, workspaceId);
      if (!targetUser) return null;

      await userService.ensureUserPresence(targetUser.id, workspaceId);
      const selfDmChannelId = await ensureSelfDmForUser(targetUser.id, workspaceId);

      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { landingChannelId: true },
      });

      const currentSession = sessionId ? await userSessionService.getSessionById(sessionId) : null;

      return { targetUser, selfDmChannelId, workspace, currentSession };
    },
  );
}
