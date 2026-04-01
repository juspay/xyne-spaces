import { API_BASE_URL } from '../config';
import { apiInstance } from './clients/apiClient';

export type GoogleMailConnectionStatus =
  | 'pending_auth'
  | 'authenticated'
  | 'syncing'
  | 'connected'
  | 'error';

export type GoogleMailSyncMode = 'full' | 'incremental';

export interface GoogleMailSource {
  id: string;
  name: string;
  displayName: string;
  channelId: string | null;
  boardId: string | null;
  isActive: boolean;
  status: GoogleMailConnectionStatus;
  mailboxEmail?: string;
  lastSyncedAt?: string | null;
  syncProcessedMessages?: number | null;
  syncTotalMessages?: number | null;
  syncStartedAt?: string | null;
  syncMode?: GoogleMailSyncMode | null;
  lastError?: string | null;
  scopes: string[];
  hasRefreshToken: boolean;
  hasCustomProviderConfig: boolean;
  oauthStartUrl: string;
}

interface CreateGoogleMailSourcePayload {
  displayName: string;
  channelId?: string;
  boardId?: string;
}

export const googleMailService = {
  async listSources(): Promise<GoogleMailSource[]> {
    const response = await apiInstance.get<GoogleMailSource[]>('/google-mail/sources');
    return response.data;
  },

  async createSource(payload: CreateGoogleMailSourcePayload): Promise<GoogleMailSource> {
    const response = await apiInstance.post<GoogleMailSource>('/google-mail/sources', payload);
    return response.data;
  },

  async startIngestion(sourceId: string): Promise<void> {
    await apiInstance.post(`/google-mail/sources/${sourceId}/start-ingestion`);
  },

  resolveOAuthStartUrl(source: Pick<GoogleMailSource, 'oauthStartUrl'>): string {
    const backendBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '/');
    return new URL(source.oauthStartUrl, backendBaseUrl).toString();
  },
};
