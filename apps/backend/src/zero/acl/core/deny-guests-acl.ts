import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  type TableName,
  type TableSchema,
  MutationACLError,
} from './types';
import { Schema } from '@xyne/shared'
import { BaseACL } from './base-acl';

/**
 * ACL that allows all operations for non-guest users,
 * but denies every mutation for users with role === 'GUEST'.
 *
 * Used as a drop-in replacement for NoAcl on tables that should
 * remain unrestricted for regular users but be invisible to guests.
 */
export class DenyGuestsACL<TTable extends TableName> extends BaseACL<TTable> {
  private deny(): void {
    throw new MutationACLError(
      `${this.tableName} is not accessible to guest users`,
      this.tableName
    );
  }

  async canInsert(_args: InsertValue<TableSchema<TTable>>, _tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === 'GUEST') this.deny();
  }

  async canUpdate(_args: UpdateValue<TableSchema<TTable>>, _tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === 'GUEST') this.deny();
  }

  async canDelete(_args: DeleteID<TableSchema<TTable>>, _tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === 'GUEST') this.deny();
  }

  async canUpsert(_args: UpsertValue<TableSchema<TTable>>, _tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === 'GUEST') this.deny();
  }
}
