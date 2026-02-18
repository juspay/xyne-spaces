import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { TableSchema } from '../core/types';

export class MessageAttachmentsACL extends BaseACL<'message_attachments'> {

  async canInsert(_args: InsertValue<TableSchema<'message_attachments'>>, _tx: Transaction<Schema>): Promise<void> {
    //Anyone can insert it for now
  }

  async canUpdate(_args: UpdateValue<TableSchema<'message_attachments'>>, _tx: Transaction<Schema>): Promise<void> {
    // Anyone can update it for now
  }

  async canDelete(_args: DeleteID<TableSchema<'message_attachments'>>, _tx: Transaction<Schema>): Promise<void> {
    // Anyone can delete it for now
  }

  async canUpsert(_args: DeleteID<TableSchema<'message_attachments'>>, _tx: Transaction<Schema>): Promise<void> {
    // Anyone can upsert it for now
  }
}
