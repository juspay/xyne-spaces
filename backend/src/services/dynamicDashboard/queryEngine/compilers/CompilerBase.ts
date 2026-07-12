import type {
  QueryPlan,
  Join,
  WhereClause,
  ColumnFilter,
  Measure,
  Expr,
  AggregationOp,
  ColumnRef,
} from '@xyne/shared';
import { normalizeColumnRef, normalizeMeasure } from '@xyne/shared';
import { AGGREGATES, fillTemplate, NUMERIC_AGG_OPS } from './aggregates';
import {
  QueryCompileError,
  type TableMetadata,
  type JoinedTableMetadata,
  type CompiledQuery,
} from './types';

interface ResolvedColumn {
  alias: string;
  columnName: string;
  dataTypeCanonical: string;
}

interface CompileContext {
  resolve: (raw: string, ctx: string) => ResolvedColumn;
  qualify: (raw: string, ctx: string) => string;
  baseAlias: string;
  outputAliases: Set<string>;
  params: unknown[];
}

export abstract class CompilerBase {
  protected readonly NUMERIC_TYPES = new Set(['numeric']);
  protected readonly TEMPORAL_TYPES = new Set(['temporal']);
  protected readonly MAX_WHERE_DEPTH = 50;
  protected readonly MAX_EXPR_DEPTH = 50;
  protected readonly MAX_BIND_PARAMS = 60_000;

  protected abstract readonly dialect: 'pg' | 'ch';
  protected abstract quoteIdent(s: string): string;
  protected abstract bucketExpr(bucket: string, qualifiedCol: string): string;
  protected abstract castToFloat(sql: string): string;
  protected abstract dateDiffExpr(
    unit: 'second' | 'minute' | 'hour' | 'day',
    startSql: string,
    endSql: string,
  ): string;
  protected abstract compileTextSearch(
    col: string,
    op: 'contains' | 'startsWith' | 'endsWith',
    bind: (v: unknown) => string,
    value: unknown,
  ): string;
  protected abstract notEqualsOp(): string;

  protected castAndAliasMeasure(aggSql: string, alias: string): string {
    return `${this.castToFloat(aggSql)} AS ${this.quoteIdent(alias)}`;
  }

  protected buildLikePattern(
    op: 'contains' | 'startsWith' | 'endsWith',
    value: unknown,
  ): string {
    const pattern = this.escapeLikePattern(value);
    return op === 'contains' ? `%${pattern}%` : op === 'startsWith' ? `${pattern}%` : `%${pattern}`;
  }


  protected buildAggSql(
    op: AggregationOp,
    argSql: string,
    filter: WhereClause | undefined,
    ctx: CompileContext,
  ): string {
    const spec = AGGREGATES[op];
    if (this.dialect === 'ch') {
      return filter
        ? fillTemplate(spec.chIf, { x: argSql, cond: this.compileWhere(filter, ctx), p: spec.p })
        : fillTemplate(spec.ch, { x: argSql, p: spec.p });
    }
    const plain = fillTemplate(spec.pg, { x: argSql, p: spec.p });
    return filter ? `${plain} FILTER (WHERE ${this.compileWhere(filter, ctx)})` : plain;
  }

  compile(
    plan: QueryPlan,
    baseTable: TableMetadata,
    joinedTables: ReadonlyArray<JoinedTableMetadata> = [],
  ): CompiledQuery {
    this.validatePlan(plan, baseTable, joinedTables);
    const { resolve, qualify, baseAlias } = this.buildResolver(
      baseTable,
      joinedTables,
    );
    const outputAliases = this.collectOutputAliases(plan);
    const params: unknown[] = [];
    const ctx: CompileContext = {
      resolve,
      qualify,
      baseAlias,
      outputAliases,
      params,
    };

    const selectExprs = this.compileSelect(plan, baseTable, ctx);
    const fromClause = `${this.quoteIdent(baseTable.schemaName)}.${this.quoteIdent(
      baseTable.tableName,
    )} AS ${this.quoteIdent(baseAlias)}`;
    const joinClauses = this.compileJoins(plan, joinedTables, ctx);
    const whereSql = plan.where ? this.compileWhere(plan.where, ctx) : null;
    const groupBySql = this.compileGroupBy(plan, ctx);
    const orderBySql = this.compileOrderBy(plan, ctx);
    const limitClauses = this.compileLimit(plan, ctx);

    const sql = [
      `SELECT ${selectExprs.join(', ')}`,
      `FROM ${fromClause}`,
      joinClauses.length > 0 ? joinClauses.join('\n') : null,
      whereSql ? `WHERE ${whereSql}` : null,
      groupBySql,
      orderBySql,
      limitClauses.length > 0 ? limitClauses.join(' ') : null,
    ]
      .filter(Boolean)
      .join('\n');

    return { sql, params };
  }

