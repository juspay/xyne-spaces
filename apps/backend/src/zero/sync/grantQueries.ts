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

export function grantQueryName(table: string): string {
  return `${GRANT_PREFIX}${table}`;
}

export function isGrantQuery(name: string): boolean {
  return name.startsWith(GRANT_PREFIX);
}

/** Protocol args for a grant instance: the scope column bound to its value. */
export function grantArgs(scopeColumn: string, value: unknown): readonly unknown[] {
  return [{ [scopeColumn]: value }];
}

/** Build a grant source's base query on demand, or undefined if not a grant / unknown table. */
export function buildGrantBase(name: string, args: unknown): AnyQuery | undefined {
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
