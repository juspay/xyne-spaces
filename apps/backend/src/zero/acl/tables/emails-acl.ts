import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class EmailsACL extends BaseACL<'emails'> {
  async canInsert(args: InsertValue<TableSchema<'emails'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'emails');
  }

  async canUpdate(args: UpdateValue<TableSchema<'emails'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.emails.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Email update failed: email does not exist', 'emails');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'emails');
  }

  async canDelete(args: DeleteID<TableSchema<'emails'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.emails.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Email delete failed: email does not exist', 'emails');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'emails');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'emails'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Email upsert failed: use insert or update separately', 'emails');
  }
}
