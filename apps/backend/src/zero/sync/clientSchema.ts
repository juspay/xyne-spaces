import { schema } from '@xyne/shared';

export interface ClientSchema {
  tables: Record<string, { columns: Record<string, { type: string }>; primaryKey: string[] }>;
}

type SchemaTable = { columns: Record<string, { type: string }>; primaryKey: readonly string[] };
const tables = schema.tables as unknown as Record<string, SchemaTable>;

/**
 * Build the clientSchema for exactly the tables a tapped query-instance touches.
 * Scoped (not the full schema) because it rides in the Sec-WebSocket-Protocol
 * header on connect; the full schema overflows the WS header limit (HTTP 431).
 */
export function buildClientSchema(tableNames: string[]): ClientSchema {
  const out: ClientSchema['tables'] = {};
  for (const name of tableNames) {
    const t = tables[name];
    if (!t) throw new Error(`buildClientSchema: unknown table "${name}"`);
    const columns: Record<string, { type: string }> = {};
    for (const [col, def] of Object.entries(t.columns)) columns[col] = { type: def.type };
    out[name] = { columns, primaryKey: [...t.primaryKey] };
  }
  return { tables: out };
}

/** PK fields for every table in the schema, for keying the poke stream (`table:pk`). */
export function allPkFields(): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {};
  for (const [name, t] of Object.entries(tables)) out[name] = [...t.primaryKey];
  return out;
}

interface QueryAstNode {
  table?: string;
  related?: Array<{ subquery?: QueryAstNode }>;
}

/** The set of tables a query's AST touches (root + related subqueries), for the clientSchema. */
export function tablesOfQuery(query: { ast?: QueryAstNode } | null | undefined): string[] {
  const found = new Set<string>();
  const walk = (node: QueryAstNode | undefined): void => {
    if (!node) return;
    if (node.table) found.add(node.table);
    for (const rel of node.related ?? []) walk(rel.subquery);
  };
  walk(query?.ast);
  return [...found];
}
