import type { Connector, ConnectionConfig, SourceType } from './types';
import { PostgresConnector } from './postgres';
import { ClickHouseConnector } from './clickhouse';
import { resolveExternalHostPinned } from '@/utils/ssrfGuard';

export class ConnectorFactory {
  static async create(
    sourceType: string,
    config: ConnectionConfig,
  ): Promise<Connector> {
    const pinned = await resolveExternalHostPinned(config.host);
    const pinnedConfig: ConnectionConfig = pinned ? { ...config, pinned } : config;

    switch (sourceType as SourceType) {
      case 'postgres':
        return new PostgresConnector(pinnedConfig);
      case 'clickhouse':
        return new ClickHouseConnector(pinnedConfig);
      default:
        throw new Error(`Unsupported sourceType: ${sourceType}`);
    }
  }
}

export const createConnector = ConnectorFactory.create;
