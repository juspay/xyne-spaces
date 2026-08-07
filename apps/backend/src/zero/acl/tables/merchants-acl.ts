import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { type TableSchema } from '../core/types';

export class MerchantsACL extends BaseACL<'merchants'> {
  async canInsert(_args: InsertValue<TableSchema<'merchants'>>, _tx: Transaction<Schema>): Promise<void> {
    return;
  }

  async canUpdate(_args: UpdateValue<TableSchema<'merchants'>>, _tx: Transaction<Schema>): Promise<void> {
    return;
  }

  async canDelete(_args: DeleteID<TableSchema<'merchants'>>, _tx: Transaction<Schema>): Promise<void> {
    return;
  }

  async canUpsert(_args: UpsertValue<TableSchema<'merchants'>>, _tx: Transaction<Schema>): Promise<void> {
    return;
  }
}
