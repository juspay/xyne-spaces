import { useCallback, useEffect, useState } from 'react';
import { websocketService } from '../services/clients/socketClient';

export interface FinishedTableEntry {
  key: string;
  ok: boolean;
  ms: number;
  columns: number;
  queries: number;
  error?: string;
}

interface ProgressEventPayload {
  dataSourceId: string;
  name?: string;
  kind: 'started' | 'progress';
  totalTables: number;
  doneTables: number;
  failedTables: number;
  elapsedMs: number;
  tables?: string[];
  finished?: FinishedTableEntry[];
}

interface UpdatedEventPayload {
  dataSourceId: string;
  status: 'complete' | 'partial' | 'error';
  total?: number;
  failed?: number;
}

export interface IngestionProgress {
  dataSourceId: string;
  name?: string;
  status: 'running' | 'complete' | 'partial' | 'error';
  total: number;
  done: number;
  failed: number;
  elapsedMs: number;
  pending: string[];
  finished: FinishedTableEntry[];
}

export function useIngestionProgress(): {
  progressById: Record<string, IngestionProgress>;
  dismiss: (dataSourceId: string) => void;
} {
  const [progressById, setProgressById] = useState<Record<string, IngestionProgress>>({});

  useEffect(() => {
    let active = true;

    const onProgress = (data: ProgressEventPayload): void => {
      if (!data?.dataSourceId) return;
      setProgressById(prev => {
        const existing = prev[data.dataSourceId];
        const finishedNew = data.finished ?? [];
        const finishedKeys = new Set(finishedNew.map(f => f.key));
        const base: IngestionProgress = existing ?? {
          dataSourceId: data.dataSourceId,
          status: 'running',
          total: 0,
          done: 0,
          failed: 0,
          elapsedMs: 0,
          pending: [],
          finished: [],
        };
        const name = data.name ?? base.name;
        const isProfileStart = data.kind === 'started';
        return {
          ...prev,
          [data.dataSourceId]: {
            ...base,
            ...(name !== undefined ? { name } : {}),
            status: 'running',
            total: data.totalTables,
            done: data.doneTables,
            failed: data.failedTables,
            elapsedMs: data.elapsedMs,
            pending: isProfileStart
              ? (data.tables ?? [])
              : base.pending.filter(k => !finishedKeys.has(k)),
            finished: isProfileStart
              ? []
              : [...finishedNew.slice().reverse(), ...base.finished].slice(0, 2000),
          },
        };
      });
    };

    const onUpdated = (data: UpdatedEventPayload): void => {
      if (!data?.dataSourceId) return;
      setProgressById(prev => {
        const existing = prev[data.dataSourceId];
        const total = data.total ?? 0;
        const failed = data.failed ?? 0;
        if (!existing) {
          // Early connect/discovery failures arrive with no prior progress entry.
          // Materialize a minimal terminal entry so the pill still shows.
          return {
            ...prev,
            [data.dataSourceId]: {
              dataSourceId: data.dataSourceId,
              status: data.status,
              total,
              done: total - failed,
              failed,
              elapsedMs: 0,
              pending: [],
              finished: [],
            },
          };
        }
        return {
          ...prev,
          [data.dataSourceId]: {
            ...existing,
            status: data.status,
            ...(data.total !== undefined ? { total: data.total } : {}),
            ...(data.failed !== undefined ? { failed: data.failed } : {}),
          },
        };
      });
    };

    void websocketService
      .connect()
      .then(() => {
        if (!active) return;
        websocketService.on<ProgressEventPayload>('data_source_ingestion_progress', onProgress);
        websocketService.on<UpdatedEventPayload>('data_source_ingestion_updated', onUpdated);
      })
      .catch(() => {});
    return () => {
      active = false;
      websocketService.removeListener('data_source_ingestion_progress', onProgress);
      websocketService.removeListener('data_source_ingestion_updated', onUpdated);
    };
  }, []);

  const dismiss = useCallback((dataSourceId: string) => {
    setProgressById(prev => {
      const next = { ...prev };
      delete next[dataSourceId];
      return next;
    });
  }, []);

  return { progressById, dismiss };
}

export function overallPercent(p: IngestionProgress): number {
  if (p.status === 'complete' || p.status === 'partial') return 100;
  const profileRatio = p.total > 0 ? p.done / p.total : 0;
  return Math.round(profileRatio * 100);
}

export function ingestionCount(p: IngestionProgress): string {
  if (p.status !== 'running') return '';
  return `${p.done}/${p.total}`;
}
