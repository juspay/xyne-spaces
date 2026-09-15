import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseVespaHandler } from '../core/base-handler';
import type { VespaQueueHandler } from '../core/types';
import type { QueryContext } from '../../acl/core/types';
import { messageSchema } from '@/vespa/src/types';
import { entityExtractionQueue } from '@/queues/entityExtractionQueue';
import { messageClassificationQueue } from '@/queues/messageClassificationQueue';

type MessagesSchema = Schema['tables']['messages'];

/**
 * Vespa handler for the messages table.
 *
 * Queues jobs for message indexing in Vespa's chat_message schema.
 */
export class MessagesVespaHandler extends BaseVespaHandler<'messages'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'messages');
  }

  onInsert(args: InsertValue<MessagesSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    // Fire-and-forget: both are guarded internally and must never affect ingestion.
    void entityExtractionQueue.enqueueForMessage(args.conversationId);
    void messageClassificationQueue.enqueueForMessage(args.conversationId);
    return [{
      schema: messageSchema,
      jobType: 'feed',
      data: args,
      docId: args.messageId,
    }] as VespaQueueHandler[];
  }

  onUpdate(args: UpdateValue<MessagesSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: messageSchema,
      jobType: 'feed',
      data: args,
      docId: args.messageId,
    }] as VespaQueueHandler[];
  }

  onUpsert(args: UpsertValue<MessagesSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    void entityExtractionQueue.enqueueForMessage(args.conversationId);
    return [{
      schema: messageSchema,
      jobType: 'feed',
      data: args,
      docId: args.messageId,
    }] as VespaQueueHandler[];
  }

  onDelete(args: DeleteID<MessagesSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: messageSchema,
      jobType: 'delete',
      data: args,
      docId: args.messageId,
    }] as VespaQueueHandler[];
  }
}
