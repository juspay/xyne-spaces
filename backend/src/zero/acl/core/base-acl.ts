import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  type TableName,
  type QueryContext,
  type TableSchema,
  MutationACLError
} from './types';
import { Schema } from '@xyne/shared'

export class BaseACL<TTable extends TableName> {
  public ctx: QueryContext;
  protected tableName: string;
  
  constructor(ctx: QueryContext, tableName?: string) {
    this.ctx = ctx;
    this.tableName = tableName || 'unknown';
  }

  async canInsert(_args: InsertValue<TableSchema<TTable>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError("Acl not defined for inserts on table", this.tableName);
  }

  async canUpdate(_args: UpdateValue<TableSchema<TTable>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError("Acl not defined for updates on table", this.tableName);
  }

  async canDelete(_args: DeleteID<TableSchema<TTable>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError("Acl not defined for delete on table", this.tableName);
  }

  async canUpsert(_args: UpsertValue<TableSchema<TTable>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError("Acl not defined for upsert on table", this.tableName);
  }
}
