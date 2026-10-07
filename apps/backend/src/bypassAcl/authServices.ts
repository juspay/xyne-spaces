import { channelService } from '@/services/channelService';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { asSystem, asService } from './base';

const prisma = DatabaseClient.getInstance();

/**
 * Relocated from controllers/authV2Controller.ts's private ensureSelfDmForUser. Runs post-login/post-switch, on
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
