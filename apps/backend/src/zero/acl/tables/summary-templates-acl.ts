import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

/**
 * Summary templates are workspace-scoped configuration. The workspace match is
 * checked against the STORED row on update/delete rather than the caller's
 * args, so a foreign id cannot be edited by supplying an in-workspace value.
 */
export class SummaryTemplatesACL extends BaseACL<'summary_templates'> {
  async canInsert(args: InsertValue<TableSchema<'summary_templates'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'summary_templates');
  }

  async canUpdate(args: UpdateValue<TableSchema<'summary_templates'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.summary_templates.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Summary template update failed: template does not exist', 'summary_templates');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'summary_templates');
    if (args.workspaceId !== undefined && args.workspaceId !== row.workspaceId) {
      throw new MutationACLError('Summary template update failed: workspace cannot be reassigned', 'summary_templates');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'summary_templates'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.summary_templates.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Summary template delete failed: template does not exist', 'summary_templates');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'summary_templates');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'summary_templates'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Summary template upsert failed: use insert or update separately', 'summary_templates');
  }
}
