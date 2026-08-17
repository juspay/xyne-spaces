import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class ConversationLabelsACL extends BaseACL<'conversation_labels'> {
  async canInsert(args: InsertValue<TableSchema<'conversation_labels'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'conversation_labels');
  }

  async canUpdate(args: UpdateValue<TableSchema<'conversation_labels'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.conversation_labels.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Conversation label update failed: label does not exist', 'conversation_labels');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'conversation_labels');
  }

  async canDelete(args: DeleteID<TableSchema<'conversation_labels'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.conversation_labels.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Conversation label delete failed: label does not exist', 'conversation_labels');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'conversation_labels');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'conversation_labels'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Conversation label upsert failed: use insert or update separately', 'conversation_labels');
  }
}
