import type { Query } from '@rocicorp/zero';
import type { Schema } from '../../schema';

export type TableName = keyof Schema['tables'];

export type TableQuery<TTable extends TableName> = Query<TTable, Schema, unknown>;
