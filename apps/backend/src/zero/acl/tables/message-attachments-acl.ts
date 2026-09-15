import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class MessageAttachmentsACL extends BaseACL<'message_attachments'> {

  async canInsert(args: InsertValue<TableSchema<'message_attachments'>>, _tx: Transaction<Schema>): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Message attachment not in this workspace', 'message_attachments');
    }
    // Cannot create an attachment attributed to another user.
    if (args.createdBy && args.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Cannot create an attachment for another user', 'message_attachments');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'message_attachments'>>, tx: Transaction<Schema>): Promise<void> {
    const attachment = await tx.run(zql.message_attachments.where('id', args.id).one());
    if (attachment?.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Message attachment not found in this workspace', 'message_attachments');
    }
    // Only the creator may modify an attachment.
    if (attachment.createdBy && attachment.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Cannot modify an attachment you did not create', 'message_attachments');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'message_attachments'>>, tx: Transaction<Schema>): Promise<void> {
    const attachment = await tx.run(zql.message_attachments.where('id', args.id).one());
    if (attachment?.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Message attachment not found in this workspace', 'message_attachments');
    }
    // Only the creator may delete an attachment.
    if (attachment.createdBy && attachment.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Cannot delete an attachment you did not create', 'message_attachments');
    }
  }

  async canUpsert(args: UpsertValue<TableSchema<'message_attachments'>>, tx: Transaction<Schema>): Promise<void> {
    // Enforce the same workspace + creator gate as insert/update.
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Message attachment not in this workspace', 'message_attachments');
    }
    if (args.createdBy && args.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Cannot upsert an attachment for another user', 'message_attachments');
    }
    const existing = await tx.run(zql.message_attachments.where('id', args.id).one());
    if (existing && existing.createdBy && existing.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Cannot modify an attachment you did not create', 'message_attachments');
    }
  }
}
