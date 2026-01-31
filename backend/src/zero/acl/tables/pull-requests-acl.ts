import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';

export class PullRequestsACL extends BaseACL<'pull_requests'> {

  async canInsert(_args: InsertValue<TableSchema<'pull_requests'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Pull request insert failed: pull requests are synced from external providers and cannot be created directly', 'pull_requests');
  }

  async canUpdate(_args: UpdateValue<TableSchema<'pull_requests'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Pull request update failed: pull requests are synced from external providers and cannot be modified directly', 'pull_requests');
  }

  async canDelete(_args: DeleteID<TableSchema<'pull_requests'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Pull request delete failed: pull requests are synced from external providers and cannot be deleted directly', 'pull_requests');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'pull_requests'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Pull request upsert failed: pull requests are synced from external providers and cannot be modified directly', 'pull_requests');
  }
}
