import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { MutationACLError, type TableSchema } from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class ChannelSectionsACL extends BaseACL<'channel_sections'> {
  async canInsert(args: InsertValue<TableSchema<'channel_sections'>>, _tx: Transaction<Schema>): Promise<void> {
    if (args.userId !== this.ctx.userID) {
      throw new MutationACLError(
        'Channel section insert failed: you can only create sections for yourself',
        'channel_sections',
      );
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'channel_sections'>>, tx: Transaction<Schema>): Promise<void> {
    const section = await tx.run(zql.channel_sections.where('id', args.id).one());
    if (!section) {
      throw new MutationACLError('Channel section update failed: section does not exist', 'channel_sections');
    }
    if (section.userId !== this.ctx.userID) {
      throw new MutationACLError(
        'Channel section update failed: you can only modify your own sections',
        'channel_sections',
      );
    }
  }

  async canDelete(args: DeleteID<TableSchema<'channel_sections'>>, tx: Transaction<Schema>): Promise<void> {
    const section = await tx.run(zql.channel_sections.where('id', args.id).one());
    if (!section) {
      throw new MutationACLError('Channel section delete failed: section does not exist', 'channel_sections');
    }
    if (section.userId !== this.ctx.userID) {
      throw new MutationACLError(
        'Channel section delete failed: you can only delete your own sections',
        'channel_sections',
      );
    }
  }

  async canUpsert(_args: UpsertValue<TableSchema<'channel_sections'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError(
      'Channel section upsert failed: use insert or update operations separately',
      'channel_sections',
    );
  }
}
