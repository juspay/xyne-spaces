import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class LinkAccessACL extends BaseACL<'link_access'> {
  async canInsert(args: InsertValue<TableSchema<'link_access'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'link_access');
  }

  async canUpdate(args: UpdateValue<TableSchema<'link_access'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.link_access.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Link access update failed: record does not exist', 'link_access');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'link_access');
  }

  async canDelete(args: DeleteID<TableSchema<'link_access'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.link_access.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Link access delete failed: record does not exist', 'link_access');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'link_access');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'link_access'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Link access upsert failed: use insert or update separately', 'link_access');
  }
}
