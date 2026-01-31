import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import type { TableName } from './types';
export class BaseQueryACL<TTable extends TableName> {
  protected readonly ctx: Context;
  protected readonly tableName: TTable;

  constructor(ctx: Context, tableName: TTable) {
    this.ctx = ctx;
    this.tableName = tableName;
  }

  canSelect<TReturn>(query: Query<TTable, Schema, TReturn>): Query<TTable, Schema, TReturn> {
    return query;
  }
}
