import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class ConversationLabelMappingsACL extends BaseACL<'conversation_label_mappings'> {
  async canInsert(args: InsertValue<TableSchema<'conversation_label_mappings'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'conversation_label_mappings');
  }

  async canUpdate(args: UpdateValue<TableSchema<'conversation_label_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.conversation_label_mappings.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Conversation label mapping update failed: mapping does not exist', 'conversation_label_mappings');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'conversation_label_mappings');
  }

  async canDelete(args: DeleteID<TableSchema<'conversation_label_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.conversation_label_mappings.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Conversation label mapping delete failed: mapping does not exist', 'conversation_label_mappings');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'conversation_label_mappings');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'conversation_label_mappings'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Conversation label mapping upsert failed: use insert or update separately', 'conversation_label_mappings');
  }
}
