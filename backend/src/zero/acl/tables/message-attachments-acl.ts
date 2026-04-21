import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class MessageAttachmentsACL extends BaseACL<'message_attachments'> {

  async canInsert(args: InsertValue<TableSchema<'message_attachments'>>, _tx: Transaction<Schema>): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Message attachment not in this workspace', 'message_attachments');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'message_attachments'>>, tx: Transaction<Schema>): Promise<void> {
    const attachment = await tx.run(zql.message_attachments.where('id', args.id).one());
    if (attachment?.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Message attachment not found in this workspace', 'message_attachments');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'message_attachments'>>, tx: Transaction<Schema>): Promise<void> {
    const attachment = await tx.run(zql.message_attachments.where('id', args.id).one());
    if (attachment?.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Message attachment not found in this workspace', 'message_attachments');
    }
  }

  async canUpsert(_args: DeleteID<TableSchema<'message_attachments'>>, _tx: Transaction<Schema>): Promise<void> {
    // Anyone can upsert it for now
  }
}
