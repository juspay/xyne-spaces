import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseVespaHandler } from '../core/base-handler';
import type { VespaQueueHandler } from '../core/types';
import type { QueryContext } from '../../acl/core/types';
import { projectSchema } from '@/vespa/src/types';

type ProjectsSchema = Schema['tables']['projects'];
/**
 * Vespa handler for the projects table.
 * 
 * Queues jobs for channel indexing in Vespa's chat_container schema.
 */
export class ProjectsVespaHandler extends BaseVespaHandler<'projects'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'projects');
  }

  onInsert(args: InsertValue<ProjectsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: projectSchema,
      jobType: 'feed',
      data: args,
      docId: args.id
    }];
  }

  onUpdate(args: UpdateValue<ProjectsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: projectSchema,
      jobType: 'feed',
      data: args,
      docId: args.id
    }];
  }

  onUpsert(args: UpsertValue<ProjectsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: projectSchema,
      jobType: 'feed',
      data: args,
      docId: args.id
    }];
  }

  onDelete(args: DeleteID<ProjectsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: projectSchema,
      jobType: 'delete',
      docId: args.id
    }];
  }
}