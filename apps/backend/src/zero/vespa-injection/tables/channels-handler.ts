import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseVespaHandler } from '../core/base-handler';
import type { VespaQueueHandler } from '../core/types';
import type { QueryContext } from '../../acl/core/types';
import { channelSchema } from '@/vespa/src/types';

type ChannelsSchema = Schema['tables']['channels'];
/**
 * Vespa handler for the channels table.
 * 
 * Queues jobs for channel indexing in Vespa's chat_container schema.
 */
export class ChannelsVespaHandler extends BaseVespaHandler<'channels'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'channels');
  }

  onInsert(args: InsertValue<ChannelsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: channelSchema,
      jobType: 'feed',
      data: args,
      docId: args.id
    }];
  }

  onUpdate(args: UpdateValue<ChannelsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: channelSchema,
      jobType: 'feed',
      data: args,
      docId: args.id
    }];
  }

  onUpsert(args: UpsertValue<ChannelsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: channelSchema,
      jobType: 'feed',
      data: args,
      docId: args.id
    }];
  }

  onDelete(args: DeleteID<ChannelsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: channelSchema,
      jobType: 'delete',
      docId: args.id
    }];
  }
}