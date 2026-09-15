import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class EmailDraftsACL extends BaseACL<'email_drafts'> {
  async canInsert(args: InsertValue<TableSchema<'email_drafts'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'email_drafts');
  }

  async canUpdate(args: UpdateValue<TableSchema<'email_drafts'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.email_drafts.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Email draft update failed: draft does not exist', 'email_drafts');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'email_drafts');
  }

  async canDelete(args: DeleteID<TableSchema<'email_drafts'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.email_drafts.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Email draft delete failed: draft does not exist', 'email_drafts');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'email_drafts');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'email_drafts'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Email draft upsert failed: use insert or update separately', 'email_drafts');
  }
}
