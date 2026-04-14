import { db } from '../../../database/client.js';

export interface ChannelInfo {
  channelNames: string[];
  contextChannelMap: Map<string, string>;     // name.toLowerCase() → id
  contextChannelIdToName: Map<string, string>; // id → name
}

/**
 * Resolves channel IDs to names and lookup maps in a single DB query.
 * Used by the agent runner (for prompt + tool context) and the stream
 * handler (for trace metadata).
 */
export async function getChannelInfo(channelIds: string[]): Promise<ChannelInfo> {
  if (!channelIds || channelIds.length === 0) {
    return { channelNames: [], contextChannelMap: new Map(), contextChannelIdToName: new Map() };
  }

  const channels = await db.channel.findMany({
    where: { id: { in: channelIds } },
    select: { id: true, name: true },
  });

  return {
    channelNames: channels.map(c => c.name),
    contextChannelMap: new Map(channels.map(c => [c.name.toLowerCase(), c.id])),
    contextChannelIdToName: new Map(channels.map(c => [c.id, c.name])),
  };
}
