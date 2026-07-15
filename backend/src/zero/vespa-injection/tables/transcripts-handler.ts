import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseVespaHandler } from '../core/base-handler';
import type { VespaQueueHandler } from '../core/types';
import type { QueryContext } from '../../acl/core/types';
import { callSchema, fileSchema, SubApp } from '@/vespa/src/types';

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
    const jobs: VespaQueueHandler[] = [{
      schema: callSchema,
      jobType: 'feed',
      docId: args.id,
    }];

    if (!this.hasTranscript(args)) {
      return jobs;
    }

    jobs.push({
      schema: fileSchema,
      jobType: 'feed',
      data: args as any,
      docId: args.id,
      app: SubApp.TRANSCRIPT
    });
    return jobs;
  }

  onUpdate(args: UpdateValue<TranscriptsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    const docId = args.id;
    if (!docId) {
      return [];
    }

    const jobs: VespaQueueHandler[] = [{
      schema: callSchema,
      jobType: 'feed',
      docId,
    }];

    if (!this.hasTranscript(args)) {
      return jobs;
    }

    jobs.push({
      schema: fileSchema,
      jobType: 'feed',
      data: args as any,
      docId,
      app: SubApp.TRANSCRIPT
    });

    return jobs;
  }

  onUpsert(args: UpsertValue<TranscriptsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    const jobs: VespaQueueHandler[] = [{
      schema: callSchema,
      jobType: 'feed',
      docId: args.id,
    }];

    if (!this.hasTranscript(args)) {
      return jobs;
    }

    jobs.push({
      schema: fileSchema,
      jobType: 'feed',
      data: args as any,
      docId: args.id,
      app: SubApp.TRANSCRIPT
    });

    return jobs;
  }

  onDelete(args: DeleteID<TranscriptsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [
      {
        schema: callSchema,
        jobType: 'delete',
        docId: args.id,
      },
      {
        schema: fileSchema,
        jobType: 'delete',
        docId: args.id,
        app: SubApp.TRANSCRIPT
      }
    ];
  }
}
