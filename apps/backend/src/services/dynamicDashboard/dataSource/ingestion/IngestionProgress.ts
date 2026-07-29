import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';

export interface TableProgressEntry {
  key: string;
  ok: boolean;
  ms: number;
  columns: number;
  queries: number;
  error?: string;
}

const FLUSH_INTERVAL_MS = 400;
const FLUSH_BATCH_SIZE = 8;

export class IngestionProgressBroadcaster {
  private buffer: TableProgressEntry[] = [];
  private profileDone = 0;
  private failed = 0;

  private lastFlush = 0;

  constructor(
    private readonly dataSourceId: string,
    private readonly userId: string,
    private readonly sourceName: string,
    private readonly totalTables: number,
    private readonly startedAt: number
  ) {}

  started(tableKeys: string[]): void {
    this.send('started', { tables: tableKeys });
  }

  tableFinished(entry: TableProgressEntry): void {
    this.profileDone++;
    if (!entry.ok) this.failed++;
    this.buffer.push(entry);
    if (this.buffer.length >= FLUSH_BATCH_SIZE || Date.now() - this.lastFlush >= FLUSH_INTERVAL_MS) {
      this.flush();
    }
  }

  flush(): void {
    if (this.buffer.length === 0) return;
    this.send('progress', { finished: this.buffer.splice(0) });
  }

  /** Flush any buffered rows; the terminal signal is the `complete` update event. */
  done(): void {
    this.flush();
  }

  private send(kind: 'started' | 'progress', extra: Record<string, unknown>): void {
    this.lastFlush = Date.now();
    redisService
      .broadcastUserEvent(this.userId, {
        type: 'data_source_ingestion_progress',
        userId: this.userId,
        data: {
          dataSourceId: this.dataSourceId,
          name: this.sourceName,
          kind,
          totalTables: this.totalTables,
          doneTables: this.profileDone,
          failedTables: this.failed,
          elapsedMs: Date.now() - this.startedAt,
          ...extra,
        },
        timestamp: new Date(),
      })
      .catch((e) =>
        logger.warn(`[Ingestion] progress broadcast failed for ${this.dataSourceId}: ${e}`)
      );
  }
}
