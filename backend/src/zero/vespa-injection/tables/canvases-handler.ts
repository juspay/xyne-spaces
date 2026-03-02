import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseVespaHandler } from '../core/base-handler';
import type { VespaQueueHandler } from '../core/types';
import type { QueryContext } from '../../acl/core/types';
import { fileSchema, SubApp } from '@/vespa/src/types';

type CanvasesSchema = Schema['tables']['canvases'];

/**
 * Vespa handler for the canvases table.
 *
 * Queues jobs for canvas indexing in Vespa's file schema.
 */
export class CanvasesVespaHandler extends BaseVespaHandler<'canvases'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'canvases');
  }

  onInsert(args: InsertValue<CanvasesSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: fileSchema,
      jobType: 'feed',
      data: args as any,
      docId: args.id,
      app: SubApp.CANVAS
    }];
  }

  onUpdate(args: UpdateValue<CanvasesSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: fileSchema,
      jobType: 'feed',
      data: args as any,
      docId: args.id,
      app: SubApp.CANVAS
    }];
  }

  onUpsert(args: UpsertValue<CanvasesSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: fileSchema,
      jobType: 'feed',
      data: args as any,
      docId: args.id,
      app: SubApp.CANVAS
    }];
  }

  onDelete(args: DeleteID<CanvasesSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: fileSchema,
      jobType: 'delete',
      docId: args.id,
      app: SubApp.CANVAS
    }];
  }
}
