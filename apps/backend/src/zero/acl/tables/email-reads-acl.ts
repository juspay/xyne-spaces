import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class EmailReadsACL extends BaseACL<'email_reads'> {

  async canInsert(args: InsertValue<TableSchema<'email_reads'>>, _tx: Transaction<Schema>): Promise<void> {
    if (args.userId !== this.ctx.userID) {
      throw new MutationACLError('Email read insert failed: you can only mark emails read for yourself', 'email_reads');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'email_reads'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.email_reads.where('id', args.id).one());

    if (!row) {
      throw new MutationACLError('Email read update failed: row does not exist', 'email_reads');
    }

    if (row.userId !== this.ctx.userID) {
      throw new MutationACLError('Email read update failed: you can only modify your own read state', 'email_reads');
    }

    if ('userId' in args && (args as { userId?: string }).userId !== this.ctx.userID) {
      throw new MutationACLError('Email read update failed: cannot reassign read state to another user', 'email_reads');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'email_reads'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.email_reads.where('id', args.id).one());

    if (!row) {
      throw new MutationACLError('Email read delete failed: row does not exist', 'email_reads');
    }

    if (row.userId !== this.ctx.userID) {
      throw new MutationACLError('Email read delete failed: you can only delete your own read state', 'email_reads');
    }
  }

  async canUpsert(_args: UpsertValue<TableSchema<'email_reads'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Email read upsert failed: use insert or update operations separately', 'email_reads');
  }
}
