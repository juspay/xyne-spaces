import type { QueryPlan, Join } from '@xyne/shared';
import type { DataSourceTable, DataSourceColumn } from '@/types/database';
import { repositories } from '@/database/repositories';
import { resolveTableRef } from '../tableKeys';
import type { JoinedTableMetadata } from './compilers/types';

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
}

export async function resolveJoinedTablesMetadata(
  input: JoinResolveInput,
): Promise<JoinedTableMetadata[]> {
  const { plan, targetTable, baseColumns, tables } = input;
  if (!plan.joins || plan.joins.length === 0) return [];

  const findTable = (
    joinModel: string,
    joinSchema: string | undefined,
  ): DataSourceTable | null => {
    if (joinSchema === undefined && !joinModel.includes('.')) {
      return (
        resolveTableRef(tables, joinModel, targetTable.schemaName) ??
        resolveTableRef(tables, joinModel) ??
        null
      );
    }
    return resolveTableRef(tables, joinModel, joinSchema) ?? null;
  };

  const joinTargetIds = [
    ...new Set(
      plan.joins
        .map(j => findTable(j.model, j.schema)?.id)
        .filter((id): id is string => id !== undefined && id !== targetTable.id),
    ),
  ];
  const joinColumns =
    joinTargetIds.length > 0
      ? await repositories.dataSourceColumns.findByTableIds(joinTargetIds)
      : [];
  const columnsByTableId = new Map<string, DataSourceColumn[]>();
  for (const col of joinColumns) {
    const list = columnsByTableId.get(col.tableId) ?? [];
    list.push(col);
    columnsByTableId.set(col.tableId, list);
  }
  columnsByTableId.set(targetTable.id, [...baseColumns]);

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

    validateOnFrom(join, aliasStack);
    validateOnTo(join, joinedColumns, alias);

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

function validateOnFrom(join: Join, aliasStack: ReadonlyArray<AliasContext>): void {
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
    if (!ctx.columns.some(c => c.columnName === colPart)) {
      throw new JoinResolutionError(
        `join.on.from column "${colPart}" not on "${aliasPart}"`,
        'invalid_plan',
      );
    }
    return;
  }
  const hits = aliasStack.filter(ctx => ctx.columns.some(c => c.columnName === raw));
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
}

function validateOnTo(
  join: Join,
  joinedColumns: ReadonlyArray<DataSourceColumn>,
  alias: string,
): void {
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
  if (!joinedColumns.some(c => c.columnName === colName)) {
    throw new JoinResolutionError(
      `join.on.to column "${raw}" not present on "${alias}"`,
      'invalid_plan',
    );
  }
}
