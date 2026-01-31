import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseVespaHandler } from '../core/base-handler';
import type { VespaQueueHandler } from '../core/types';
import type { QueryContext } from '../../acl/core/types';
import { ticketSchema } from '@/vespa/src/types';

type TicketsSchema = Schema['tables']['tickets'];
/**
 * Vespa handler for the ticket table.
 * 
 * Queues jobs for ticket indexing in Vespa's ticket schema.
 */
export class TicketsVespaHandler extends BaseVespaHandler<'tickets'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'tickets');
  }

  onInsert(args: InsertValue<TicketsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: ticketSchema,
      jobType: 'feed',
      data: args,
      docId: args.id
    }];
  }

  onUpdate(args: UpdateValue<TicketsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: ticketSchema,
      jobType: 'feed',
      data: args,
      docId: args.id
    }];
  }

  onUpsert(args: UpsertValue<TicketsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: ticketSchema,
      jobType: 'feed',
      data: args,
      docId: args.id
    }];
  }

  onDelete(args: DeleteID<TicketsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: ticketSchema,
      jobType: 'delete',
      docId: args.id
    }];
  }
}