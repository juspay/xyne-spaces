import type { Connector, ConnectionConfig, SourceType } from './types';
import { PostgresConnector } from './postgres';
import { ClickHouseConnector } from './clickhouse';
import { assertHostIsExternal } from '@/utils/ssrfGuard';

export class ConnectorFactory {
  static async create(
    sourceType: string,
    config: ConnectionConfig,
  ): Promise<Connector> {
    await assertHostIsExternal(config.host);

    switch (sourceType as SourceType) {
      case 'postgres':
        return new PostgresConnector(config);
      case 'clickhouse':
        return new ClickHouseConnector(config);
      default:
        throw new Error(`Unsupported sourceType: ${sourceType}`);
    }
  }
}

export const createConnector = ConnectorFactory.create;
