import type { InsertDocument, VespaSchema } from '@/vespa/src/types';
import { ticketSchema } from '@/vespa/src/types';
import type { VespaJobType } from '@/zero/vespa-injection/core/types';
import { runTicketDescriptionCleanOnCompletion } from './handlers/ticketDescriptionCleanOnCompletion';
import { runMailAssignedToSync } from './handlers/mailAssignedToSync';

export type VespaPostIngestContext = {
  schema: VespaSchema;
  docId: string;
  jobType: VespaJobType;
  mappedData?: InsertDocument | Partial<InsertDocument> | null;
  userId?: string;
};

class VespaPostIngestHooks {
  async run(ctx: VespaPostIngestContext): Promise<void> {
    if (ctx.schema !== ticketSchema) return;
    // allSettled so one hook throwing does not skip the others; first rejection still re-thrown.
    const outcomes = await Promise.allSettled([
      runTicketDescriptionCleanOnCompletion({
        docId: ctx.docId,
        jobType: ctx.jobType,
        mappedData: ctx.mappedData as Record<string, unknown>,
        userId: ctx.userId,
      }),
      runMailAssignedToSync({
        docId: ctx.docId,
        jobType: ctx.jobType,
        mappedData: ctx.mappedData as Record<string, unknown>,
      }),
    ]);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    if (rejected) throw (rejected as PromiseRejectedResult).reason;
  }
}

export const vespaPostIngestHooks = new VespaPostIngestHooks();
