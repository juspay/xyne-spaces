import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class EmailSignaturesACL extends BaseACL<'email_signatures'> {

  async canInsert(args: InsertValue<TableSchema<'email_signatures'>>, _tx: Transaction<Schema>): Promise<void> {
    if (args.userId !== this.ctx.userID) {
      throw new MutationACLError('Email signature insert failed: you can only create signatures for yourself', 'email_signatures');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'email_signatures'>>, tx: Transaction<Schema>): Promise<void> {
    const signature = await tx.run(zql.email_signatures.where('id', args.id).one());

    if (!signature) {
      throw new MutationACLError('Email signature update failed: signature does not exist', 'email_signatures');
    }

    if (signature.userId !== this.ctx.userID) {
      throw new MutationACLError('Email signature update failed: you can only modify your own signatures', 'email_signatures');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'email_signatures'>>, tx: Transaction<Schema>): Promise<void> {
    const signature = await tx.run(zql.email_signatures.where('id', args.id).one());

    if (!signature) {
      throw new MutationACLError('Email signature delete failed: signature does not exist', 'email_signatures');
    }

    if (signature.userId !== this.ctx.userID) {
      throw new MutationACLError('Email signature delete failed: you can only delete your own signatures', 'email_signatures');
    }
  }

  async canUpsert(_args: UpsertValue<TableSchema<'email_signatures'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Email signature upsert failed: use insert or update operations separately', 'email_signatures');
  }
}
