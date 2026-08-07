import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseVespaHandler } from '../core/base-handler';
import type { VespaQueueHandler } from '../core/types';
import type { QueryContext } from '../../acl/core/types';
import { appSchema } from '@/vespa/src/types';

type AppsSchema = Schema['tables']['apps'];

/**
 * Vespa handler for the `apps` table (xyne-apps catalog).
 *
 * Queues feed/delete jobs for the Vespa `app` schema. The worker re-fetches the
 * row by docId and maps it (mapApp), denormalizing workspaceId + creator identity.
 */
export class AppsVespaHandler extends BaseVespaHandler<'apps'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'apps');
  }

  onInsert(args: InsertValue<AppsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{ schema: appSchema, jobType: 'feed', data: args, docId: args.id }];
  }

  onUpdate(args: UpdateValue<AppsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{ schema: appSchema, jobType: 'feed', data: args, docId: args.id }];
  }

  onUpsert(args: UpsertValue<AppsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{ schema: appSchema, jobType: 'feed', data: args, docId: args.id }];
  }

  onDelete(args: DeleteID<AppsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{ schema: appSchema, jobType: 'delete', docId: args.id }];
  }
}
