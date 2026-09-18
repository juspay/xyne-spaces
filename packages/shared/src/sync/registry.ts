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
import {
  WORKSPACE_PARTITIONED_REGISTRY,
  isWorkspacePartitioned,
  isClientServable,
  workspacePartitionedBase,
} from './workspacePartitioned.js';

/**
 * Query names served by the sync engine. Must match the backend allowlist: channelLatest (gate) PLUS
 * every CLIENT-SERVABLE workspace-partitioned query (broadcast + row-level). The client treats all of
 * them identically — host the base, render the rows it receives — so the gate/row-level/broadcast
 * distinction (which is purely how the SERVER decides what to send) never appears here. `.one()`
 * (singular) queries are filtered out until the client applies the singular projection.
 */
export const SHARED_QUERY_NAMES: ReadonlySet<string> = new Set<string>([
  'channelLatestMultipleConversationsV4',
  ...[...WORKSPACE_PARTITIONED_REGISTRY.entries()]
    .filter(([, spec]) => isClientServable(spec))
    .map(([name]) => name),
]);

export function isSharedQuery(name: string | undefined | null): boolean {
  return !!name && SHARED_QUERY_NAMES.has(name);
}

// Workspace-partitioned queries need `ctx.workspaceId` injected into their args by `useQuery` (keys the
// instance per-workspace + partitions the override base). Single-sourced from `@xyne/shared`.
export { isWorkspacePartitioned };

interface BaseDef {
  base?: (params: { ctx: Context; args?: unknown }) => { ast?: unknown } | undefined;
}

/**
 * The ACL-free base AST for a shared query — the same thing the backend materializes. Workspace-
 * partitioned queries use the single-source override base (reads `args.workspaceId`, injected from
 * `ctx.workspaceId` by `useQuery`); everything else reads the query's own `.base` (attached by
 * `defineQuery`, non-enumerable, off the raw `queryDefs` since `defineQueries` strips it).
 */
export function resolveBaseAst(name: string, ctx: Context, args: unknown): any | undefined {
  const wp = workspacePartitionedBase(name, args);
  if (wp) return (wp as { ast?: unknown }).ast;
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

let hostedTablesCache: ReadonlySet<string> | undefined;
/**
 * The tables the sync engine hosts = every table any shared query's base AST touches. A
 * mutator's optimistic writes to these are mirrored into the host, and its reads of them
 * union with the host (so data that left Zero's store still resolves). Structural, so it's
 * derived once with placeholder args.
 */
export function hostedTables(): ReadonlySet<string> {
  if (hostedTablesCache) return hostedTablesCache;
  const set = new Set<string>();
  const ctx = { userID: '', workspaceId: '', role: '', orgRole: '', memberId: '' } as unknown as Context;
  for (const name of SHARED_QUERY_NAMES) {
    try {
      const ast = resolveBaseAst(name, ctx, { channelId: '', isMember: true, limit: 1 });
      if (ast) for (const t of tablesOfAst(ast)) set.add(t);
    } catch {
      /* a base that needs real args — skip; its tables just won't get optimism */
    }
  }
  hostedTablesCache = set;
  return set;
}
