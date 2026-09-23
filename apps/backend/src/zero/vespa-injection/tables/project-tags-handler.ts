import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseVespaHandler } from '../core/base-handler';
import type { VespaQueueHandler } from '../core/types';
import type { QueryContext } from '../../acl/core/types';
import { projectTagSchema } from '@/vespa/src/types';

type ProjectTagsSchema = Schema['tables']['project_tags'];

/**
 * Vespa handler for the project_tags table (the per-project tag catalog).
 *
 * Feeds one project_tag document per row, which is what the kanban tag
 * dropdown's type-ahead search queries.
 */
export class ProjectTagsVespaHandler extends BaseVespaHandler<'project_tags'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'project_tags');
  }

  onInsert(args: InsertValue<ProjectTagsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: projectTagSchema,
      jobType: 'feed',
      data: args,
      docId: args.id
    }];
  }

  onUpdate(args: UpdateValue<ProjectTagsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: projectTagSchema,
      jobType: 'feed',
      data: args,
      docId: args.id
    }];
  }

  onUpsert(args: UpsertValue<ProjectTagsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: projectTagSchema,
      jobType: 'feed',
      data: args,
      docId: args.id
    }];
  }

  // No mutator deletes project tags today, but ProjectTagsACL exposes canDelete,
  // so the path is reachable and the index must not be left with an orphan.
  onDelete(args: DeleteID<ProjectTagsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{
      schema: projectTagSchema,
      jobType: 'delete',
      docId: args.id
    }];
  }
}
