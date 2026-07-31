import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class ClassificationMappingsACL extends BaseACL<'classification_mappings'> {
  async canInsert(args: InsertValue<TableSchema<'classification_mappings'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'classification_mappings');
  }

  async canUpdate(args: UpdateValue<TableSchema<'classification_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.classification_mappings.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Classification mapping update failed: mapping does not exist', 'classification_mappings');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'classification_mappings');
  }

  async canDelete(args: DeleteID<TableSchema<'classification_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.classification_mappings.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Classification mapping delete failed: mapping does not exist', 'classification_mappings');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'classification_mappings');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'classification_mappings'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Classification mapping upsert failed: use insert or update separately', 'classification_mappings');
  }
}
