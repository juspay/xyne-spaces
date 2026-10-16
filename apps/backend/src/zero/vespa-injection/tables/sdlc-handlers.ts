import type { DeleteID, Transaction } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseVespaHandler } from '../core/base-handler';
import type { VespaQueueHandler } from '../core/types';
import type { QueryContext } from '../../acl/core/types';
import { sdlcRepositorySchema } from '@/vespa/src/types';

/**
 * SDLC Hub search: a deleted repository leaves Vespa with its row. Other hub changes made
 * through Zero affect entries beyond the row written (the containers under a folder, the
 * documents of a type), so they queue their jobs from the side-effect handlers
 * (zero/side-effects/tables/sdlc-handlers.ts), which run after the write commits. Tracks and
 * folders are never deleted as rows: they leave a hub when the edge that places them is deleted.
 */
export class ReposVespaHandler extends BaseVespaHandler<'repos'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'repos');
  }

  onDelete(args: DeleteID<Schema['tables']['repos']>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{ schema: sdlcRepositorySchema, jobType: 'delete', docId: args.id }];
  }
}
