import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { type TableSchema } from '../core/types';

export class LookupValuesACL extends BaseACL<'lookup_values'> {
  async canInsert(_args: InsertValue<TableSchema<'lookup_values'>>, _tx: Transaction<Schema>): Promise<void> {
    return;
  }

  async canUpdate(_args: UpdateValue<TableSchema<'lookup_values'>>, _tx: Transaction<Schema>): Promise<void> {
    return;
  }

  async canDelete(_args: DeleteID<TableSchema<'lookup_values'>>, _tx: Transaction<Schema>): Promise<void> {
    return;
  }

  async canUpsert(_args: UpsertValue<TableSchema<'lookup_values'>>, _tx: Transaction<Schema>): Promise<void> {
    return;
  }
}
