import type {
  Connector,
  ConnectionConfig,
  DiscoveredTable,
  DiscoveredColumn,
  DiscoveredRelationship,
  TestConnectionResult,
  ScanProfileRequest,
  ScanProfileResult,
  TableProfileOptions,
  RunQueryResult,
} from './types';

export abstract class ConnectorBase implements Connector {
  protected readonly config: ConnectionConfig;
  protected client: unknown | null = null;

  constructor(config: ConnectionConfig) {
    this.config = config;
  }

  abstract connect(): Promise<void>;
  abstract close(): Promise<void>;
  abstract testConnection(): Promise<TestConnectionResult>;

  abstract listTables(): Promise<DiscoveredTable[]>;
  abstract listAllColumns(): Promise<Map<string, DiscoveredColumn[]>>;
  abstract listRelationships(): Promise<DiscoveredRelationship[]>;

  abstract profileTableByScan(
    schemaName: string,
    tableName: string,
    request: ScanProfileRequest,
    rowCountEstimate: bigint | null,
    options: TableProfileOptions
  ): Promise<ScanProfileResult>;

  abstract runQuery(sql: string, params: ReadonlyArray<unknown>): Promise<RunQueryResult>;

  protected abstract quoteIdent(s: string): string;

  protected qualifiedName(schema: string, table: string): string {
    return `${this.quoteIdent(schema)}.${this.quoteIdent(table)}`;
  }

  protected requireClient<T>(): T {
    if (!this.client) {
      throw new Error(`${this.constructor.name}: not connected. Call connect() first.`);
    }
    return this.client as T;
  }

  protected truncateTopValue(value: string | null | undefined): string {
    return (value ?? '').slice(0, 512);
  }
}
