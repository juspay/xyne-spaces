import type { Channel } from '../zero/schema.js';
import { ChannelScopeType } from '../zero/types.js';
import { searchChannels } from './search.js';

/**
 * Rank channels that are eligible for # mentions in message composers.
 *
 * Eligibility is applied before ranking and limiting so non-mentionable channel
 * scopes cannot consume the result cap and hide a valid channel.
 */
export function searchMentionableChannels<T extends Channel>(
  channels: T[],
  query: string,
  limit = 10,
): T[] {
  const eligibleChannels = channels.filter(
    (channel) => channel.scopeType === ChannelScopeType.DEFAULT,
  );

  return searchChannels(eligibleChannels, query, limit);
}
