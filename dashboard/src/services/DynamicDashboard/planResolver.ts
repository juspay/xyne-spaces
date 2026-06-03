export interface DashboardTimeRange {
  from?: string;
  to?: string;
  relative?: RelativeRange;
}

export type RelativeRange = 'now-1h' | 'now-24h' | 'now-7d' | 'now-30d' | 'now-90d' | 'now-1y';

export interface DashboardVariableValue {
  value: string | string[] | null;
}

export interface DashboardRuntimeContext {
  timeRange?: DashboardTimeRange | null;
  variables?: Record<string, DashboardVariableValue>;
}

export interface ComponentRuntimeConfig {
  timeColumn?: string;
}

const RELATIVE_TO_MS: Record<RelativeRange, number> = {
  'now-1h': 60 * 60 * 1000,
  'now-24h': 24 * 60 * 60 * 1000,
  'now-7d': 7 * 24 * 60 * 60 * 1000,
  'now-30d': 30 * 24 * 60 * 60 * 1000,
  'now-90d': 90 * 24 * 60 * 60 * 1000,
  'now-1y': 365 * 24 * 60 * 60 * 1000,
};

export function expandTimeRange(
  tr: DashboardTimeRange,
  now: Date = new Date(),
): { from: string; to: string } | null {
  if (tr.relative) {
    const ms = RELATIVE_TO_MS[tr.relative];
    if (!ms) return null;
    return {
      from: new Date(now.getTime() - ms).toISOString(),
      to: now.toISOString(),
    };
  }
  if (tr.from && tr.to) return { from: tr.from, to: tr.to };
  return null;
}

function substituteValueTokens(v: unknown, vars: Record<string, DashboardVariableValue>): unknown {
  if (typeof v !== 'string') return v;
  const m = v.match(/^\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}$/);
  if (!m) return v;
  const name = m[1]!;
  const picked = vars[name];
  if (!picked) return null;
  return picked.value;
}

interface WhereNode {
  AND?: unknown;
  OR?: unknown;
  NOT?: unknown;
  filter?: unknown;
}

interface FilterNode {
  column?: unknown;
  op?: unknown;
  value?: unknown;
}

function resolveWhereLeaves(where: unknown, vars: Record<string, DashboardVariableValue>): unknown {
  if (!where || typeof where !== 'object') return where;
  const w = where as WhereNode;
  if (Array.isArray(w.AND)) {
    return { AND: w.AND.map(c => resolveWhereLeaves(c, vars)) };
  }
  if (Array.isArray(w.OR)) {
    return { OR: w.OR.map(c => resolveWhereLeaves(c, vars)) };
  }
  if (w.NOT !== undefined) {
    return { NOT: resolveWhereLeaves(w.NOT, vars) };
  }
  if (w.filter && typeof w.filter === 'object') {
    const f = w.filter as FilterNode;
    const substituted = substituteValueTokens(f.value, vars);
    let op = f.op as string;
    if (Array.isArray(substituted)) {
      if (op === 'equals') op = 'in';
      else if (op === 'not') op = 'notIn';
    }
    return { filter: { ...f, op, value: substituted } };
  }
  return where;
}

function dropUnboundVariableLeaves(where: unknown): unknown {
  if (!where || typeof where !== 'object') return where;
  const w = where as WhereNode;
  if (Array.isArray(w.AND)) {
    const kept = w.AND.map(c => dropUnboundVariableLeaves(c)).filter(c => c !== null);
    if (kept.length === 0) return null;
    if (kept.length === 1) return kept[0];
    return { AND: kept };
  }
  if (Array.isArray(w.OR)) {
    const kept = w.OR.map(c => dropUnboundVariableLeaves(c)).filter(c => c !== null);
    if (kept.length === 0) return null;
    return { OR: kept };
  }
  if (w.NOT !== undefined) {
    const inner = dropUnboundVariableLeaves(w.NOT);
    return inner === null ? null : { NOT: inner };
  }
  if (w.filter && typeof w.filter === 'object') {
    const f = w.filter as FilterNode;
    if ('value' in f && f.value === null) return null;
    return where;
  }
  return where;
}

function withTimeFilter(
  plan: Record<string, unknown>,
  timeColumn: string,
  expanded: { from: string; to: string },
): Record<string, unknown> {
  const timeLeaves = [
    { filter: { column: timeColumn, op: 'gte', value: expanded.from } },
    { filter: { column: timeColumn, op: 'lte', value: expanded.to } },
  ];
  const existing = plan['where'];
  let nextWhere: Record<string, unknown>;
  if (!existing) {
    nextWhere = { AND: timeLeaves };
  } else if (
    typeof existing === 'object' &&
    existing !== null &&
    Array.isArray((existing as WhereNode).AND)
  ) {
    nextWhere = {
      AND: [...(existing as { AND: unknown[] }).AND, ...timeLeaves],
    };
  } else {
    nextWhere = { AND: [existing, ...timeLeaves] };
  }
  return { ...plan, where: nextWhere };
}

export function resolvePlan(
  plan: Record<string, unknown>,
  ctx: DashboardRuntimeContext | null | undefined,
  componentConfig: ComponentRuntimeConfig | null | undefined,
): {
  plan: Record<string, unknown>;
  isModified: boolean;
} {
  if (!ctx) return { plan, isModified: false };
  let out = plan;
  let modified = false;

  if (ctx.variables && Object.keys(ctx.variables).length > 0 && out['where']) {
    const substituted = resolveWhereLeaves(out['where'], ctx.variables);
    const nextWhere = dropUnboundVariableLeaves(substituted);
    const nextWhereOrUndefined = nextWhere === null ? undefined : nextWhere;
    if (nextWhereOrUndefined !== out['where']) {
      out = { ...out, where: nextWhereOrUndefined };
      modified = true;
    }
  }

  if (ctx.timeRange && componentConfig?.timeColumn) {
    const expanded = expandTimeRange(ctx.timeRange);
    if (expanded) {
      out = withTimeFilter(out, componentConfig.timeColumn, expanded);
      modified = true;
    }
  }

  return { plan: out, isModified: modified };
}

export function relativeRangeLabel(r: RelativeRange): string {
  switch (r) {
    case 'now-1h':
      return 'Last 1 hour';
    case 'now-24h':
      return 'Last 24 hours';
    case 'now-7d':
      return 'Last 7 days';
    case 'now-30d':
      return 'Last 30 days';
    case 'now-90d':
      return 'Last 90 days';
    case 'now-1y':
      return 'Last year';
  }
}

export const RELATIVE_RANGE_OPTIONS: ReadonlyArray<RelativeRange> = [
  'now-1h',
  'now-24h',
  'now-7d',
  'now-30d',
  'now-90d',
  'now-1y',
];
