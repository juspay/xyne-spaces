import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { encrypt } from '@/services/encryptionService';
import type { DataSource } from '@/types/database';
import { logger } from '@/utils/logger';
import { dataSourceIngestQueue } from '@/queues/dataSourceIngestQueue';
import { ConnectorFactory } from './connectors/ConnectorFactory';
import type {
  ConnectionConfig,
  DiscoveredTable,
  SourceType,
  TestConnectionResult,
} from './connectors/types';

export type { SourceType };

export interface CreateDataSourceInput {
  workspaceId: string;
  name: string;
  description?: string;
  sourceType: SourceType;
  connectionConfig: ConnectionConfig;
  createdBy: string;
}

export interface CreateDataSourceResult {
  dataSource: DataSource;
}

export interface DataSourceListItem {
  id: string;
  name: string;
  description: string | null;
  sourceType: string;
  healthStatus: string;
  ingestionStatus: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DataSourceDetail extends DataSourceListItem {
  tableCount: number;
  columnCount: number;
}

export interface DataSourceSchemaColumn {
  id: string;
  columnName: string;
  dataTypeNative: string;
  dataTypeCanonical: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  cardinality: string | null;
}

export interface DataSourceSchemaTable {
  id: string;
  schemaName: string;
  tableName: string;
  columns: DataSourceSchemaColumn[];
}

export interface DataSourceSchemaRelationship {
  id: string;
  cardinality: string;
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
}

export interface DataSourceSchema {
  dataSourceId: string;
  name: string;
  sourceType: string;
  tables: DataSourceSchemaTable[];
  relationships: DataSourceSchemaRelationship[];
}

export interface DiscoveredTableSummary {
  schemaName: string;
  tableName: string;
  rowCountEstimate: string | null;
}

export interface IncludedTable {
  schemaName: string;
  tableName: string;
}

export class DataSourceConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataSourceConnectionError';
  }
}

export class DataSourceService {
  async findWorkspace(id: string, workspaceId: string): Promise<DataSource | null> {
    const ds = await db.dataSource.findUnique({ where: { id } });
    if (!ds || ds.workspaceId !== workspaceId) return null;
    return ds;
  }

  async list(workspaceId: string): Promise<DataSourceListItem[]> {
    const rows = await repositories.dataSources.findByWorkspace(workspaceId);
    return rows.map(toListItem);
  }

  async getDetail(id: string, workspaceId: string): Promise<DataSourceDetail | null> {
    const ds = await this.findWorkspace(id, workspaceId);
    if (!ds) return null;
    const tables = await repositories.dataSourceTables.findByDataSource(id);
    const allColumns = await repositories.dataSourceColumns.findByTableIds(
      tables.map((t) => t.id),
    );
    return {
      ...toListItem(ds),
      tableCount: tables.length,
      columnCount: allColumns.length,
    };
  }

  async getSchema(id: string, workspaceId: string): Promise<DataSourceSchema | null> {
    const ds = await this.findWorkspace(id, workspaceId);
    if (!ds) return null;

    const tables = await repositories.dataSourceTables.findByDataSource(id);
    const allColumns = await repositories.dataSourceColumns.findByTableIds(
      tables.map((t) => t.id),
    );
    const colsByTableId = new Map<string, typeof allColumns>();
    for (const c of allColumns) {
      const list = colsByTableId.get(c.tableId) ?? [];
      list.push(c);
      colsByTableId.set(c.tableId, list);
    }
    const tablesWithColumns: DataSourceSchemaTable[] = tables.map((t) => ({
      id: t.id,
      schemaName: t.schemaName,
      tableName: t.tableName,
      columns: (colsByTableId.get(t.id) ?? []).map((c) => ({
        id: c.id,
        columnName: c.columnName,
        dataTypeNative: c.dataTypeNative,
        dataTypeCanonical: c.dataTypeCanonical,
        isNullable: c.isNullable,
        isPrimaryKey: c.isPrimaryKey,
        cardinality: c.cardinality,
      })),
    }));

    const rawRels = await repositories.dataSourceRelationships.findByDataSource(id);
    const colMetaById = new Map(
      allColumns.map((c) => [c.id, { columnName: c.columnName, tableId: c.tableId }]),
    );
    const tableMetaById = new Map(
      tables.map((t) => [t.id, { schemaName: t.schemaName, tableName: t.tableName }]),
    );
    const relationships: DataSourceSchemaRelationship[] = rawRels
      .map((r) => {
        const from = colMetaById.get(r.fromColumnId);
        const to = colMetaById.get(r.toColumnId);
        if (!from || !to) return null;
        const fromTable = tableMetaById.get(from.tableId);
        const toTable = tableMetaById.get(to.tableId);
        if (!fromTable || !toTable) return null;
        return {
          id: r.id,
          cardinality: r.cardinality,
          fromSchema: fromTable.schemaName,
          fromTable: fromTable.tableName,
          fromColumn: from.columnName,
          toSchema: toTable.schemaName,
          toTable: toTable.tableName,
          toColumn: to.columnName,
        };
      })
      .filter((r): r is DataSourceSchemaRelationship => r !== null);

    return {
      dataSourceId: ds.id,
      name: ds.name,
      sourceType: ds.sourceType,
      tables: tablesWithColumns,
      relationships,
    };
  }

