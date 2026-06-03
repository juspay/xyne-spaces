import type { AggregationOp, Measure, QueryPlan } from '@xyne/shared';
import { CompilerBase, type CompileContext } from './CompilerBase';
import {
  QueryCompileError,
  type CompiledQuery,
  type JoinedTableMetadata,
  type TableMetadata,
} from './types';

export class PostgresCompiler extends CompilerBase {
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

  protected compileAggOp(op: AggregationOp, colExpr: string): string {
    switch (op) {
      case 'count':          return `COUNT(${colExpr})`;
      case 'count_distinct': return `COUNT(DISTINCT ${colExpr})`;
      case 'sum':            return `SUM(${colExpr})`;
      case 'avg':            return `AVG(${colExpr})`;
      case 'min':            return `MIN(${colExpr})`;
      case 'max':            return `MAX(${colExpr})`;
    }
  }

  protected buildAggSql(m: Measure, colExpr: string, ctx: CompileContext): string {
    const agg = this.compileAggOp(m.op, colExpr);
    if (!m.filter) return agg;
    return `${agg} FILTER (WHERE ${this.compileWhere(m.filter, ctx)})`;
  }

  protected castAndAliasMeasure(aggSql: string, alias: string): string {
    return `(${aggSql})::float8 AS ${this.quoteIdent(alias)}`;
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
    return `${col} ILIKE ${bind(wrapped)} ESCAPE '\\'`;
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
