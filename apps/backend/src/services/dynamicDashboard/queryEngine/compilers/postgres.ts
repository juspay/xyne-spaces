import type { QueryPlan } from '@xyne/shared';
import { CompilerBase } from './CompilerBase';
import {
  QueryCompileError,
  type CompiledQuery,
  type JoinedTableMetadata,
  type TableMetadata,
} from './types';

export class PostgresCompiler extends CompilerBase {
  protected readonly dialect = 'pg' as const;

  private static readonly VALID_BUCKETS = new Set([
    'day',
    'week',
    'month',
    'quarter',
    'year',
  ]);

  protected quoteIdent(s: string): string {
    return '"' + s.replace(/"/g, '""') + '"';
  }

  protected bucketExpr(bucket: string, qualifiedCol: string): string {
    if (!PostgresCompiler.VALID_BUCKETS.has(bucket)) {
      throw new QueryCompileError(`Invalid time bucket "${bucket}"`);
    }
    return `date_trunc('${bucket}', ${qualifiedCol})`;
  }

  protected castToFloat(sql: string): string {
    return `(${sql})::float8`;
  }

  protected dateDiffExpr(
    unit: 'second' | 'minute' | 'hour' | 'day',
    startSql: string,
    endSql: string,
  ): string {
    const seconds = `EXTRACT(EPOCH FROM (CAST(${endSql} AS timestamptz) - CAST(${startSql} AS timestamptz)))`;
    const divisor = { second: 1, minute: 60, hour: 3600, day: 86400 }[unit];
    return divisor === 1 ? `(${seconds})` : `(${seconds} / ${divisor})`;
  }

  protected compileTextSearch(
    col: string,
    op: 'contains' | 'startsWith' | 'endsWith',
    bind: (v: unknown) => string,
    value: unknown,
  ): string {
    return `${col} ILIKE ${bind(this.buildLikePattern(op, value))} ESCAPE '\\'`;
  }

  protected notEqualsOp(): string {
    return '<>';
  }
}

export function compileQueryPlan(
  plan: QueryPlan,
  baseTable: TableMetadata,
  joinedTables: ReadonlyArray<JoinedTableMetadata> = [],
): CompiledQuery {
  return new PostgresCompiler().compile(plan, baseTable, joinedTables);
}

export {
  QueryCompileError,
  type TableMetadata,
  type JoinedTableMetadata,
  type CompiledQuery,
};
