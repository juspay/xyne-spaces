import { resolveSharedBase } from './baseQueries';
import { syncContext } from './serviceIdentity';
import { tablesOfQuery } from './clientSchema';
import { isGrantQuery, buildGrantBase } from './grantQueries';

/**
 * Packing metadata for a query-type, derived once (in-memory, no DB) from its base
 * AST and cached. Instances of the same query-type are mutually disjoint
 * (partitioned by `partitionColumn`), so they share a client group; this is how the
 * connection demuxes a poke's rows back to individual instances:
 *   - root rows carry `partitionColumn` (e.g. channelId) → the owning instance;
 *   - related rows carry a child-FK (`childColumn`) that maps to a root row's
 *     `parentColumn` → the same instance (hops resolved here, not per-row).
 */
export interface ChildLink {
  childTable: string;
  childColumn: string;
  parentColumn: string;
}

export interface QueryMeta {
  rootTable: string;
  /** Column on the root table whose equality filter distinguishes instances. */
  partitionColumn: string;
  /** All tables the query emits (root + related) — for the client group's clientSchema. */
  tables: string[];
  childLinks: ChildLink[];
}

interface WhereNode {
  type?: string;
  left?: { name?: string };
  op?: string;
  right?: { type?: string };
  conditions?: WhereNode[];
}

/** The single root column bound by equality in the query's `where` (the partition key). */
function partitionColumnOf(where: WhereNode | undefined): string | undefined {
  if (!where) return undefined;
  if (where.type === 'simple' && where.op === '=' && where.right?.type === 'literal' && where.left?.name) {
    return where.left.name;
  }
  for (const child of where.conditions ?? []) {
    const col = partitionColumnOf(child);
    if (col) return col;
  }
  return undefined;
}

const cache = new Map<string, QueryMeta>();

/** Derive (and cache) a query-type's packing metadata from a sample of its args. */
export function queryMetaFor(queryName: string, sampleArgs: unknown): QueryMeta | undefined {
  const cached = cache.get(queryName);
  if (cached) return cached;

  const base = isGrantQuery(queryName)
    ? buildGrantBase(queryName, sampleArgs)
    : resolveSharedBase(queryName, syncContext(), sampleArgs);
  const ast = (base as {
    ast?: {
      table?: string;
      where?: WhereNode;
      related?: Array<{
        subquery?: { table?: string };
        correlation?: { parentField: string[]; childField: string[] };
      }>;
    };
  } | undefined)?.ast;
  if (!ast?.table) return undefined;

  const partitionColumn = partitionColumnOf(ast.where);
  if (!partitionColumn) return undefined;

  const childLinks: ChildLink[] = (ast.related ?? [])
    .filter((r) => r.subquery?.table && r.correlation)
    .map((r) => ({
      childTable: r.subquery!.table as string,
      childColumn: r.correlation!.childField[0],
      parentColumn: r.correlation!.parentField[0],
    }));

  const meta: QueryMeta = {
    rootTable: ast.table,
    partitionColumn,
    tables: tablesOfQuery(base as { ast?: { table?: string } }),
    childLinks,
  };
  cache.set(queryName, meta);
  return meta;
}
