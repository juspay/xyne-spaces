import type { QueryPlan } from '@xyne/shared';
import { CompilerBase } from './CompilerBase';
import {
  QueryCompileError,
  type CompiledQuery,
  type JoinedTableMetadata,
  type TableMetadata,
} from './types';

export class ClickHouseCompiler extends CompilerBase {
  protected readonly dialect = 'ch' as const;

  private static readonly CH_BUCKET_FNS: Record<string, string> = {
    day:     'toStartOfDay',
    week:    'toMonday',
    month:   'toStartOfMonth',
    quarter: 'toStartOfQuarter',
    year:    'toStartOfYear',
  };

  protected quoteIdent(s: string): string {
    return '`' + s.replace(/`/g, '``') + '`';
  }

  protected bucketExpr(bucket: string, qualifiedCol: string): string {
    const fn = ClickHouseCompiler.CH_BUCKET_FNS[bucket];
    if (!fn) throw new QueryCompileError(`Invalid time bucket "${bucket}"`);
    return `${fn}(${qualifiedCol})`;
  }

  protected castToFloat(sql: string): string {
    return `toFloat64(${sql})`;
  }

  protected dateDiffExpr(
    unit: 'second' | 'minute' | 'hour' | 'day',
    startSql: string,
    endSql: string,
  ): string {
    return `dateDiff('${unit}', ${startSql}, ${endSql})`;
  }

  protected compileTextSearch(
    col: string,
    op: 'contains' | 'startsWith' | 'endsWith',
    bind: (v: unknown) => string,
    value: unknown,
  ): string {
    return `lower(${col}) LIKE lower(${bind(this.buildLikePattern(op, value))})`;
  }

  protected notEqualsOp(): string {
    return '!=';
  }
}

export function compileQueryPlan(
  plan: QueryPlan,
  baseTable: TableMetadata,
  joinedTables: ReadonlyArray<JoinedTableMetadata> = [],
): CompiledQuery {
  return new ClickHouseCompiler().compile(plan, baseTable, joinedTables);
}

export {
  QueryCompileError,
  type TableMetadata,
  type JoinedTableMetadata,
  type CompiledQuery,
};
