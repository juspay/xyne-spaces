import type { DeleteID, Transaction } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseVespaHandler } from '../core/base-handler';
import type { VespaQueueHandler } from '../core/types';
import type { QueryContext } from '../../acl/core/types';
import { sdlcContainerSchema, sdlcRepositorySchema } from '@/vespa/src/types';

/**
 * SDLC Hub search: a deleted track, folder or repository leaves Vespa with its row. Other hub
 * changes made through Zero affect entries beyond the row written (the containers under a
 * folder, the documents of a type), so they queue their jobs from the side-effect handlers
 * (zero/side-effects/tables/sdlc-handlers.ts), which run after the write commits.
 */
export class SdlcTracksVespaHandler extends BaseVespaHandler<'sdlc_tracks'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'sdlc_tracks');
  }

  onDelete(args: DeleteID<Schema['tables']['sdlc_tracks']>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{ schema: sdlcContainerSchema, jobType: 'delete', docId: args.id }];
  }
}

export class SdlcFoldersVespaHandler extends BaseVespaHandler<'sdlc_folders'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'sdlc_folders');
  }

  onDelete(args: DeleteID<Schema['tables']['sdlc_folders']>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{ schema: sdlcContainerSchema, jobType: 'delete', docId: args.id }];
  }
}

export class ReposVespaHandler extends BaseVespaHandler<'repos'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'repos');
  }

  onDelete(args: DeleteID<Schema['tables']['repos']>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{ schema: sdlcRepositorySchema, jobType: 'delete', docId: args.id }];
  }
}