  protected validatePlan(
    plan: QueryPlan,
    baseTable: TableMetadata,
    joinedTables: ReadonlyArray<JoinedTableMetadata>,
  ): void {
    if (plan.model !== baseTable.tableName) {
      throw new QueryCompileError(
        `Plan model "${plan.model}" does not match table "${baseTable.tableName}"`,
      );
    }
    const planJoinCount = plan.joins?.length ?? 0;
    if (joinedTables.length !== planJoinCount) {
      throw new QueryCompileError(
        `Joined-table metadata count ${joinedTables.length} does not match plan.joins length ${planJoinCount}`,
      );
    }
    if (plan.select && plan.select.length > 0 && (plan.measures?.length ?? 0) > 0) {
      throw new QueryCompileError('select and measures are mutually exclusive');
    }
    if (plan.groupBy && plan.groupBy.length > 0 && (plan.measures?.length ?? 0) === 0) {
      throw new QueryCompileError('groupBy requires at least one measure');
    }
  }

  protected buildResolver(
    base: TableMetadata,
    joined: ReadonlyArray<JoinedTableMetadata>,
  ): {
    resolve: (raw: string, ctx: string) => ResolvedColumn;
    qualify: (raw: string, ctx: string) => string;
    baseAlias: string;
  } {
    const baseAlias = base.tableName;
    const aliases: Array<{ alias: string; meta: TableMetadata }> = [
      { alias: baseAlias, meta: base },
      ...joined.map((j) => ({ alias: j.alias, meta: j })),
    ];

    const seen = new Set<string>();
    for (const a of aliases) {
      if (seen.has(a.alias)) {
        throw new QueryCompileError(
          `Duplicate alias "${a.alias}" in plan (use an explicit join.alias to disambiguate)`,
        );
      }
      seen.add(a.alias);
    }

    const aliasesByColumn = new Map<string, string[]>();
    for (const { alias, meta } of aliases) {
      for (const c of meta.columns) {
        const list = aliasesByColumn.get(c.columnName);
        if (list) list.push(alias);
        else aliasesByColumn.set(c.columnName, [alias]);
      }
    }

    const columnsByAlias = new Map(
      aliases.map((a) => [
        a.alias,
        new Map(a.meta.columns.map((c) => [c.columnName, c])),
      ]),
    );

    const quoteIdent = this.quoteIdent.bind(this);

    function resolve(raw: string, ctx: string): ResolvedColumn {
      if (raw === '*') {
        throw new QueryCompileError(`'*' is not a column reference (used in ${ctx})`);
      }
      const dotIdx = raw.indexOf('.');
      if (dotIdx >= 0) {
        const a = raw.slice(0, dotIdx);
        const c = raw.slice(dotIdx + 1);
        const cols = columnsByAlias.get(a);
        if (!cols) {
          throw new QueryCompileError(
            `Unknown table/alias "${a}" in ${ctx} (column reference "${raw}")`,
          );
        }
        const meta = cols.get(c);
        if (!meta) {
          throw new QueryCompileError(`Column "${c}" not on "${a}" in ${ctx}`);
        }
        return { alias: a, columnName: c, dataTypeCanonical: meta.dataTypeCanonical };
      }
      const hits = aliasesByColumn.get(raw) ?? [];
      if (hits.length === 0) {
        throw new QueryCompileError(`Unknown column "${raw}" referenced in ${ctx}`);
      }
      if (hits.length > 1) {
        throw new QueryCompileError(
          `Ambiguous column "${raw}" in ${ctx} (present on ${hits.join(', ')}); qualify it as "<table>.${raw}"`,
        );
      }
      const alias = hits[0]!;
      const meta = columnsByAlias.get(alias)!.get(raw)!;
      return { alias, columnName: raw, dataTypeCanonical: meta.dataTypeCanonical };
    }

    function qualify(raw: string, ctx: string): string {
      const r = resolve(raw, ctx);
      return `${quoteIdent(r.alias)}.${quoteIdent(r.columnName)}`;
    }

    return { resolve, qualify, baseAlias };
  }

