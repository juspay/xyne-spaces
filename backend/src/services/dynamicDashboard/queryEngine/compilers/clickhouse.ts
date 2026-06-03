import type { AggregationOp, Measure, QueryPlan } from '@xyne/shared';
import { CompilerBase, type CompileContext } from './CompilerBase';
import {
  QueryCompileError,
  type CompiledQuery,
  type JoinedTableMetadata,
  type TableMetadata,
} from './types';

export class ClickHouseCompiler extends CompilerBase {
  private static readonly CH_BUCKET_FNS: Record<string, string> = {
    day:     'toStartOfDay',
    week:    'toMonday',      // ISO week: Monday
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

  protected compileAggOp(op: AggregationOp, colExpr: string): string {
    switch (op) {
      case 'count':          return `count(${colExpr})`;
      case 'count_distinct': return `uniqExact(${colExpr})`;
      case 'sum':            return `sum(${colExpr})`;
      case 'avg':            return `avg(${colExpr})`;
      case 'min':            return `min(${colExpr})`;
      case 'max':            return `max(${colExpr})`;
    }
  }

  private compileFilteredAggOp(
    op: AggregationOp,
    colExpr: string,
    condSql: string,
  ): string {
    switch (op) {
      case 'count':          return `countIf(${condSql})`;
      case 'count_distinct': return `uniqExactIf(${colExpr}, ${condSql})`;
      case 'sum':            return `sumIf(${colExpr}, ${condSql})`;
      case 'avg':            return `avgIf(${colExpr}, ${condSql})`;
      case 'min':            return `minIf(${colExpr}, ${condSql})`;
      case 'max':            return `maxIf(${colExpr}, ${condSql})`;
    }
  }

  protected buildAggSql(m: Measure, colExpr: string, ctx: CompileContext): string {
    if (m.filter) {
      return this.compileFilteredAggOp(
        m.op,
        colExpr,
        this.compileWhere(m.filter, ctx),
      );
    }
    return this.compileAggOp(m.op, colExpr);
  }

  protected castAndAliasMeasure(aggSql: string, alias: string): string {
    return `toFloat64(${aggSql}) AS ${this.quoteIdent(alias)}`;
  }

  protected compileTextSearch(
    col: string,
    op: 'contains' | 'startsWith' | 'endsWith',
    bind: (v: unknown) => string,
    value: unknown,
  ): string {
    const pattern = this.escapeLikePattern(value);
    const wrapped =
      op === 'contains' ? `%${pattern}%` :
      op === 'startsWith' ? `${pattern}%` :
      `%${pattern}`;
    return `lower(${col}) LIKE lower(${bind(wrapped)})`;
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
