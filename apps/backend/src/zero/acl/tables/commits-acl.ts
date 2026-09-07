import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class CommitsACL extends BaseACL<'commits'> {

  async canInsert(_args: InsertValue<TableSchema<'commits'>>, _tx: Transaction<Schema>): Promise<void> {
    // Commits are server-written from VCS sync - deny client inserts
    throw new MutationACLError('Commit insert failed: commits are synced from VCS and cannot be created directly', 'commits');
  }

  async canUpdate(_args: UpdateValue<TableSchema<'commits'>>, _tx: Transaction<Schema>): Promise<void> {
    // Commits are immutable once synced - deny updates
    throw new MutationACLError('Commit update failed: commits are synced from VCS and cannot be modified', 'commits');
  }

  async canDelete(args: DeleteID<TableSchema<'commits'>>, tx: Transaction<Schema>): Promise<void> {
    // Verify workspace access via pull_request relationship before allowing delete
    const row = await tx.run(zql.commits.where('id', args.id).related('pullRequest').one());
    if (!row || !row.pullRequest) {
      throw new MutationACLError('Commit delete failed: commit does not exist', 'commits');
    }
    assertWorkspaceMatch(this.ctx, row.pullRequest.workspaceId, 'commits');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'commits'>>, _tx: Transaction<Schema>): Promise<void> {
    // Commits are server-written from VCS sync - deny client upserts
    throw new MutationACLError('Commit upsert failed: commits are synced from VCS and cannot be modified directly', 'commits');
  }
}
