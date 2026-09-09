import type { AnyQuery } from '@rocicorp/zero';
import { zql } from '../queries';

/**
 * ACL grant sources are NOT registered queries. A grant instance is a plain
 * scoped-table query — `zql[table].where(scopeColumn, value)` — where `table` and
 * `scopeColumn` are derived from the ACL's whereExists correlation. It's identified
 * by a synthetic query-type name (`__grant__<table>`, its own client group, fixed
 * partition column) and built on demand: the get-queries sync branch serves it to
 * the sync principal, and queryMetaFor reads its partition column from the built AST.
 */
const GRANT_PREFIX = '__grant__';
const STRUCT_PREFIX = '__struct__';
/** Args key carrying the ordered `.related()` relationship chain of a structure instance. */
const REL_KEY = '__rel';

export function grantQueryName(table: string): string {
  return `${GRANT_PREFIX}${table}`;
}

export function isGrantQuery(name: string): boolean {
  return name.startsWith(GRANT_PREFIX);
}

/** A transitive-scope ACL chain (StructureChain) is served as ONE `.related()` instance rooted at
 *  its first hop — see aclGate.StructureChain. `__struct__<rootTable>`, its own client group. */
export function structQueryName(rootTable: string): string {
  return `${STRUCT_PREFIX}${rootTable}`;
}

export function isStructQuery(name: string): boolean {
  return name.startsWith(STRUCT_PREFIX);
}

/** Grant + structure instances are both synthetic ACL-support queries built on demand by
 *  buildGrantBase (vs registered shared bases). Used to gate the sync-service build/dispatch paths. */
export function isSyntheticQuery(name: string): boolean {
  return isGrantQuery(name) || isStructQuery(name);
}

/** Protocol args for a grant instance: the scope column bound to its value. */
export function grantArgs(scopeColumn: string, value: unknown): readonly unknown[] {
  return [{ [scopeColumn]: value }];
}

/** Protocol args for a structure instance: the root scope column bound to its value (the data
 *  partition value), plus the ordered relationship chain to nest via `.related()`. The scope column
 *  is FIRST so metaCacheKey/partition derivation read it as key[0]. */
export function structArgs(scopeColumn: string, value: unknown, relationships: readonly string[]): readonly unknown[] {
  return [{ [scopeColumn]: value, [REL_KEY]: relationships }];
}

/** Build a synthetic (grant OR structure) base query on demand, or undefined if unknown. */
export function buildGrantBase(name: string, args: unknown): AnyQuery | undefined {
  if (isStructQuery(name)) return buildStructBase(name, args);
  if (!isGrantQuery(name)) return undefined;
  const table = name.slice(GRANT_PREFIX.length);
  const entry = (Array.isArray(args) ? args[0] : args) as Record<string, unknown> | undefined;
  if (!entry) return undefined;
  const scopeColumn = Object.keys(entry)[0];
  if (!scopeColumn) return undefined;
  const builder = (zql as unknown as Record<string, { where(c: string, v: unknown): AnyQuery } | undefined>)[table];
  if (!builder) return undefined;
  return builder.where(scopeColumn, entry[scopeColumn]);
}

/** Build `zql[rootTable].where(scopeCol, val).related(rel1, q => q.related(rel2, ...))` from the
 *  encoded chain — the ACL's transitive per-scope hops as ONE joined instance. */
function buildStructBase(name: string, args: unknown): AnyQuery | undefined {
  const rootTable = name.slice(STRUCT_PREFIX.length);
  const entry = (Array.isArray(args) ? args[0] : args) as Record<string, unknown> | undefined;
  if (!entry) return undefined;
  const relationships = (entry[REL_KEY] as string[] | undefined) ?? [];
  const scopeColumn = Object.keys(entry).find((k) => k !== REL_KEY);
  if (!scopeColumn) return undefined;
  const builder = (zql as unknown as Record<string, { where(c: string, v: unknown): AnyQuery } | undefined>)[rootTable];
  if (!builder) return undefined;
  const nest = (q: AnyQuery, rels: readonly string[]): AnyQuery =>
    rels.length === 0
      ? q
      : (q as unknown as { related(r: string, cb: (sub: AnyQuery) => AnyQuery): AnyQuery }).related(
          rels[0],
          (sub) => nest(sub, rels.slice(1)),
        );
  return nest(builder.where(scopeColumn, entry[scopeColumn]), relationships);
}
