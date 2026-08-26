import { ChannelRepository } from '@/database/repositories/channelRepository';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';

/**
 * Result of a per-channel authorization check.
 */
export interface ChannelAccessResult {
  hasAccess: boolean;
  reason?: string;
}

const channelRepository = new ChannelRepository();
const channelParticipantRepository = new ChannelParticipantRepository();

/**
 * Authorize a single user against a single channel.
 *
 * This is the guard used by bulk flows where each item carries its own
 * `channelId`: the request-level ACL only proves the caller can reach the
 * primary channel, so every additional target channel must be checked here to
 * prevent cross-channel / cross-workspace ticket creation.
 *
 * A channel is reachable when:
 *  - it exists, and
 *  - it belongs to the caller's workspace, and
 *  - if it is PRIVATE, the caller is a participant.
 */
export async function validateChannelAccess(
  channelId: string,
  userId: string,
  workspaceId: string,
): Promise<ChannelAccessResult> {
  const channel = await channelRepository.findById(channelId);

  if (!channel) {
    return { hasAccess: false, reason: `Channel ${channelId} not found` };
  }

  if (channel.workspaceId !== workspaceId) {
    return { hasAccess: false, reason: `Channel ${channelId} is not in your workspace` };
  }

  if (channel.visibility === 'PRIVATE') {
    const isParticipant = await channelParticipantRepository.isParticipant(channelId, userId);
    if (!isParticipant) {
      return { hasAccess: false, reason: `You are not a participant of private channel ${channelId}` };
    }
  }

  return { hasAccess: true };
}
