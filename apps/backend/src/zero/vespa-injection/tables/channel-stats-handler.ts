import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseVespaHandler } from '../core/base-handler';
import type { VespaQueueHandler } from '../core/types';
import type { QueryContext } from '../../acl/core/types';
import { channelSchema } from '@/vespa/src/types';

type ChannelStatsSchema = Schema['tables']['channel_stats'];

/**
 * Vespa handler for the channel_stats table.
 *
 * When channel_stats is updated (e.g., participantCount, lastActivityAt),
 * we need to re-index the parent channel in Vespa to keep the chat_container
 * document up-to-date with the latest participant list and stats.
 *
 * This is necessary because:
 * - participantCount moved from channels to channel_stats (XYNE-11666)
 * - mapChannel() fetches participants from channel_participants table
 * - We need to trigger mapChannel() when participants change
 */
export class ChannelStatsVespaHandler extends BaseVespaHandler<'channel_stats'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'channel_stats');
  }

  /**
   * On insert of channel_stats, queue a feed job for the parent channel.
   * This ensures the channel is indexed when stats are first created.
   */
  onInsert(args: InsertValue<ChannelStatsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: channelSchema,
      jobType: 'feed',
      docId: args.channelId
    }];
  }

  /**
   * On update of channel_stats, queue a feed job for the parent channel.
   * This triggers mapChannel() which fetches fresh participants from DB.
   *
   * Important: We use the channelId from the stats record as the docId,
   * not the stats record's own ID.
   */
  onUpdate(args: UpdateValue<ChannelStatsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: channelSchema,
      jobType: 'feed',
      docId: args.channelId
    }];
  }

  /**
   * On upsert of channel_stats, queue a feed job for the parent channel.
   */
  onUpsert(args: UpsertValue<ChannelStatsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: channelSchema,
      jobType: 'feed',
      docId: args.channelId
    }];
  }

  /**
   * On delete of channel_stats, no action needed for Vespa.
   * The channel itself would be deleted separately, which would trigger
   * the ChannelsVespaHandler to delete the Vespa document.
   */
  onDelete(_args: DeleteID<ChannelStatsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [];
  }
}