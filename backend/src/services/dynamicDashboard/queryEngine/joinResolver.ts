
import type { QueryPlan, Join } from '@xyne/shared';
import type {
  DataSourceTable,
  DataSourceColumn,
  DataSourceRelationship,
} from '@/types/database';
import { repositories } from '@/database/repositories';
import {
  type TableMetadata,
  type JoinedTableMetadata,
} from './compilers/types';

export class JoinResolutionError extends Error {
  constructor(
    message: string,
    public readonly kind: 'invalid_plan' | 'not_found',
  ) {
    super(message);
    this.name = 'JoinResolutionError';
  }
}

interface AliasContext {
  alias: string;
  tableId: string;
  columns: ReadonlyArray<DataSourceColumn>;
}

export interface JoinResolveInput {
  plan: QueryPlan;
  targetTable: DataSourceTable;
  baseColumns: ReadonlyArray<DataSourceColumn>;
  tables: ReadonlyArray<DataSourceTable>;
  sourceType: string;
}

export async function resolveJoinedTablesMetadata(
  input: JoinResolveInput,
): Promise<JoinedTableMetadata[]> {
  const { plan, targetTable, baseColumns, tables, sourceType } = input;
  if (!plan.joins || plan.joins.length === 0) return [];

  const enforceFkEdges = sourceType !== 'clickhouse';
  const relationships = enforceFkEdges
    ? await repositories.dataSourceRelationships.findByDataSource(targetTable.dataSourceId)
    : [];
  const fkEdges = buildFkEdgeIndex(relationships);

  const allColumns = await repositories.dataSourceColumns.findByTableIds(
    tables.map(t => t.id),
  );
  const columnsByTableId = new Map<string, DataSourceColumn[]>();
  for (const col of allColumns) {
    const list = columnsByTableId.get(col.tableId) ?? [];
    list.push(col);
    columnsByTableId.set(col.tableId, list);
  }

  const tableByKey = new Map(tables.map(t => [`${t.schemaName}.${t.tableName}`, t]));
  const findTable = (
    joinModel: string,
    joinSchema: string | undefined,
  ): DataSourceTable | null => {
    const schema = joinSchema ?? targetTable.schemaName;
    return tableByKey.get(`${schema}.${joinModel}`) ?? null;
  };

  const aliasStack: AliasContext[] = [
    { alias: targetTable.tableName, tableId: targetTable.id, columns: baseColumns },
  ];

  const out: JoinedTableMetadata[] = [];
  for (const join of plan.joins) {
    const joinedTable = findTable(join.model, join.schema);
    if (!joinedTable) {
      throw new JoinResolutionError(
        `Join target table "${join.schema ? `${join.schema}.` : ''}${join.model}" not introspected on data source ${targetTable.dataSourceId}.`,
        'not_found',
      );
    }
    const joinedColumns = columnsByTableId.get(joinedTable.id) ?? [];
    const alias = join.alias ?? joinedTable.tableName;

    const fromColumnId = resolveOnFromColumnId(join, aliasStack);
    const toColumnId = resolveOnToColumnId(join, joinedColumns, alias);

    if (enforceFkEdges && !fkEdges.has(edgeKey(fromColumnId, toColumnId))) {
      throw new JoinResolutionError(
        `Join between ${join.on.from} and ${alias}.${stripTablePrefix(join.on.to)} is not backed by an introspected FK relationship`,
        'invalid_plan',
      );
    }

    out.push({
      alias,
      schemaName: joinedTable.schemaName,
      tableName: joinedTable.tableName,
      columns: joinedColumns.map(c => ({
        columnName: c.columnName,
        dataTypeCanonical: c.dataTypeCanonical,
      })),
    });
    aliasStack.push({ alias, tableId: joinedTable.id, columns: joinedColumns });
  }

  return out;
}

function buildFkEdgeIndex(
  relationships: ReadonlyArray<DataSourceRelationship>,
): Set<string> {
  const out = new Set<string>();
  for (const rel of relationships) {
    out.add(edgeKey(rel.fromColumnId, rel.toColumnId));
    out.add(edgeKey(rel.toColumnId, rel.fromColumnId));
  }
  return out;
}

function edgeKey(a: string, b: string): string {
  return `${a}|${b}`;
}

function resolveOnFromColumnId(
  join: Join,
  aliasStack: ReadonlyArray<AliasContext>,
): string {
  const raw = join.on.from;
  const dotIdx = raw.indexOf('.');
  if (dotIdx >= 0) {
    const aliasPart = raw.slice(0, dotIdx);
    const colPart = raw.slice(dotIdx + 1);
    const ctx = aliasStack.find(a => a.alias === aliasPart);
    if (!ctx) {
      throw new JoinResolutionError(
        `join.on.from "${raw}" references unknown alias "${aliasPart}"`,
        'invalid_plan',
      );
    }
    const col = ctx.columns.find(c => c.columnName === colPart);
    if (!col) {
      throw new JoinResolutionError(
        `join.on.from column "${colPart}" not on "${aliasPart}"`,
        'invalid_plan',
      );
    }
    return col.id;
  }
  const hits: Array<{ alias: string; columnId: string }> = [];
  for (const ctx of aliasStack) {
    const col = ctx.columns.find(c => c.columnName === raw);
    if (col) hits.push({ alias: ctx.alias, columnId: col.id });
  }
  if (hits.length === 0) {
    throw new JoinResolutionError(
      `join.on.from column "${raw}" not found on base or prior joined tables`,
      'invalid_plan',
    );
  }
  if (hits.length > 1) {
    throw new JoinResolutionError(
      `join.on.from "${raw}" is ambiguous (present on ${hits.map(h => h.alias).join(', ')}); qualify it`,
      'invalid_plan',
    );
  }
  return hits[0]!.columnId;
}

function resolveOnToColumnId(
  join: Join,
  joinedColumns: ReadonlyArray<DataSourceColumn>,
  alias: string,
): string {
  const raw = join.on.to;
  const dotIdx = raw.indexOf('.');
  let colName: string;
  if (dotIdx >= 0) {
    const aliasPart = raw.slice(0, dotIdx);
    if (aliasPart !== alias && aliasPart !== join.model) {
      throw new JoinResolutionError(
        `join.on.to "${raw}" must reference the joined table ("${alias}")`,
        'invalid_plan',
      );
    }
    colName = raw.slice(dotIdx + 1);
  } else {
    colName = raw;
  }
  const col = joinedColumns.find(c => c.columnName === colName);
  if (!col) {
    throw new JoinResolutionError(
      `join.on.to column "${raw}" not present on "${alias}"`,
      'invalid_plan',
    );
  }
  return col.id;
}

function stripTablePrefix(raw: string): string {
  const dot = raw.indexOf('.');
  return dot >= 0 ? raw.slice(dot + 1) : raw;
}

void undefined as unknown as TableMetadata;
