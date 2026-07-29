import { config } from '@/config/env';
import { repositories } from '@/database/repositories';
import { decrypt } from '@/services/encryptionService';
import { redisService } from '@/services/redisService';
import type { IngestTableSelection } from '@/queues/dataSourceIngestQueue';
import { ColumnSummaryCodec, type DataTypeCanonical } from '@/types/dataSource';
import { logger } from '@/utils/logger';
import { ConnectorFactory } from '../connectors/ConnectorFactory';
import type { ConnectionConfig, DiscoveredColumn, TableProfileOptions } from '../connectors/types';
import { mapWithConcurrency } from '@/utils/concurrency';
import { IngestionProgressBroadcaster } from './IngestionProgress';
import { tableKey, columnKey } from '../../tableKeys';

const CATEGORICAL_DISTINCT_THRESHOLD = 50;
const TOP_K_HIGH_CARD = 20;
const COLUMN_CHUNK_SIZE = 40;
const SAMPLE_ROW_THRESHOLD = 10_000_000;
const SAMPLE_VALUES_PER_COLUMN = 3;

export class DataSourceIngestionError extends Error {
  constructor(
    message: string,
    public cause?: unknown
  ) {
    super(message);
    this.name = 'DataSourceIngestionError';
  }
}

type LoadedDataSource = NonNullable<Awaited<ReturnType<typeof repositories.dataSources.findById>>>;
type LiveConnector = Awaited<ReturnType<typeof ConnectorFactory.create>>;
type DiscoveredRelationship = Awaited<ReturnType<LiveConnector['listRelationships']>>[number];

interface TableWorkItem {
  key: string;
  tableRowId: string;
  schemaName: string;
  tableName: string;
  rowCountEstimate: bigint | null;
  columns: Array<{ id: string; columnName: string; dataTypeCanonical: DataTypeCanonical }>;
}

/** Stable per-run handles, assembled once and threaded through the phase methods. */
interface RunContext {
  dataSourceId: string;
  ds: LoadedDataSource;
  connector: LiveConnector;
  includedTables: IngestTableSelection[] | undefined;
  profileOptions: TableProfileOptions;
}

interface DiscoveryResult {
  workItems: TableWorkItem[];
  discoveredRelationships: DiscoveredRelationship[];
  columnIdByKey: Map<string, string>;
}

