import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class ApplicationReleaseTicketsACL extends BaseACL<'application_release_tickets'> {
  async canInsert(args: InsertValue<TableSchema<'application_release_tickets'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'application_release_tickets');
  }

  async canUpdate(args: UpdateValue<TableSchema<'application_release_tickets'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.application_release_tickets.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Application release ticket update failed: record does not exist', 'application_release_tickets');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'application_release_tickets');
  }

  async canDelete(args: DeleteID<TableSchema<'application_release_tickets'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.application_release_tickets.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Application release ticket delete failed: record does not exist', 'application_release_tickets');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'application_release_tickets');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'application_release_tickets'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Application release ticket upsert failed: use insert or update separately', 'application_release_tickets');
  }
}
