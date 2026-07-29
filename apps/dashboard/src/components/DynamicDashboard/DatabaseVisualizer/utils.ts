import { MarkerType, type Edge, type Node } from 'reactflow';
import type {
  DataSourceColumn,
  DataSourceSchema,
} from '../../../services/DynamicDashboard/dataSourceSchemaService';

export const NODE_W = 240;
export const HEADER_H = 40;
export const ROW_H = 26;
const NODE_PAD = 8;
const MAX_BODY_H = 320;
const GAP_X = 80;
const GAP_Y = 60;

export interface TableNodeData {
  schemaName: string;
  tableName: string;
  columns: DataSourceColumn[];
  fkColumns: Set<string>;
  pkColumns: Set<string>;
  matched: boolean;
  maxBodyHeight: number;
}

function nodeId(schemaName: string, tableName: string): string {
  return `${schemaName}.${tableName}`;
}

function bodyHeight(columnCount: number): number {
  return Math.min(columnCount * ROW_H + NODE_PAD, MAX_BODY_H);
}

export function schemaToGraph(schema: DataSourceSchema): {
  nodes: Node<TableNodeData>[];
  edges: Edge[];
} {
  const tables = schema.tables ?? [];
  const rels = schema.relationships ?? [];

  const degree = new Map<string, number>();
  const fkByTable = new Map<string, Set<string>>();
  for (const r of rels) {
    const fromId = nodeId(r.fromSchema, r.fromTable);
    const toId = nodeId(r.toSchema, r.toTable);
    degree.set(fromId, (degree.get(fromId) ?? 0) + 1);
    degree.set(toId, (degree.get(toId) ?? 0) + 1);
    const set = fkByTable.get(fromId) ?? new Set<string>();
    set.add(r.fromColumn);
    fkByTable.set(fromId, set);
  }

  // Busy tables first so they cluster toward the top-left.
  const ordered = [...tables].sort(
    (a, b) =>
      (degree.get(nodeId(b.schemaName, b.tableName)) ?? 0) -
      (degree.get(nodeId(a.schemaName, a.tableName)) ?? 0),
  );

  const cols = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));
  const colY = new Array<number>(cols).fill(0); // running Y per grid column

  const nodes: Node<TableNodeData>[] = ordered.map((t, i) => {
    const col = i % cols;
    const id = nodeId(t.schemaName, t.tableName);
    const h = HEADER_H + bodyHeight(t.columns.length);
    const x = col * (NODE_W + GAP_X);
    const y = colY[col] ?? 0;
    colY[col] = y + h + GAP_Y;
    return {
      id,
      type: 'table',
      position: { x, y },
      data: {
        schemaName: t.schemaName,
        tableName: t.tableName,
        columns: t.columns,
        fkColumns: fkByTable.get(id) ?? new Set<string>(),
        pkColumns: new Set(t.columns.filter(c => c.isPrimaryKey).map(c => c.columnName)),
        matched: true,
        maxBodyHeight: MAX_BODY_H,
      },
    };
  });

  const present = new Set(nodes.map(n => n.id));
  const edges: Edge[] = [];
  for (const r of rels) {
    const source = nodeId(r.fromSchema, r.fromTable);
    const target = nodeId(r.toSchema, r.toTable);
    if (!present.has(source) || !present.has(target)) {
      continue;
    }
    edges.push({
      id: r.id,
      source,
      target,
      sourceHandle: `s:${r.fromColumn}`,
      targetHandle: `t:${r.toColumn}`,
      label: r.cardinality === 'one_to_one' ? '1–1' : '1–∞',
      markerEnd: { type: MarkerType.ArrowClosed },
    });
  }

  return { nodes, edges };
}

// Returns true when a table name matches the (already-lowercased) query.
export function tableMatches(tableName: string, lowerQuery: string): boolean {
  return lowerQuery === '' || tableName.toLowerCase().includes(lowerQuery);
}