  async create(input: CreateDataSourceInput): Promise<CreateDataSourceResult> {
    const existing = await repositories.dataSources.findByWorkspaceAndName(
      input.workspaceId,
      input.name,
    );
    if (existing) {
      throw new DataSourceConnectionError(
        `A data source named "${input.name}" already exists in this workspace.`,
      );
    }

    const connector = await ConnectorFactory.create(input.sourceType, input.connectionConfig);
    const probe = await connector.testConnection();
    if (!probe.ok) {
      throw new DataSourceConnectionError(
        `Could not connect to source DB: ${probe.error}`,
      );
    }

    const plaintext = JSON.stringify(input.connectionConfig);
    const ciphertext = encrypt(plaintext);

    const dataSource = await db.$transaction(async (tx) => {
      const created = await tx.dataSource.create({
        data: {
          workspaceId: input.workspaceId,
          name: input.name,
          description: input.description,
          sourceType: input.sourceType,
          credentials: ciphertext,
          healthStatus: 'healthy',
          ingestionStatus: 'pending',
          createdBy: input.createdBy,
        },
      });
      await tx.dashboardActivity.create({
        data: {
          workspaceId: input.workspaceId,
          entityType: 'data_source',
          entityId: created.id,
          eventType: 'created',
          actorUserId: input.createdBy,
          details: JSON.stringify({
            sourceType: input.sourceType,
            name: input.name,
          }),
        },
      });
      return created;
    });

    logger.info(
      `[DataSource] Created ${dataSource.id} (${input.sourceType}, ws=${input.workspaceId})`,
    );

    return { dataSource };
  }

  async testConnection(
    sourceType: SourceType,
    connectionConfig: ConnectionConfig,
  ): Promise<TestConnectionResult> {
    const connector = await ConnectorFactory.create(sourceType, connectionConfig);
    return connector.testConnection();
  }

  async discoverTables(
    sourceType: SourceType,
    connectionConfig: ConnectionConfig,
  ): Promise<DiscoveredTableSummary[]> {
    const connector = await ConnectorFactory.create(sourceType, connectionConfig);
    try {
      await connector.connect();
      const tables = await connector.listTables();
      return tables.map(toDiscoveredTableSummary);
    } finally {
      await connector.close().catch(() => undefined);
    }
  }

  async remove(id: string, workspaceId: string, actorUserId: string): Promise<boolean> {
    const ds = await this.findWorkspace(id, workspaceId);
    if (!ds) return false;
    await db.$transaction([
      db.dataSource.delete({ where: { id } }),
      db.dashboardActivity.create({
        data: {
          workspaceId,
          entityType: 'data_source',
          entityId: id,
          eventType: 'deleted',
          actorUserId,
          details: JSON.stringify({ name: ds.name }),
        },
      }),
    ]);
    return true;
  }

  async requestRefresh(
    id: string,
    workspaceId: string,
    actorUserId: string,
  ): Promise<{ found: boolean; includedTables: IncludedTable[] }> {
    const ds = await this.findWorkspace(id, workspaceId);
    if (!ds) return { found: false, includedTables: [] };

    const existingTables = await repositories.dataSourceTables.findByDataSource(id);
    const includedTables: IncludedTable[] = existingTables.map((t) => ({
      schemaName: t.schemaName,
      tableName: t.tableName,
    }));

    await db.$transaction(async (tx) => {
      await tx.dataSource.update({
        where: { id },
        data: { ingestionStatus: 'pending' },
      });
      await tx.dashboardActivity.create({
        data: {
          workspaceId,
          entityType: 'data_source',
          entityId: id,
          eventType: 'refresh_requested',
          actorUserId,
        },
      });
    });

    return { found: true, includedTables };
  }

  async enqueueIngestion(
    dataSourceId: string,
    includedTables?: IncludedTable[],
  ): Promise<boolean> {
    try {
      await dataSourceIngestQueue.addJob({
        dataSourceId,
        ...(includedTables && includedTables.length > 0 ? { includedTables } : {}),
      });
      return true;
    } catch (err) {
      logger.error(
        `[DataSource] Failed to enqueue ingestion for ${dataSourceId}; marking row as 'error':`,
        err,
      );
      await repositories.dataSources
        .updateIngestionStatus(dataSourceId, 'error')
        .catch((statusErr) =>
          logger.error(
            `[DataSource] Could not mark ${dataSourceId} as 'error':`,
            statusErr,
          ),
        );
      return false;
    }
  }
}

function toListItem(ds: DataSource): DataSourceListItem {
  return {
    id: ds.id,
    name: ds.name,
    description: ds.description,
    sourceType: ds.sourceType,
    healthStatus: ds.healthStatus,
    ingestionStatus: ds.ingestionStatus,
    createdBy: ds.createdBy,
    createdAt: ds.createdAt,
    updatedAt: ds.updatedAt,
  };
}

function toDiscoveredTableSummary(t: DiscoveredTable): DiscoveredTableSummary {
  return {
    schemaName: t.schemaName,
    tableName: t.tableName,
    rowCountEstimate: t.rowCountEstimate != null ? t.rowCountEstimate.toString() : null,
  };
}

export async function findWorkspaceDataSource(
  id: string,
  workspaceId: string,
): Promise<DataSource | null> {
  return new DataSourceService().findWorkspace(id, workspaceId);
}

export async function createDataSource(
  input: CreateDataSourceInput,
): Promise<CreateDataSourceResult> {
  return new DataSourceService().create(input);
}
