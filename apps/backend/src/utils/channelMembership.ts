import { Request } from 'express';
import { Channel } from '@prisma/client';
import { ChannelRole, meetsDeskInsightsAccess } from '@xyne/shared';
import { repositories } from '@/database/repositories';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { EmailChannelPreferenceRepository } from '@/database/repositories/emailChannelPreferenceRepository';

export type ChannelAccessGranted = {
  ok: true;
  userId: string;
  workspaceId: string;
  channel: Channel;
};

export type ChannelAccessDenied = {
  ok: false;
  status: number;
  error: string;
};

export type ChannelAccessResult = ChannelAccessGranted | ChannelAccessDenied;

const channelRepo = new ChannelRepository();
const channelParticipantRepo = new ChannelParticipantRepository();
const emailChannelPreferenceRepo = new EmailChannelPreferenceRepository();

/**
 * Desk endpoints require unconditional channel participation, which is stricter than
 * ChannelsACL (PUBLIC-or-participant). Callers that also gate on desk ownership pass the
 * granted result to assertDeskOwner.
 */
export async function assertChannelMembership(
  req: Request,
  channelId: string,
): Promise<ChannelAccessResult> {
  const userId = req.user?.id;
  const workspaceId = req.user?.workspaceId;

  if (!userId || !workspaceId) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }

  const channel = await channelRepo.findById(channelId);
  if (!channel || channel.workspaceId !== workspaceId) {
    return { ok: false, status: 404, error: 'Channel not found' };
  }

  const isParticipant = await channelParticipantRepo.isParticipant(channelId, userId);
  if (!isParticipant) {
    return { ok: false, status: 403, error: 'Not a member of this channel' };
  }

  return { ok: true, userId, workspaceId, channel };
}

export function assertDeskOwner(
  access: ChannelAccessGranted,
  preferenceOwnerUserId: string | null | undefined,
  denyMessage: string,
): ChannelAccessResult {
  if (access.channel.createdBy === access.userId || preferenceOwnerUserId === access.userId) {
    return access;
  }
  return { ok: false, status: 403, error: denyMessage };
}

/** Desk owner OR channel admin — NOT channel.createdBy. */
export async function isDeskOwnerOrChannelAdmin(
  channelId: string,
  userId: string | undefined,
  preferenceOwnerUserId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  if (preferenceOwnerUserId && preferenceOwnerUserId === userId) return true;
  const participant = await channelParticipantRepo.findParticipant(channelId, userId);
  return participant?.role === ChannelRole.ADMIN;
}

/** Caller's SUPPORT access types, direct or via user groups. */
export async function getSupportAccessTypes(userId: string | undefined): Promise<string[]> {
  if (!userId) return [];
  const resource = await repositories.resources.findByName('SUPPORT');
  if (!resource) return [];
  const rows = await repositories.resourceAccess.findUserResourceAccess(userId, resource.id);
  return rows.map(row => row.accessType);
}

/** Desk-insights ACL (metrics, topics, reports): owner/admin, or the desk's SUPPORT tier. */
export async function canViewDeskInsights(
  channelId: string,
  userId: string | undefined,
  preferenceOwnerUserId: string | null | undefined,
): Promise<boolean> {
  if (await isDeskOwnerOrChannelAdmin(channelId, userId, preferenceOwnerUserId)) return true;
  const [supportAccessTypes, minAccessByChannel] = await Promise.all([
    getSupportAccessTypes(userId),
    emailChannelPreferenceRepo.findMetricsMinAccess([channelId]),
  ]);
  return meetsDeskInsightsAccess(supportAccessTypes, minAccessByChannel.get(channelId));
}
