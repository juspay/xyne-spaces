import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseVespaHandler } from '../core/base-handler';
import type { VespaQueueHandler } from '../core/types';
import type { QueryContext } from '../../acl/core/types';
import { fileSchema, SubApp } from '@/vespa/src/types';

type TranscriptsSchema = Schema['tables']['calls'];

/**
 * Vespa handler for the calls table.
 *
 * Queues jobs for call transcript indexing in Vespa's file schema.
 * Only processes calls with a transcript URL.
 */
export class TranscriptsVespaHandler extends BaseVespaHandler<'calls'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'calls');
  }

  private hasTranscript(args: any): boolean {
    // Only process calls that have a transcript URL
    return !!args.transcript && typeof args.transcript === 'string' && args.transcript.length > 0;
  }

  onInsert(args: InsertValue<TranscriptsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    if (!this.hasTranscript(args)) {
      return [];
    }

    return [{
      schema: fileSchema,
      jobType: 'feed',
      data: args as any,
      docId: args.id,
      app: SubApp.TRANSCRIPT
    }];
  }

  onUpdate(args: UpdateValue<TranscriptsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    if (!this.hasTranscript(args)) {
      return [];
    }

    return [{
      schema: fileSchema,
      jobType: 'feed',
      data: args as any,
      docId: args.id,
      app: SubApp.TRANSCRIPT
    }];
  }

  onUpsert(args: UpsertValue<TranscriptsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    if (!this.hasTranscript(args)) {
      return [];
    }

    return [{
      schema: fileSchema,
      jobType: 'feed',
      data: args as any,
      docId: args.id,
      app: SubApp.TRANSCRIPT
    }];
  }

  onDelete(args: DeleteID<TranscriptsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: fileSchema,
      jobType: 'delete',
      docId: args.id,
      app: SubApp.TRANSCRIPT
    }];
  }
}