  protected collectOutputAliases(plan: QueryPlan): Set<string> {
    const out = new Set<string>();
    for (const c of plan.select ?? []) {
      const n = normalizeColumnRef(c);
      out.add(n.alias ?? n.column.replace(/^.*\./, ''));
    }
    for (const c of plan.groupBy ?? []) {
      const n = normalizeColumnRef(c);
      out.add(n.alias ?? n.column.replace(/^.*\./, ''));
    }
    for (const m of plan.measures ?? []) {
      if ('expr' in m) { out.add(m.alias); continue; }
      out.add(m.alias ?? `${m.op}_${m.column === '*' ? 'all' : m.column.replace(/^.*\./, '')}`);
    }
    return out;
  }

  protected compileSelect(
    plan: QueryPlan,
    baseTable: TableMetadata,
    ctx: CompileContext,
  ): string[] {
    const exprs: string[] = [];
    if (plan.measures && plan.measures.length > 0) {
      for (const gb of plan.groupBy ?? []) {
        exprs.push(this.compileColumnRef(gb, 'groupBy', ctx));
      }
      for (const m of plan.measures) {
        exprs.push(this.compileMeasure(m, ctx));
      }
    } else if (plan.select && plan.select.length > 0) {
      for (const c of plan.select) {
        exprs.push(this.compileColumnRef(c, 'select', ctx));
      }
    } else {
      for (const c of baseTable.columns) {
        exprs.push(
          `${this.quoteIdent(ctx.baseAlias)}.${this.quoteIdent(c.columnName)} AS ${this.quoteIdent(c.columnName)}`,
        );
      }
    }
    return exprs;
  }

  protected compileJoins(
    plan: QueryPlan,
    joinedTables: ReadonlyArray<JoinedTableMetadata>,
    ctx: CompileContext,
  ): string[] {
    const clauses: string[] = [];
    for (let i = 0; i < (plan.joins?.length ?? 0); i++) {
      const join = plan.joins![i]!;
      const meta = joinedTables[i];
      if (!meta) {
        throw new QueryCompileError(
          `Missing joined-table metadata for index ${i} (model="${join.model}")`,
        );
      }
      const fromSql = ctx.qualify(join.on.from, `joins[${i}].on.from`);
      const toCol = this.qualifyOnJoinTarget(join, meta);
      const joinKw = join.type === 'left' ? 'LEFT JOIN' : 'INNER JOIN';
      clauses.push(
        `${joinKw} ${this.quoteIdent(meta.schemaName)}.${this.quoteIdent(meta.tableName)} AS ${this.quoteIdent(meta.alias)} ON ${fromSql} = ${toCol}`,
      );
    }
    return clauses;
  }

  protected qualifyOnJoinTarget(join: Join, meta: JoinedTableMetadata): string {
    const dotIdx = join.on.to.indexOf('.');
    let colName: string;
    if (dotIdx >= 0) {
      const a = join.on.to.slice(0, dotIdx);
      if (a !== meta.alias && a !== meta.tableName) {
        throw new QueryCompileError(
          `join.on.to "${join.on.to}" must reference the joined table ("${meta.alias}")`,
        );
      }
      colName = join.on.to.slice(dotIdx + 1);
    } else {
      colName = join.on.to;
    }
    if (!meta.columns.some((c) => c.columnName === colName)) {
      throw new QueryCompileError(
        `join.on.to column "${colName}" not present on "${meta.alias}"`,
      );
    }
    return `${this.quoteIdent(meta.alias)}.${this.quoteIdent(colName)}`;
  }

  protected compileColumnRef(
    ref: ColumnRef,
    context: 'select' | 'groupBy',
    ctx: CompileContext,
  ): string {
    const norm = normalizeColumnRef(ref);
    if (norm.bucket && context === 'select') {
      throw new QueryCompileError(`'bucket' is only valid on groupBy entries`);
    }
    const baseExpr = ctx.qualify(norm.column, context);
    const aliasName = norm.alias ?? norm.column.replace(/^.*\./, '');
    if (norm.bucket) {
      const r = ctx.resolve(norm.column, context);
      if (!this.TEMPORAL_TYPES.has(r.dataTypeCanonical)) {
        throw new QueryCompileError(
          `bucket modifier requires a temporal column; "${norm.column}" is ${r.dataTypeCanonical}`,
        );
      }
      return `${this.bucketExpr(norm.bucket, baseExpr)} AS ${this.quoteIdent(aliasName)}`;
    }
    return `${baseExpr} AS ${this.quoteIdent(aliasName)}`;
  }

