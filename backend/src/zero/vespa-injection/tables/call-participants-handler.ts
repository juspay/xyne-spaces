import type { InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { callSchema } from '@/vespa/src/types';
import { BaseVespaHandler } from '../core/base-handler';
import type { VespaQueueHandler } from '../core/types';
import type { QueryContext } from '../../acl/core/types';

type CallParticipantsSchema = Schema['tables']['call_participants'];

export class CallParticipantsVespaHandler extends BaseVespaHandler<'call_participants'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'call_participants');
  }

  onInsert(args: InsertValue<CallParticipantsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return this.feedCall(args.callId);
  }

  onUpdate(args: UpdateValue<CallParticipantsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return this.feedCall(args.callId);
  }

  onUpsert(args: UpsertValue<CallParticipantsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return this.feedCall(args.callId);
  }

  private feedCall(callId?: string): VespaQueueHandler[] {
    if (!callId) {
      return [];
    }

    return [{
      schema: callSchema,
      jobType: 'feed',
      docId: callId,
    }];
  }
}
