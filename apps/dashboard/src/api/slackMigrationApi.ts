import { apiInstance } from '../services/clients/apiClient';
import { API_BASE_URL } from '../config';

// Served by the migration pod at /migrate/api/migration/slack-migration/*.
const BASE = API_BASE_URL.replace(/\/api\/?$/, '/migrate/api/migration/slack-migration');

export type MigrationType = 'DM' | 'CHANNEL';
export type MigrationStatus =
  | 'SUBMITTED'
  | 'QUEUED'
  | 'COLLECTING'
  | 'AWAITING_APPROVAL'
  | 'INGESTING'
  | 'STOPPED'
  | 'FAILED'
  | 'COMPLETED';

export interface MigrationJobView {
  id: string;
  type: MigrationType;
  status: MigrationStatus;
  phase: 'collect' | 'ingest';
  stopRequested: boolean;
  stopReason?: 'admin' | 'system';
  submittedByUserId: string;
  submittedByName?: string;
  stats: { conversations: number; messages: number };
  progress: { total: number; collected: number; ingested: number };
  channel?: {
    slackId: string;
    xyneId: string;
    slackName?: string;
    xyneName?: string;
    startDate?: string;
    announceInSlack?: boolean;
    windowStart?: number;
    windowEnd?: number;
    collectedThrough?: number;
  };
  heartbeatAt: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  ingestStartedAt?: number;
  ingestDurationMs?: number; // how long ingestion took (completedAt − ingestStartedAt)
  error?: string;
  issues?: {
    conversationId: string;
    kind: 'skipped' | 'truncated' | 'ingest-error';
    reason: string;
    label?: string; // human-readable conversation identifier (e.g. "DM with Jane Doe" / "#general")
  }[];
}

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

const unwrap = <T>(payload: Envelope<T>): T => {
  if (!payload.success) throw new Error(payload.error?.message ?? 'Request failed');
  return payload.data;
};

export const slackMigrationApi = {
  submitDm: async (token: string): Promise<MigrationJobView> =>
    unwrap((await apiInstance.post<Envelope<MigrationJobView>>(`${BASE}/dm`, { token })).data),

  submitChannel: async (input: {
    slackChannelId: string;
    xyneChannelId: string;
    startDate?: string;
    announceInSlack?: boolean;
  }): Promise<MigrationJobView> =>
    unwrap((await apiInstance.post<Envelope<MigrationJobView>>(`${BASE}/channel`, input)).data),

  listMine: async (): Promise<MigrationJobView[]> =>
    unwrap((await apiInstance.get<Envelope<MigrationJobView[]>>(`${BASE}/mine`)).data),

  listAdmin: async (): Promise<MigrationJobView[]> =>
    unwrap((await apiInstance.get<Envelope<MigrationJobView[]>>(`${BASE}/migration-jobs`)).data),

  approve: async (id: string): Promise<MigrationJobView> =>
    unwrap(
      (await apiInstance.post<Envelope<MigrationJobView>>(`${BASE}/migration-jobs/${id}/approve`))
        .data,
    ),

  stop: async (id: string): Promise<MigrationJobView> =>
    unwrap(
      (await apiInstance.post<Envelope<MigrationJobView>>(`${BASE}/migration-jobs/${id}/stop`))
        .data,
    ),

  resume: async (id: string): Promise<MigrationJobView> =>
    unwrap(
      (await apiInstance.post<Envelope<MigrationJobView>>(`${BASE}/migration-jobs/${id}/resume`))
        .data,
    ),

  remove: async (id: string): Promise<void> => {
    await apiInstance.delete(`${BASE}/migration-jobs/${id}`);
  },

  // Owner self-service (own jobs only).
  resumeMine: async (id: string): Promise<MigrationJobView> =>
    unwrap((await apiInstance.post<Envelope<MigrationJobView>>(`${BASE}/mine/${id}/resume`)).data),

  removeMine: async (id: string): Promise<void> => {
    await apiInstance.delete(`${BASE}/mine/${id}`);
  },

  // Ingestion control, gated by SLACK-MIGRATION-INGEST.
  ingestionStatus: async (): Promise<{ canIngest: boolean; running: boolean }> =>
    unwrap(
      (
        await apiInstance.get<Envelope<{ canIngest: boolean; running: boolean }>>(
          `${BASE}/ingestion`,
        )
      ).data,
    ),
  startIngestion: async (): Promise<{ running: boolean }> =>
    unwrap(
      (await apiInstance.post<Envelope<{ running: boolean }>>(`${BASE}/ingestion/start`)).data,
    ),
  stopIngestion: async (): Promise<{ running: boolean }> =>
    unwrap((await apiInstance.post<Envelope<{ running: boolean }>>(`${BASE}/ingestion/stop`)).data),

  exportHistory: async (): Promise<MigrationJobView[]> =>
    unwrap(
      (await apiInstance.get<Envelope<MigrationJobView[]>>(`${BASE}/migration-jobs/export`)).data,
    ),
};
