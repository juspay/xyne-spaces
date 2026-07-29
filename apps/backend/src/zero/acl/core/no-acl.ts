import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  type TableName,
  type TableSchema,
} from './types';
import { Schema } from '@xyne/shared'
import { BaseACL } from './base-acl';

export class NoAcl<TTable extends TableName> extends BaseACL<TTable> {
  async canInsert(_args: InsertValue<TableSchema<TTable>>, _tx: Transaction<Schema>): Promise<void> {
  }

  async canUpdate(_args: UpdateValue<TableSchema<TTable>>, _tx: Transaction<Schema>): Promise<void> {
  }

  async canDelete(_args: DeleteID<TableSchema<TTable>>, _tx: Transaction<Schema>): Promise<void> {
  }

  async canUpsert(_args: UpsertValue<TableSchema<TTable>>, _tx: Transaction<Schema>): Promise<void> {
  }
}