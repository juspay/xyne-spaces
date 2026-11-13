import type { Expr, Scope } from './types.js';

/**
 * Resolve an expression against the data scope. Identifier lookups, member / index
 * access, and calls to a fixed set of pure helper functions (below) — no arbitrary
 * evaluation, no data method calls, no mutation. A template can transform data it
 * reads but can never run code. Missing paths resolve to `undefined` (never throw).
 */
export function evaluate(expr: Expr, scope: Scope): unknown {
  switch (expr.kind) {
    case 'lit':
      return expr.value;
    case 'ident':
      return scope[expr.name];
    case 'member': {
      const obj = evaluate(expr.obj, scope);
      return access(obj, expr.prop);
    }
    case 'index': {
      const obj = evaluate(expr.obj, scope);
      const idx = evaluate(expr.index, scope);
      return access(obj, idx);
    }
    case 'call': {
      const fn = FUNCTIONS[expr.name];
      if (!fn) return undefined;
      return fn(expr.args.map((a) => evaluate(a, scope)));
    }
  }
}

function access(obj: unknown, key: unknown): unknown {
  if (obj == null) return undefined;
  if (typeof obj !== 'object' && typeof obj !== 'string') return undefined;
  const k = typeof key === 'number' ? key : String(key);
  return (obj as Record<PropertyKey, unknown>)[k as PropertyKey];
}

// ─── Whitelisted pure helpers a template may call (no I/O, no mutation) ───

const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asStr = (v: unknown): string => (v == null ? '' : String(v));

const FUNCTIONS: Record<string, (args: unknown[]) => unknown> = {
  split: ([s, sep]) => (typeof s === 'string' ? s.split(asStr(sep)) : []),
  first: ([a]) => asArr(a)[0],
  last: ([a]) => { const arr = asArr(a); return arr[arr.length - 1]; },
  at: ([a, i]) => access(a, i),
  join: ([a, sep]) => asArr(a).map(asStr).join(sep == null ? ', ' : asStr(sep)),
  upper: ([s]) => asStr(s).toUpperCase(),
  lower: ([s]) => asStr(s).toLowerCase(),
  trim: ([s]) => asStr(s).trim(),
  len: ([a]) => (Array.isArray(a) || typeof a === 'string' ? a.length : a && typeof a === 'object' ? Object.keys(a).length : 0),
  keys: ([o]) => (o && typeof o === 'object' ? Object.keys(o) : []),
  values: ([o]) => (o && typeof o === 'object' ? Object.values(o as Record<string, unknown>) : []),
  pick: ([o, ...ks]) => {
    if (!o || typeof o !== 'object') return {};
    const src = o as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of ks) { const key = asStr(k); if (key in src) out[key] = src[key]; }
    return out;
  },
};
