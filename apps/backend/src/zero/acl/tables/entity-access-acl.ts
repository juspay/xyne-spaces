import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

/**
 * Entity access grants. These rows ARE the sharing decision for a canvas,
 * channel or project, so a cross-workspace write would hand out access to
 * another tenant's entity — the workspace match is checked against the STORED
 * row on update/delete, never against the caller-supplied args.
 */
export class EntityAccessACL extends BaseACL<'entity_access'> {
  async canInsert(args: InsertValue<TableSchema<'entity_access'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'entity_access');
  }

  async canUpdate(args: UpdateValue<TableSchema<'entity_access'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.entity_access.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Entity access update failed: grant does not exist', 'entity_access');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'entity_access');
    if (args.workspaceId !== undefined && args.workspaceId !== row.workspaceId) {
      throw new MutationACLError('Entity access update failed: workspace cannot be reassigned', 'entity_access');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'entity_access'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.entity_access.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Entity access delete failed: grant does not exist', 'entity_access');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'entity_access');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'entity_access'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Entity access upsert failed: use insert or update separately', 'entity_access');
  }
}
