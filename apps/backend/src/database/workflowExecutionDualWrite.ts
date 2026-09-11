import { PrismaClient } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import { logger } from '@/utils/logger';

/** Every column of workflow_executions, identical in both schemas. */
const COLUMNS = [
  'workspaceId',
  'id',
  'workflowId',
  'workflowType',
  'context',
  'status',
  'output',
  'parentWorkflowExecutionId',
  'sourceStepsId',
  'stepInputOverrideData',
  'tag',
  'createdAt',
  'updatedAt',
  'ignoreDuration',
  'mode',
  'createdBy',
] as const;

const COLUMN_LIST = COLUMNS.map((column) => `"${column}"`).join(', ');
const UPDATE_LIST = COLUMNS.filter((column) => column !== 'id')
  .map((column) => `"${column}" = EXCLUDED."${column}"`)
  .join(', ');

/**
 * `INSERT INTO workflow.workflow_executions ... SELECT ... FROM <source>`, overwriting
 * rows that already exist. `source` is any relation carrying all the columns: a table,
 * or a CTE such as `updated` from an `UPDATE ... RETURNING *`.
 */
export function workflowSchemaUpsertFrom(source: string, where = ''): string {
  return (
    `INSERT INTO "workflow"."workflow_executions" (${COLUMN_LIST}) ` +
    `SELECT ${COLUMN_LIST} FROM ${source} ${where} ` +
    `ON CONFLICT ("id") DO UPDATE SET ${UPDATE_LIST}`
  );
}

const COPY_BY_ID_SQL = workflowSchemaUpsertFrom(
  '"public"."workflow_executions"',
  'WHERE "id" = ANY($1::text[])'
);
const DELETE_BY_ID_SQL = 'DELETE FROM "workflow"."workflow_executions" WHERE "id" = ANY($1::text[])';
const DELETE_BY_WORKFLOW_SQL =
  'DELETE FROM "workflow"."workflow_executions" WHERE "workflowId" = ANY($1::text[])';

type Row = Record<string, unknown>;

/** The raw-query and lookup surface used for the copy, bound to the caller's transaction. */
type Runner = Pick<PrismaClient, '$executeRawUnsafe' | 'workflowExecution' | 'workflow'>;

/** Prisma's per-request internals; `transaction` identifies the caller's transaction. */
type InternalParams = { transaction?: { kind: 'itx' | 'batch' } };

type OperationParams = {
  operation: string;
  args: Row | undefined;
  query: (args: unknown) => Promise<unknown>;
  __internalParams?: InternalParams;
};

function idOf(where: unknown): string | null {
  const id = (where as Row | undefined)?.id;
  return typeof id === 'string' ? id : null;
}

/**
 * Make sure `id` comes back from a create even when the caller selected other fields,
 * and hide it again afterwards so the caller sees exactly what it asked for.
 */
function withIdSelected(args: Row | undefined): { args: Row; strip: <T>(row: T) => T } {
  const select = args?.select as Row | undefined;
  if (!select || select.id) return { args: args ?? {}, strip: (row) => row };
  return {
    args: { ...args, select: { ...select, id: true } },
    strip: (row) => {
      if (row && typeof row === 'object') delete (row as Row).id;
      return row;
    },
  };
}

function rowsOf(data: unknown): Row[] {
  if (Array.isArray(data)) return data as Row[];
  return data ? [data as Row] : [];
}

export function withWorkflowExecutionDualWrite<T extends PrismaClient>(prisma: T): T {
  const base = prisma as unknown as PrismaClient & { _createItxClient?: (tx: unknown) => Runner };
  if (typeof base._createItxClient !== 'function') {
    throw new Error('[workflow-executions] Prisma _createItxClient is unavailable; dual write cannot join transactions');
  }

  const runnerFor = (params: OperationParams): { runner: Runner; inTransaction: boolean } => {
    const tx = params.__internalParams?.transaction;
    if (tx?.kind === 'itx') return { runner: base._createItxClient!(tx), inTransaction: true };
    return { runner: base, inTransaction: false };
  };

  const run = async (
    runner: Runner,
    inTransaction: boolean,
    sql: string,
    ids: string[],
    operation: string
  ): Promise<void> => {
    if (ids.length === 0) return;
    try {
      await runner.$executeRawUnsafe(sql, ids);
    } catch (error) {
      // In a transaction, fail it so both tables roll back together.
      if (inTransaction) throw error;
      logger.error('[workflow-executions] copy to workflow schema failed; run the sync script', {
        operation,
        ids,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return prisma.$extends({
    query: {
      workflowExecution: {
        async $allOperations(params) {
          const p = params as unknown as OperationParams;
          const { operation, args, query } = p;
          const { runner, inTransaction } = runnerFor(p);
          const copy = (ids: string[]) => run(runner, inTransaction, COPY_BY_ID_SQL, ids, operation);

          switch (operation) {
            case 'create': {
              const selected = withIdSelected(args);
              const created = (await query(selected.args)) as Row;
              await copy([created.id as string]);
              return selected.strip(created);
            }
            case 'createManyAndReturn': {
              const selected = withIdSelected(args);
              const created = (await query(selected.args)) as Row[];
              await copy(created.map((row) => row.id as string));
              return created.map((row) => selected.strip(row));
            }
            case 'createMany': {
              // createMany returns only a count, so give every row its id up front.
              const data = rowsOf(args?.data).map((row) => (row.id ? row : { ...row, id: createId() }));
              const result = await query({ ...args, data });
              await copy(data.map((row) => row.id as string));
              return result;
            }
            case 'update':
            case 'upsert': {
              const id = idOf(args?.where);
              if (id) {
                const result = await query(args);
                await copy([id]);
                return result;
              }
              const selected = withIdSelected(args);
              const result = (await query(selected.args)) as Row;
              await copy([result.id as string]);
              return selected.strip(result);
            }
            case 'updateMany': {
              // Collect the matching ids first: the update may change the very columns
              // the filter matches on.
              const ids = await runner.workflowExecution.findMany({
                where: args?.where as never,
                select: { id: true },
              });
              const result = await query(args);
              await copy(ids.map((row) => row.id));
              return result;
            }
            case 'delete': {
              const id =
                idOf(args?.where) ??
                (await runner.workflowExecution.findFirst({ where: args?.where as never, select: { id: true } }))?.id;
              const result = await query(args);
              await run(runner, inTransaction, DELETE_BY_ID_SQL, id ? [id] : [], operation);
              return result;
            }
            case 'deleteMany': {
              const ids = await runner.workflowExecution.findMany({
                where: args?.where as never,
                select: { id: true },
              });
              const result = await query(args);
              await run(runner, inTransaction, DELETE_BY_ID_SQL, ids.map((row) => row.id), operation);
              return result;
            }
            default:
              return query(args);
          }
        },
      },
      workflow: {
        async $allOperations(params) {
          const p = params as unknown as OperationParams;
          const { operation, args, query } = p;
          if (operation !== 'delete' && operation !== 'deleteMany') return query(args);

          const { runner, inTransaction } = runnerFor(p);
          const workflowIds =
            operation === 'delete'
              ? [
                  idOf(args?.where) ??
                    (await runner.workflow.findFirst({ where: args?.where as never, select: { id: true } }))?.id,
                ].filter((id): id is string => typeof id === 'string')
              : (await runner.workflow.findMany({ where: args?.where as never, select: { id: true } })).map(
                  (row) => row.id
                );
          const result = await query(args);
          await run(runner, inTransaction, DELETE_BY_WORKFLOW_SQL, workflowIds, `workflow.${operation}`);
          return result;
        },
      },
    },
  }) as unknown as T;
}
