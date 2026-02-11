import type { InsertDocument, VespaSchema } from '@/vespa/src/types';
import { ticketSchema } from '@/vespa/src/types';
import type { VespaJobType } from '@/zero/vespa-injection/core/types';
import { runTicketDescriptionCleanOnCompletion } from './handlers/ticketDescriptionCleanOnCompletion';

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
    await runTicketDescriptionCleanOnCompletion({
      docId: ctx.docId,
      jobType: ctx.jobType,
      mappedData: ctx.mappedData as Record<string, unknown>,
      userId: ctx.userId,
    });
  }
}

export const vespaPostIngestHooks = new VespaPostIngestHooks();
