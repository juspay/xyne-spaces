import { Request } from 'express';
import { Channel } from '@prisma/client';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';

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
