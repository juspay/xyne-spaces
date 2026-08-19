import type { Response } from 'express';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';

const channelRepository = new ChannelRepository();
const channelParticipantRepository = new ChannelParticipantRepository();

export async function validateChannelAccess(
  channelId: string,
  userId: string,
  workspaceId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string; code?: string }> {
  const channel = await channelRepository.findById(channelId);
  if (!channel || channel.workspaceId !== workspaceId) {
    return { ok: false, status: 404, error: 'Channel not found' };
  }

  if (channel.visibility === 'PRIVATE') {
    const isParticipant = await channelParticipantRepository.isParticipant(channelId, userId);
    if (!isParticipant) {
      return {
        ok: false,
        status: 403,
        error: 'Access denied - you do not have permission to access this channel',
        code: 'NOT_CHANNEL_PARTICIPANT',
      };
    }
  }

  return { ok: true };
}

export function sendChannelAccessError(
  res: Response,
  result: { ok: false; status: number; error: string; code?: string },
): void {
  res.status(result.status).json({ error: result.error, ...(result.code ? { code: result.code } : {}) });
}
