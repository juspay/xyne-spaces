import {
  defineQuery as zeroDefineQuery,
  type Query,
  type QueryDefinition,
} from '@rocicorp/zero';
import { schema, type Schema, type Context } from '../schema';
import { QueryACLFactory } from './core/query-acl-factory';
import type { TableName, SelectArgs } from './core/types';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { ReadonlyJSONValue } from '@rocicorp/zero';

const defaultValidator: StandardSchemaV1<undefined, { lastUpdatedAt?: number }> = {
  '~standard': {
    version: 1,
    vendor: 'custom',
    validate: (value: unknown): { value: { lastUpdatedAt?: number } } | { issues: Array<{ message: string; path: string[] }> } => {
      if (value === undefined || value === null) {
        return { value: { lastUpdatedAt: undefined } };
      }
      const val = value as Record<string, unknown>;
      const lastUpdatedAt = val.lastUpdatedAt;
      if (lastUpdatedAt !== undefined && typeof lastUpdatedAt !== 'number') {
        return { issues: [{ message: 'lastUpdatedAt must be a number', path: ['lastUpdatedAt'] }] };
      }
      return { value: { lastUpdatedAt } as { lastUpdatedAt?: number } };
    },
  },
};

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

// applyQueryACL runs the root table's canSelect; nested `.related()` subqueries are not
// independently ACL-filtered (the root ACL + the workspace backstop apply). Log each distinct
// `root -> related` pattern once per process, without flooding logs on every synced query.
// Purely observational — never throws.
const loggedRelatedAclSkips = new Set<string>();
function logSkippedRelatedACLs(query: unknown, rootTable: string): void {
  try {
    const related = (query as { ast?: { related?: Array<{ subquery?: { table?: string } }> } })?.ast?.related;
    if (!related || related.length === 0) return;
    const relatedTables = Array.from(
      new Set(
        related
          .map((r) => r?.subquery?.table)
          .filter((t): t is string => typeof t === 'string'),
      ),
    ).sort();
    if (relatedTables.length === 0) return;
    const signature = `${rootTable}=>${relatedTables.join(',')}`;
    if (loggedRelatedAclSkips.has(signature)) return;
    loggedRelatedAclSkips.add(signature);
    // eslint-disable-next-line no-console
    console.warn(
      `[related-acl] nested related() subquery not independently ACL-filtered: synced query on ` +
        `'${rootTable}' has .related() subqueries [${relatedTables.join(', ')}] (only the root ACL + ` +
        `workspace backstop apply).`,
    );
  } catch {
    /* observability only — must never break a query */
  }
}

// Tables that carry a workspaceId column — derived structurally from the schema.
const WORKSPACE_SCOPED_TABLES: ReadonlySet<string> = new Set(
  Object.entries(schema.tables)
    .filter(([, t]) => 'workspaceId' in (t as { columns: Record<string, unknown> }).columns)
    .map(([name]) => name),
);
// Tables whose own ACL owns cross-workspace/global visibility (e.g. GLOBAL apps) — skip the backstop.
const WORKSPACE_SCOPE_OPT_OUT: ReadonlySet<string> = new Set(['apps']);

function applyQueryACL<TQuery>(
  query: TQuery,
  ctx: Context,
  args?: SelectArgs
): TQuery {
  const tableName = getTableNameFromQuery(query);
  logSkippedRelatedACLs(query, tableName); // observability only (no behavior change)
  const acl = QueryACLFactory.getACL(tableName, ctx);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoped = acl.canSelect(query as any, args) as TQuery;
  // Tenant backstop: scope root rows to the caller's workspace. Structural + idempotent with
  // per-table ACLs that already filter workspaceId. Skips tables with no workspaceId column / opt-outs.
  if (
    ctx.workspaceId &&
    WORKSPACE_SCOPED_TABLES.has(tableName) &&
    !WORKSPACE_SCOPE_OPT_OUT.has(tableName)
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (scoped as any).where('workspaceId', '=', ctx.workspaceId) as TQuery;
  }
  return scoped;
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
    return zeroDefineQuery(defaultValidator, (params: any) => {
      const { lastUpdatedAt, ..._restArgs } = params.args || {};
      const query = (queryFn as any)({ ctx: params.ctx });
      const queryWithACL = applyQueryACL(query, params.ctx, params.args);
      if (lastUpdatedAt && hasQueryAST(queryWithACL)) {
        const tableName = getTableNameFromQuery(queryWithACL);
        
          
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (queryWithACL as any).where('updatedAt', '>=', lastUpdatedAt);
        
      }
      
      return queryWithACL;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
  }

  // With validator case - don't extend, just use original validator
  // lastUpdatedAt will be passed in args but stripped before calling queryFn
  const validator = validatorOrQueryFn;
  const queryFn = maybeQueryFn!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return zeroDefineQuery(validator as any, (params: any) => {
    // Extract lastUpdatedAt from args, pass rest to queryFn
    const { lastUpdatedAt, ...restArgs } = params.args || {};
    
    const query = queryFn({ ctx: params.ctx, args: restArgs });
    const queryWithACL = applyQueryACL(query, params.ctx, params.args as SelectArgs);
    
    // Apply delta filter if lastUpdatedAt is provided and table has updatedAt column
    if (lastUpdatedAt && hasQueryAST(queryWithACL)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (queryWithACL as any).where('updatedAt', '>=', lastUpdatedAt);
    }
    
    return queryWithACL;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}
