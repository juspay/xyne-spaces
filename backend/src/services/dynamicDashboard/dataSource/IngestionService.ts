
import { repositories } from '@/database/repositories';
import { decrypt } from '@/services/encryptionService';
import { redisService } from '@/services/redisService';
import type { IngestTableSelection } from '@/queues/dataSourceIngestQueue';
import {
  ColumnSummaryCodec,
  type ColumnSummary,
  type DataTypeCanonical,
} from '@/types/dataSource';
import type { DataSourceColumn } from '@/types/database';
import { logger } from '@/utils/logger';
import { ConnectorFactory } from './connectors/ConnectorFactory';
import type { Connector, ConnectionConfig } from './connectors/types';

const CATEGORICAL_DISTINCT_THRESHOLD = 50;
const TOP_K_HIGH_CARD = 20;

export class DataSourceIngestionError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'DataSourceIngestionError';
  }
}

export class IngestionService {
  async runForDataSource(
    dataSourceId: string,
    includedTables?: IngestTableSelection[],
  ): Promise<void> {
    const ds = await repositories.dataSources.findById(dataSourceId);
    if (!ds) {
      throw new DataSourceIngestionError(`Data source not found: ${dataSourceId}`);
    }

    const claimed = await repositories.dataSources.tryClaimForIngestion(dataSourceId);
    if (!claimed) {
      logger.info(
        `[Ingestion] ${dataSourceId}: skipped (already in_progress or complete by another worker)`,
      );
      return;
    }

    let connector: Connector | null = null;
    try {
      const plaintext = decrypt(ds.credentials);
      const config: ConnectionConfig = JSON.parse(plaintext);
      connector = await ConnectorFactory.create(ds.sourceType, config);
      await connector.connect();
      await repositories.dashboardActivity.create({
        entityType: 'data_source',
        entityId: dataSourceId,
        eventType: 'connected',
        actorUserId: ds.createdBy,
      });

      const discoveredTables = await connector.listTables();
      const allowList = IngestionService.buildAllowList(includedTables);
      const tablesToIngest =
        allowList === null
          ? discoveredTables
          : discoveredTables.filter((t) =>
              allowList.has(IngestionService.tableKey(t.schemaName, t.tableName)),
            );
      logger.info(
        `[Ingestion] ${dataSourceId}: ${discoveredTables.length} tables discovered, ${tablesToIngest.length} selected for ingestion`,
      );
      const tableRows = await repositories.dataSourceTables.bulkCreateAndReturn(
        tablesToIngest.map((t) => ({
          dataSourceId,
          schemaName: t.schemaName,
          tableName: t.tableName,
          rowCountEstimate: t.rowCountEstimate ?? undefined,
        })),
      );
      await repositories.dashboardActivity.create({
        entityType: 'data_source',
        entityId: dataSourceId,
        eventType: 'schema_refreshed',
        actorUserId: ds.createdBy,
        details: JSON.stringify({ tableCount: tableRows.length }),
      });
      logger.info(`[Ingestion] ${dataSourceId}: discovered ${tableRows.length} tables`);

      const columnIdByKey = new Map<string, string>();
      const keyOf = (s: string, t: string, c: string): string => `${s}.${t}.${c}`;
      for (const t of tableRows) {
        const discoveredColumns = await connector.listColumns(
          t.schemaName,
          t.tableName,
        );
        const columnRows = await repositories.dataSourceColumns.bulkCreateAndReturn(
          discoveredColumns.map((c) => ({
            tableId: t.id,
            columnName: c.columnName,
            pkPosition: c.pkPosition ?? undefined,
            dataTypeNative: c.dataTypeNative,
            dataTypeCanonical: c.dataTypeCanonical,
            isNullable: c.isNullable,
            isPrimaryKey: c.isPrimaryKey,
          })),
        );

        for (const col of columnRows) {
          columnIdByKey.set(keyOf(t.schemaName, t.tableName, col.columnName), col.id);
        }

        for (const col of columnRows) {
          try {
            await this.runColumnEda(connector, t.schemaName, t.tableName, col);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.warn(
              `[Ingestion] ${dataSourceId}: column ${t.schemaName}.${t.tableName}.${col.columnName} failed: ${message}`,
            );
            await repositories.dataSourceColumns.updateEdaResult(
              col.id,
              ColumnSummaryCodec.stringify({ edaFailed: true, edaError: message }),
              null,
            );
          }
        }
      }

      const discoveredRelationships = await connector.listRelationships();
      const relationshipRows = discoveredRelationships
        .map((rel) => {
          const fromColumnId = columnIdByKey.get(
            keyOf(rel.fromSchema, rel.fromTable, rel.fromColumn),
          );
          const toColumnId = columnIdByKey.get(
            keyOf(rel.toSchema, rel.toTable, rel.toColumn),
          );
          if (!fromColumnId || !toColumnId) return null;
          return {
            dataSourceId,
            fromColumnId,
            toColumnId,
            cardinality: rel.cardinality,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      const insertedRelCount =
        await repositories.dataSourceRelationships.replaceForDataSource(
          dataSourceId,
          relationshipRows,
        );
      logger.info(
        `[Ingestion] ${dataSourceId}: discovered ${discoveredRelationships.length} FKs, persisted ${insertedRelCount}`,
      );

      await repositories.dashboardActivity.create({
        entityType: 'data_source',
        entityId: dataSourceId,
        eventType: 'stats_refreshed',
        actorUserId: ds.createdBy,
      });
      await repositories.dataSources.updateIngestionStatus(dataSourceId, 'complete');
      logger.info(`[Ingestion] ${dataSourceId}: complete`);
      await redisService
        .broadcastUserEvent(ds.createdBy, {
          type: 'data_source_ingestion_updated',
          userId: ds.createdBy,
          data: { dataSourceId, status: 'complete' },
          timestamp: new Date(),
        })
        .catch((e) =>
          logger.error(`[Ingestion] failed to broadcast complete for ${dataSourceId}:`, e),
        );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[Ingestion] ${dataSourceId} failed: ${message}`, err);
      await repositories.dataSources
        .updateIngestionStatus(dataSourceId, 'error')
        .catch((e) =>
          logger.error(`[Ingestion] failed to mark ${dataSourceId} as 'error':`, e),
        );
      await redisService
        .broadcastUserEvent(ds.createdBy, {
          type: 'data_source_ingestion_updated',
          userId: ds.createdBy,
          data: { dataSourceId, status: 'error' },
          timestamp: new Date(),
        })
        .catch((e) =>
          logger.error(`[Ingestion] failed to broadcast error for ${dataSourceId}:`, e),
        );
      await repositories.dashboardActivity
        .create({
          entityType: 'data_source',
          entityId: dataSourceId,
          eventType: 'error',
          actorUserId: ds.createdBy,
          details: JSON.stringify({ message }),
        })
        .catch((e) =>
          logger.error(`[Ingestion] failed to write error activity for ${dataSourceId}:`, e),
        );
      throw new DataSourceIngestionError(`EDA failed for ${dataSourceId}: ${message}`, err);
    } finally {
      if (connector) {
        await connector.close().catch(() => undefined);
      }
    }
  }

  private async runColumnEda(
    connector: Connector,
    schemaName: string,
    tableName: string,
    col: DataSourceColumn,
  ): Promise<void> {
    const summary: ColumnSummary = {};
    let cardinality: 'categorical' | 'high_card' | null = null;

    const counts = await connector.computeCountStats(
      schemaName,
      tableName,
      col.columnName,
    );
    summary.totalCount = counts.totalCount;
    summary.nullCount = counts.nullCount;

    const canonical = col.dataTypeCanonical as DataTypeCanonical;
    switch (canonical) {
      case 'numeric': {
        const numericStats = await connector.computeNumericStats(
          schemaName,
          tableName,
          col.columnName,
        );
        if (numericStats) summary.numericStats = numericStats;

        const probe = await connector.computeCategoricalProbe(
          schemaName,
          tableName,
          col.columnName,
          { distinctThreshold: CATEGORICAL_DISTINCT_THRESHOLD, topK: TOP_K_HIGH_CARD },
        );
        summary.distinctCountApprox = probe.distinctCountApprox;
        if (probe.valuesAreExhaustive) {
          summary.valuesAreExhaustive = true;
          summary.topValues = probe.topValues;
          cardinality = 'categorical';
        } else {
          cardinality = 'high_card';
        }
        break;
      }

      case 'temporal': {
        const temporalStats = await connector.computeTemporalStats(
          schemaName,
          tableName,
          col.columnName,
        );
        if (temporalStats) summary.temporalStats = temporalStats;
        break;
      }

      case 'text': {
        const probe = await connector.computeCategoricalProbe(
          schemaName,
          tableName,
          col.columnName,
          { distinctThreshold: CATEGORICAL_DISTINCT_THRESHOLD, topK: TOP_K_HIGH_CARD },
        );
        summary.distinctCountApprox = probe.distinctCountApprox;
        summary.valuesAreExhaustive = probe.valuesAreExhaustive;
        summary.topValues = probe.topValues;
        cardinality = probe.valuesAreExhaustive ? 'categorical' : 'high_card';
        break;
      }

      case 'boolean':
      case 'json':
      case 'array':
      case 'binary':
      case 'unknown':
        break;
    }

    await repositories.dataSourceColumns.updateEdaResult(
      col.id,
      ColumnSummaryCodec.stringify(summary),
      cardinality,
    );
  }

  private static tableKey(schemaName: string, tableName: string): string {
    return `${schemaName}.${tableName}`;
  }

  private static buildAllowList(
    selection: IngestTableSelection[] | undefined,
  ): Set<string> | null {
    if (!selection || selection.length === 0) return null;
    const set = new Set<string>();
    for (const t of selection) {
      if (t.schemaName && t.tableName) set.add(IngestionService.tableKey(t.schemaName, t.tableName));
    }
    return set.size > 0 ? set : null;
  }
}

export async function runDataSourceIngestion(
  dataSourceId: string,
  includedTables?: IngestTableSelection[],
): Promise<void> {
  return new IngestionService().runForDataSource(dataSourceId, includedTables);
}
