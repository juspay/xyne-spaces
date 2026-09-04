/**
 * Which queries are served by the shared-base sync engine (vs. materialized per-user
 * by Zero), plus the helpers to derive a query's ACL-free base AST and the ArrayView
 * Format for its nested relationships. The allowlist mirrors the backend's
 * `SHARED_BASE_QUERIES`; a query is shared on the client iff it is shared on the server.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { queryDefs } from '../zero/queries.js';
import type { Context } from '../zero/schema.js';
import type { Format } from './ivmHost.js';

/** Query names served by the sync engine. Must match the backend allowlist. */
export const SHARED_QUERY_NAMES: ReadonlySet<string> = new Set<string>([
  'channelLatestMultipleConversationsV4',
]);

export function isSharedQuery(name: string | undefined | null): boolean {
  return !!name && SHARED_QUERY_NAMES.has(name);
}

interface BaseDef {
  base?: (params: { ctx: Context; args?: unknown }) => { ast?: unknown } | undefined;
}

/**
 * The ACL-free base AST for a shared query — the same thing the backend materializes.
 * `.base` is attached by `defineQuery` (non-enumerable) and read from the raw `queryDefs`,
 * because `defineQueries` strips it from the built `queries` object.
 */
export function resolveBaseAst(name: string, ctx: Context, args: unknown): any | undefined {
  const def = (queryDefs as unknown as Record<string, BaseDef>)[name];
  const ast = def?.base?.({ ctx, args })?.ast;
  return ast;
}

/** Derive the ArrayView Format (nested-relationship shape) from a base AST. */
export function astToFormat(ast: any): Format {
  const relationships: Record<string, Format> = {};
  for (const rel of (ast?.related ?? []) as any[]) {
    const alias: string | undefined = rel?.subquery?.alias;
    if (alias) relationships[alias] = astToFormat(rel.subquery);
  }
  return { singular: false, relationships };
}

/** All tables a base AST touches (root + related), for provisioning sources. */
export function tablesOfAst(ast: any): string[] {
  const found = new Set<string>();
  const walk = (node: any): void => {
    if (!node) return;
    if (typeof node.table === 'string') found.add(node.table);
    for (const rel of (node.related ?? []) as any[]) walk(rel?.subquery);
  };
  walk(ast);
  return [...found];
}
