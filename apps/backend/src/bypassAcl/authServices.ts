import { UserService } from '@/services/userService';
import { channelService } from '@/services/channelService';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { asSystem, asService } from './base';

const userService = new UserService();
const prisma = DatabaseClient.getInstance();

/**
 * Relocated from controllers/authV2Controller.ts's private ensureSelfDmForUser (and duplicated,
 * pre-relocation, in this file for switchWorkspaceData below). Runs post-login/post-switch, on
 * the request that is itself creating the session — no ambient tenant context exists yet, so
 * this opens one for the specific user+workspace the login/switch just resolved to.
 */
export function ensureSelfDmForUserData(userId: string, workspaceId: string): Promise<string | null> {
  return asService(
    ['Channel', 'ChannelParticipant'],
    'post-login self-DM ensure: runs on the request that is itself creating the session, no ambient tenant context exists yet',
    userId,
    workspaceId,
    async () => {
      try {
        const selfDmChannelId = await channelService.ensureSelfDmExists(userId, workspaceId);
        logger.info(`[ensureSelfDmForUser] Self-DM ensured for user ${userId}: ${selfDmChannelId}`);
        return selfDmChannelId;
      } catch (error) {
        logger.error(`[ensureSelfDmForUser] Failed to ensure self-DM for user ${userId}:`, error);
        return null;
      }
    },
  );
}

/**
 * Relocated from controllers/authV2Controller.ts's repeated post-login
 * `this.prisma.workspace.findUnique({ select: { landingChannelId } })` lookup. Same no-context
 * reasoning; the actor is inert (a workspace-only lookup, not user-specific), so this runs as
 * system rather than a service actor.
 */
export function getWorkspaceLandingChannelData(workspaceId: string): Promise<{ landingChannelId: string | null } | null> {
  return asSystem(
    ['Workspace'],
    'post-login landing-channel lookup: runs on the request that is itself creating the session, no ambient tenant context exists yet',
    () => prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { landingChannelId: true },
    }),
  );
}

/** The `users` row a refresh re-mints a JWT for: the org member's identity in one workspace. */
export interface RefreshTargetUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  workspaceId: string;
  orgMemberId: string;
  status: string;
  leftAt: Date | null;
}

/**
 * `/auth/refresh-session` runs with no ambient tenant context (the only credential is the
 * `xs` cookie, already resolved to an org member by authSessionService.consumeRefresh), so
 * the workspace-user lookup is keyed off that verified orgMemberId and runs as system.
 * Returns null when the member has no user in the workspace; the caller checks status/leftAt.
 */
export function getRefreshTargetUserData(orgMemberId: string, workspaceId: string): Promise<RefreshTargetUser | null> {
  return asSystem(
    ['User'],
    'refresh-session: workspace-user lookup keyed off the xs-verified orgMemberId; no ambient tenant context on a public auth route',
    () => prisma.user.findFirst({
      where: { orgMemberId, workspaceId },
      select: { id: true, email: true, name: true, picture: true, workspaceId: true, orgMemberId: true, status: true, leftAt: true },
    }),
  );
}

export interface SwitchWorkspaceData {
  targetUser: NonNullable<Awaited<ReturnType<UserService['findUserByEmail']>>>;
  selfDmChannelId: string | null;
  workspace: { landingChannelId: string | null } | null;
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
 */
export function switchWorkspaceData(
  currentUserEmail: string,
  workspaceId: string,
): Promise<SwitchWorkspaceData | null> {
  return asSystem(
    ['User', 'Channel', 'ChannelParticipant', 'Workspace'],
    'switch-workspace: acts on target workspace, keyed off caller-verified email only',
    async () => {
      const targetUser = await userService.findUserByEmail(currentUserEmail, workspaceId);
      if (!targetUser) return null;

      await userService.ensureUserPresence(targetUser.id, workspaceId);
      const selfDmChannelId = await ensureSelfDmForUserData(targetUser.id, workspaceId);

      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { landingChannelId: true },
      });

      return { targetUser, selfDmChannelId, workspace };
    },
  );
}
