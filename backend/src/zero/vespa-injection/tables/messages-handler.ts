import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseVespaHandler } from '../core/base-handler';
import type { VespaQueueHandler } from '../core/types';
import type { QueryContext } from '../../acl/core/types';
import { messageSchema } from '@/vespa/src/types';

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
    return [{
      schema: messageSchema,
      jobType: 'feed',
      data: args,
      docId: args.messageId
    }];
  }

  onUpdate(args: UpdateValue<MessagesSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: messageSchema,
      jobType: 'feed',
      data: args,
      docId: args.messageId
    }];
  }

  onUpsert(args: UpsertValue<MessagesSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: messageSchema,
      jobType: 'feed',
      data: args,
      docId: args.messageId
    }];
  }

  onDelete(args: DeleteID<MessagesSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: messageSchema,
      jobType: 'delete',
      data: args,
      docId: args.messageId
    }];
  }
}
