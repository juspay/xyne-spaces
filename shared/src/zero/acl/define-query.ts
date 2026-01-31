import {
  defineQuery as zeroDefineQuery,
  type Query,
  type QueryDefinition,
} from '@rocicorp/zero';
import { schema, type Schema, type Context } from '../schema';
import { QueryACLFactory } from './core/query-acl-factory';
import type { TableName } from './core/types';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { ReadonlyJSONValue } from '@rocicorp/zero';

interface QueryWithAST {
  readonly ast: {
    readonly table: string;
  };
}

function hasQueryAST(query: unknown): query is QueryWithAST {
  return (
    typeof query === 'object' &&
    query !== null &&
    'ast' in query &&
    typeof (query as QueryWithAST).ast === 'object' &&
    (query as QueryWithAST).ast !== null &&
    'table' in (query as QueryWithAST).ast &&
    typeof (query as QueryWithAST).ast.table === 'string'
  );
}

function getTableNameFromQuery(query: unknown): TableName {
  if (!hasQueryAST(query)) {
    throw new Error('Cannot extract table name from query - invalid query object');
  }
  return query.ast.table as TableName;
}

function applyQueryACL<TQuery>(
  query: TQuery,
  ctx: Context
): TQuery {
  const tableName = getTableNameFromQuery(query);
  const acl = QueryACLFactory.getACL(tableName, { userID: ctx.userID });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return acl.canSelect(query as any) as TQuery;
}

type QueryDefinitionFunction<TTable extends TableName, TOutput, TReturn> = (
  params: { ctx: Context; args: TOutput }
) => Query<TTable, Schema, TReturn>;

type QueryDefinitionFunctionNoArgs<TTable extends TableName, TReturn> = (
  params: { ctx: Context }
) => Query<TTable, Schema, TReturn>;

export function defineQuery<
  TInput extends ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined,
  TTable extends TableName = TableName,
  TReturn = unknown
>(
  validator: StandardSchemaV1<TInput, TOutput>,
  queryFn: QueryDefinitionFunction<TTable, TOutput, TReturn>
): QueryDefinition<TTable, TInput, TOutput, TReturn, Context>;

export function defineQuery<
  TTable extends TableName = TableName,
  TReturn = unknown
>(
  queryFn: QueryDefinitionFunctionNoArgs<TTable, TReturn>
): QueryDefinition<TTable, undefined, undefined, TReturn, Context>;

// Implementation
export function defineQuery<
  TInput extends ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined,
  TTable extends TableName = TableName,
  TReturn = unknown
>(
  validatorOrQueryFn: StandardSchemaV1<TInput, TOutput> | QueryDefinitionFunctionNoArgs<TTable, TReturn>,
  maybeQueryFn?: QueryDefinitionFunction<TTable, TOutput, TReturn>
): QueryDefinition<TTable, TInput, TOutput, TReturn, Context> {
  if (typeof validatorOrQueryFn === 'function') {
    const queryFn = validatorOrQueryFn as QueryDefinitionFunctionNoArgs<TTable, TReturn>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return zeroDefineQuery((params: any) => {
      const query = queryFn(params);
      return applyQueryACL(query, params.ctx);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
  }

  // With validator case
  const validator = validatorOrQueryFn;
  const queryFn = maybeQueryFn!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return zeroDefineQuery(validator, (params: any) => {
    const query = queryFn(params);
    return applyQueryACL(query, params.ctx);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}