  protected compileMeasure(m: Measure, ctx: CompileContext): string {
    const { alias, expr } = normalizeMeasure(m);
    if (!CompilerBase.exprHasAgg(expr)) {
      throw new QueryCompileError('a measure must contain an aggregate');
    }
    return this.castAndAliasMeasure(this.compileExpr(expr, ctx, false, false, 0), alias);
  }

  /** True if an expression contains at least one aggregate node. */
  private static exprHasAgg(node: Expr): boolean {
    if ('agg' in node) return true;
    if ('op' in node) {
      if (node.op === 'date_diff') return false;
      return CompilerBase.exprHasAgg(node.left) || CompilerBase.exprHasAgg(node.right);
    }
    return false;
  }

  protected compileExpr(
    node: Expr,
    ctx: CompileContext,
    insideAgg: boolean,
    numeric: boolean,
    depth = 0,
  ): string {
    if (depth > this.MAX_EXPR_DEPTH) {
      throw new QueryCompileError(
        `Measure expression exceeds maximum nesting depth (${this.MAX_EXPR_DEPTH})`,
      );
    }

    if ('agg' in node) {
      if (insideAgg) {
        throw new QueryCompileError('cannot nest aggregates (e.g. sum(avg(x)))');
      }
      const op = node.agg;
      let sql: string;
      if (op === 'count' || op === 'count_distinct') {
        if (!('column' in node.arg)) {
          throw new QueryCompileError(`${op} requires a plain column (or '*') argument`);
        }
        const colExpr =
          node.arg.column === '*' ? '*' : ctx.qualify(node.arg.column, 'measures');
        sql = this.buildAggSql(op, colExpr, node.filter, ctx);
      } else {
        const argSql = this.compileExpr(
          node.arg,
          ctx,
          true,
          NUMERIC_AGG_OPS.has(op),
          depth + 1,
        );
        sql = this.buildAggSql(op, argSql, node.filter, ctx);
      }
      return numeric ? this.castToFloat(sql) : sql;
    }

    if ('const' in node) {
      return insideAgg ? `(${String(node.const)})` : this.castToFloat(String(node.const));
    }

    if ('column' in node) {
      if (!insideAgg) {
        throw new QueryCompileError(
          'a measure must aggregate its columns; a bare column is not a measure',
        );
      }
      if (numeric) {
        const r = ctx.resolve(node.column, 'measures.expr');
        if (!this.NUMERIC_TYPES.has(r.dataTypeCanonical)) {
          throw new QueryCompileError(
            `Row expression operand "${node.column}" must be numeric; got ${r.dataTypeCanonical}` +
              ` (for temporal columns use the date_diff operator)`,
          );
        }
      }
      return ctx.qualify(node.column, 'measures.expr');
    }

    if (node.op === 'date_diff') {
      if (!insideAgg) {
        throw new QueryCompileError(
          'a measure must aggregate its columns; date_diff must be inside an aggregate',
        );
      }
      for (const ref of [node.start.column, node.end.column]) {
        const r = ctx.resolve(ref, 'measures.expr.date_diff');
        if (!this.TEMPORAL_TYPES.has(r.dataTypeCanonical)) {
          throw new QueryCompileError(
            `date_diff requires temporal columns; "${ref}" is ${r.dataTypeCanonical}`,
          );
        }
      }
      return this.dateDiffExpr(
        node.unit,
        ctx.qualify(node.start.column, 'measures.expr.date_diff'),
        ctx.qualify(node.end.column, 'measures.expr.date_diff'),
      );
    }

    // arithmetic: operands must be numeric (columns checked, aggregates cast)
    const L = this.compileExpr(node.left, ctx, insideAgg, true, depth + 1);
    const R = this.compileExpr(node.right, ctx, insideAgg, true, depth + 1);
    if (node.op === '/') return `(${L} / NULLIF(${R}, 0))`;
    return `(${L} ${node.op} ${R})`;
  }

  protected compileGroupBy(plan: QueryPlan, ctx: CompileContext): string | null {
    if (!plan.groupBy || plan.groupBy.length === 0) return null;
    return `GROUP BY ${plan.groupBy
      .map((g) => {
        const n = normalizeColumnRef(g);
        const q = ctx.qualify(n.column, 'groupBy');
        return n.bucket ? this.bucketExpr(n.bucket, q) : q;
      })
      .join(', ')}`;
  }