export class IngestionService {
  async runForDataSource(
    dataSourceId: string,
    includedTables?: IngestTableSelection[]
  ): Promise<void> {
    const startedAt = Date.now();
    const ds = await repositories.dataSources.findById(dataSourceId);
    if (!ds) {
      throw new DataSourceIngestionError(`Data source not found: ${dataSourceId}`);
    }

    const claimed = await repositories.dataSources.tryClaimForIngestion(dataSourceId);
    if (!claimed) {
      logger.info(
        `[Ingestion] ${dataSourceId}: skipped (already in_progress or complete by another worker)`
      );
      return;
    }
    logger.info(
      `[Ingestion] ${dataSourceId}: starting ingestion of "${ds.name}" (${ds.sourceType})`
    );

    let connector: LiveConnector | null = null;
    try {
      connector = await this.connect(ds);
      logger.info(`[Ingestion] ${dataSourceId}: connected to source`);
      // Record the "connected" activity only after the connector is assigned to
      // the outer variable, so a failure here still closes the pool in `finally`.
      await repositories.dashboardActivity.create({
        entityType: 'data_source',
        entityId: ds.id,
        eventType: 'connected',
        actorUserId: ds.createdBy,
        workspaceId: ds.workspaceId,
      });
      const ctx: RunContext = {
        dataSourceId,
        ds,
        connector,
        includedTables,
        profileOptions: this.buildProfileOptions(),
      };

      const discovery = await this.discoverAndSync(ctx);

      const progress = new IngestionProgressBroadcaster(
        dataSourceId,
        ds.createdBy,
        ds.name,
        discovery.workItems.length,
        startedAt
      );
      progress.started(discovery.workItems.map((w) => w.key));
      logger.info(
        `[Ingestion] ${dataSourceId}: profiling ${discovery.workItems.length} tables ` +
          `(concurrency ${config.dataSource.edaConcurrency})`
      );

      const failedCount = await this.profileAllTables(ctx, discovery.workItems, progress);
      progress.flush();

      await this.persistRelationships(
        ctx,
        discovery.discoveredRelationships,
        discovery.columnIdByKey
      );

      await this.finalize(ctx, discovery.workItems, progress, startedAt, failedCount);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[Ingestion] ${dataSourceId} failed: ${message}`, err);
      await repositories.dataSources
        .updateIngestionStatus(dataSourceId, 'error')
        .catch((e) => logger.error(`[Ingestion] failed to mark ${dataSourceId} as 'error':`, e));
      await redisService
        .broadcastUserEvent(ds.createdBy, {
          type: 'data_source_ingestion_updated',
          userId: ds.createdBy,
          data: { dataSourceId, status: 'error' },
          timestamp: new Date(),
        })
        .catch((e) =>
          logger.error(`[Ingestion] failed to broadcast error for ${dataSourceId}:`, e)
        );
      await repositories.dashboardActivity
        .create({
          entityType: 'data_source',
          entityId: dataSourceId,
          eventType: 'error',
          actorUserId: ds.createdBy,
          details: JSON.stringify({ message }),
          workspaceId: ds.workspaceId,
        })
        .catch((e) =>
          logger.error(`[Ingestion] failed to write error activity for ${dataSourceId}:`, e)
        );
      throw new DataSourceIngestionError(`EDA failed for ${dataSourceId}: ${message}`, err);
    } finally {
      if (connector) {
        await connector.close().catch(() => undefined);
      }
    }
  }

  private buildProfileOptions(): TableProfileOptions {
    return {
      distinctThreshold: CATEGORICAL_DISTINCT_THRESHOLD,
      topK: TOP_K_HIGH_CARD,
      columnChunkSize: COLUMN_CHUNK_SIZE,
      sampleRowThreshold: SAMPLE_ROW_THRESHOLD,
      sampleValuesPerColumn: SAMPLE_VALUES_PER_COLUMN,
    };
  }

  /** Decrypt credentials and open the connector. */
  private async connect(ds: LoadedDataSource): Promise<LiveConnector> {
    const connConfig: ConnectionConfig = JSON.parse(decrypt(ds.credentials));
    const connector = await ConnectorFactory.create(ds.sourceType, connConfig);
    await connector.connect();
    return connector;
  }

  /**
   * Discover the source schema, sync tables + columns into our tables, and build the
   * per-table work list (plus the column-id lookup for later phases).
   */
  private async discoverAndSync(ctx: RunContext): Promise<DiscoveryResult> {
    const { dataSourceId, ds, connector, includedTables } = ctx;

    const discoveredTables = await connector.listTables();
    const allowList = IngestionService.buildAllowList(includedTables);
    const tablesToIngest =
      allowList === null
        ? discoveredTables
        : discoveredTables.filter((t) => allowList.has(tableKey(t.schemaName, t.tableName)));
    logger.info(
      `[Ingestion] ${dataSourceId}: ${discoveredTables.length} tables discovered, ${tablesToIngest.length} selected`
    );

    const allColumns = await connector.listAllColumns();
    const discoveredRelationships = await connector.listRelationships();

    const tableRows = await repositories.dataSourceTables.syncForDataSource(
      dataSourceId,
      tablesToIngest.map((t) => ({
        schemaName: t.schemaName,
        tableName: t.tableName,
        rowCountEstimate: t.rowCountEstimate,
      }))
    );
    await repositories.dashboardActivity.create({
      entityType: 'data_source',
      entityId: dataSourceId,
      eventType: 'schema_refreshed',
      actorUserId: ds.createdBy,
      details: JSON.stringify({ tableCount: tableRows.length }),
      workspaceId: ds.workspaceId,
    });

    const columnIdByKey = new Map<string, string>();

    const workItems: TableWorkItem[] = [];
    await mapWithConcurrency(tableRows, config.dataSource.edaConcurrency, async (t) => {
      const key = tableKey(t.schemaName, t.tableName);
      const discovered: DiscoveredColumn[] = allColumns.get(key) ?? [];
      const columnRows = await repositories.dataSourceColumns.syncForTable(
        t.id,
        discovered.map((c) => ({
          columnName: c.columnName,
          pkPosition: c.pkPosition,
          dataTypeNative: c.dataTypeNative,
          dataTypeCanonical: c.dataTypeCanonical,
          isNullable: c.isNullable,
          isPrimaryKey: c.isPrimaryKey,
        }))
      );
      for (const col of columnRows) {
        columnIdByKey.set(columnKey(t.schemaName, t.tableName, col.columnName), col.id);
      }
      workItems.push({
        key,
        tableRowId: t.id,
        schemaName: t.schemaName,
        tableName: t.tableName,
        rowCountEstimate: t.rowCountEstimate,
        columns: columnRows.map((c) => ({
          id: c.id,
          columnName: c.columnName,
          dataTypeCanonical: c.dataTypeCanonical as DataTypeCanonical,
        })),
      });
    });

    return { workItems, discoveredRelationships, columnIdByKey };
  }

  private async profileAllTables(
    ctx: RunContext,
    workItems: TableWorkItem[],
    progress: IngestionProgressBroadcaster
  ): Promise<number> {
    const results = await mapWithConcurrency(workItems, config.dataSource.edaConcurrency, (w) =>
      this.profileOneTable(ctx, w, progress)
    );
    return results.filter((ok) => !ok).length;
  }

  private async profileOneTable(
    ctx: RunContext,
    w: TableWorkItem,
    progress: IngestionProgressBroadcaster
  ): Promise<boolean> {
    const { dataSourceId, connector, profileOptions } = ctx;
    const tStart = Date.now();
    try {
      const scan = await connector.profileTableByScan(
        w.schemaName,
        w.tableName,
        { columns: w.columns },
        w.rowCountEstimate,
        profileOptions
      );
      const profiled = new Map(scan.columns);
      for (const [name, values] of scan.sampleValues) {
        const existing = profiled.get(name);
        if (existing && values.length > 0) existing.summary.sampleValues = values;
      }
      const queryCount = scan.queryCount;

      await repositories.dataSourceColumns.bulkUpdateEdaResults(
        w.columns.map((c) => {
          const p = profiled.get(c.columnName);
          return {
            id: c.id,
            summary: ColumnSummaryCodec.stringify(p?.summary ?? {}),
            cardinality: p?.cardinality ?? null,
          };
        })
      );
      const ms = Date.now() - tStart;
      progress.tableFinished({
        key: w.key,
        ok: true,
        ms,
        columns: w.columns.length,
        queries: queryCount,
      });
      logger.info(
        `[Ingestion] ${dataSourceId}: ${w.key} profiled in ${ms}ms ` +
          `(${queryCount} source queries, ${w.columns.length} columns)`
      );
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        `[Ingestion] ${dataSourceId}: table ${w.key} failed after ${Date.now() - tStart}ms ` +
          `(${w.columns.length} columns): ${message}`,
        err
      );
      progress.tableFinished({
        key: w.key,
        ok: false,
        ms: Date.now() - tStart,
        columns: w.columns.length,
        queries: 0,
        error: message.slice(0, 300),
      });
      await repositories.dataSourceColumns
        .bulkUpdateEdaResults(
          w.columns.map((c) => ({
            id: c.id,
            summary: ColumnSummaryCodec.stringify({ edaFailed: true, edaError: message }),
            cardinality: null,
          }))
        )
        .catch(() => undefined);
      return false;
    }
  }

  /** Persist discovered foreign keys. */
  private async persistRelationships(
    ctx: RunContext,
    discoveredRelationships: DiscoveredRelationship[],
    columnIdByKey: Map<string, string>
  ): Promise<void> {
    const { dataSourceId, ds } = ctx;

    const relationshipRows = discoveredRelationships
      .map((rel) => {
        const fromColumnId = columnIdByKey.get(
          columnKey(rel.fromSchema, rel.fromTable, rel.fromColumn)
        );
        const toColumnId = columnIdByKey.get(columnKey(rel.toSchema, rel.toTable, rel.toColumn));
        if (!fromColumnId || !toColumnId) return null;
        return { dataSourceId, workspaceId: ds.workspaceId, fromColumnId, toColumnId, cardinality: rel.cardinality };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const insertedRelCount = await repositories.dataSourceRelationships.replaceForDataSource(
      dataSourceId,
      relationshipRows
    );
    logger.info(
      `[Ingestion] ${dataSourceId}: discovered ${discoveredRelationships.length} FKs, persisted ${insertedRelCount}`
    );
  }

  private async finalize(
    ctx: RunContext,
    workItems: TableWorkItem[],
    progress: IngestionProgressBroadcaster,
    startedAt: number,
    failedCount: number
  ): Promise<void> {
    const { dataSourceId, ds } = ctx;

    progress.done();

    const total = workItems.length;
    const profiled = total - failedCount;
    const status: 'complete' | 'partial' = failedCount > 0 ? 'partial' : 'complete';
    const durationMs = Date.now() - startedAt;

    await repositories.dashboardActivity.create({
      entityType: 'data_source',
      entityId: dataSourceId,
      eventType: 'stats_refreshed',
      actorUserId: ds.createdBy,
      details: JSON.stringify({ durationMs, tables: total, profiled, failed: failedCount, status }),
      workspaceId: ds.workspaceId,
    });

    await repositories.dataSources.updateIngestionStatus(dataSourceId, 'complete');

    if (failedCount > 0) {
      logger.warn(
        `[Ingestion] ${dataSourceId}: completed WITH ERRORS in ${durationMs}ms — ` +
          `${profiled}/${total} tables profiled, ${failedCount} failed`
      );
    } else {
      logger.info(
        `[Ingestion] ${dataSourceId}: completed successfully in ${durationMs}ms — ` +
          `${total} tables profiled`
      );
    }

    await redisService
      .broadcastUserEvent(ds.createdBy, {
        type: 'data_source_ingestion_updated',
        userId: ds.createdBy,
        data: { dataSourceId, status, total, failed: failedCount },
        timestamp: new Date(),
      })
      .catch((e) =>
        logger.error(`[Ingestion] failed to broadcast ${status} for ${dataSourceId}:`, e)
      );
  }

  private static buildAllowList(selection: IngestTableSelection[] | undefined): Set<string> | null {
    if (!selection || selection.length === 0) return null;
    const set = new Set<string>();
    for (const t of selection) {
      if (t.schemaName && t.tableName) set.add(tableKey(t.schemaName, t.tableName));
    }
    return set.size > 0 ? set : null;
  }
}

export async function runDataSourceIngestion(
  dataSourceId: string,
  includedTables?: IngestTableSelection[]
): Promise<void> {
  return new IngestionService().runForDataSource(dataSourceId, includedTables);
}
