import type { Query, ReadonlyJSONValue } from '@rocicorp/zero';
import type { Schema } from '../../schema';

export type TableName = keyof Schema['tables'];

export type TableQuery<TTable extends TableName> = Query<TTable, Schema, unknown>;
export type SelectArgs = Record<string, ReadonlyJSONValue | undefined>;