  protected compileOrderBy(plan: QueryPlan, ctx: CompileContext): string | null {
    if (!plan.orderBy || plan.orderBy.length === 0) return null;
    return `ORDER BY ${plan.orderBy
      .map((o) => {
        if (o.dir !== 'asc' && o.dir !== 'desc') {
          throw new QueryCompileError(
            `Invalid orderBy direction "${o.dir}" (expected 'asc' or 'desc')`,
          );
        }
        const dir = o.dir.toUpperCase();
        if (ctx.outputAliases.has(o.column)) {
          return `${this.quoteIdent(o.column)} ${dir}`;
        }
        const q = ctx.qualify(o.column, 'orderBy');
        return `${q} ${dir}`;
      })
      .join(', ')}`;
  }

  protected compileLimit(plan: QueryPlan, ctx: CompileContext): string[] {
    const clauses: string[] = [];
    if (plan.take !== undefined) {
      ctx.params.push(plan.take);
      clauses.push(`LIMIT $${ctx.params.length}`);
    }
    if (plan.skip !== undefined) {
      ctx.params.push(plan.skip);
      clauses.push(`OFFSET $${ctx.params.length}`);
    }
    return clauses;
  }

  protected compileWhere(
    w: WhereClause,
    ctx: CompileContext,
    depth = 0,
  ): string {
    if (depth > this.MAX_WHERE_DEPTH) {
      throw new QueryCompileError(
        `WhereClause exceeds maximum nesting depth (${this.MAX_WHERE_DEPTH})`,
      );
    }
    if (w.AND && w.AND.length > 0) {
      return `(${w.AND.map((s) => this.compileWhere(s, ctx, depth + 1)).join(' AND ')})`;
    }
    if (w.OR && w.OR.length > 0) {
      return `(${w.OR.map((s) => this.compileWhere(s, ctx, depth + 1)).join(' OR ')})`;
    }
    if (w.NOT) {
      return `(NOT ${this.compileWhere(w.NOT, ctx, depth + 1)})`;
    }
    if (w.filter) {
      return this.compileColumnFilter(w.filter, ctx);
    }
    throw new QueryCompileError('Empty WhereClause');
  }

  protected escapeLikePattern(v: unknown): string {
    return String(v).replace(/[\\%_]/g, '\\$&');
  }

  protected compileColumnFilter(
    f: ColumnFilter,
    ctx: CompileContext,
  ): string {
    const col = ctx.qualify(f.column, 'where');
    const bind = (v: unknown): string => {
      if (ctx.params.length >= this.MAX_BIND_PARAMS) {
        throw new QueryCompileError(
          `Query exceeds maximum bind-parameter count (${this.MAX_BIND_PARAMS}). Reduce 'in'/'notIn' array size or split the query.`,
        );
      }
      ctx.params.push(v);
      return `$${ctx.params.length}`;
    };

    switch (f.op) {
      case 'equals':
        return `${col} = ${bind(f.value)}`;
      case 'not':
        return `${col} ${this.notEqualsOp()} ${bind(f.value)}`;
      case 'gt':
        return `${col} > ${bind(f.value)}`;
      case 'gte':
        return `${col} >= ${bind(f.value)}`;
      case 'lt':
        return `${col} < ${bind(f.value)}`;
      case 'lte':
        return `${col} <= ${bind(f.value)}`;
      case 'contains':
      case 'startsWith':
      case 'endsWith':
        return this.compileTextSearch(col, f.op, bind, f.value);
      case 'in': {
        if (!Array.isArray(f.value) || f.value.length === 0) {
          throw new QueryCompileError(
            `Filter "in" requires non-empty array for column ${f.column}`,
          );
        }
        const placeholders = f.value.map((v) => bind(v)).join(', ');
        return `${col} IN (${placeholders})`;
      }
      case 'notIn': {
        if (!Array.isArray(f.value) || f.value.length === 0) {
          throw new QueryCompileError(
            `Filter "notIn" requires non-empty array for column ${f.column}`,
          );
        }
        const placeholders = f.value.map((v) => bind(v)).join(', ');
        return `${col} NOT IN (${placeholders})`;
      }
      case 'isNull':
        return `${col} IS NULL`;
      case 'notNull':
        return `${col} IS NOT NULL`;
    }
  }
}

export type { CompileContext };
