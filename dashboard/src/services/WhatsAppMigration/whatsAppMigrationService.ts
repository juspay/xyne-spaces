import { API_BASE_URL, isLocalhost, isSandboxLocal, isTestEnv } from '../../config';
import { apiInstance } from '../clients/apiClient';

const normalizedApiBaseUrl = API_BASE_URL.endsWith('/api')
  ? API_BASE_URL
  : `${API_BASE_URL.replace(/\/$/, '')}/api`;

const WHATSAPP_MIGRATION_BASE_URL = normalizedApiBaseUrl.replace(
  /\/api$/,
  isLocalhost || isTestEnv || isSandboxLocal
    ? '/api/migration/whatsapp'
    : '/migrate/api/migration/whatsapp',
);

export interface WhatsAppMigrationPreviewResponse {
  chatName: string | null;
  participants: string[];
  messageCount: number;
  mediaReferenceCount: number;
  mediaFilesFound: number;
  missingMediaRefs: string[];
  dateRange: { start: string; end: string } | null;
  unresolvedNames: string[];
  warnings: string[];
}

export interface WhatsAppMigrationJobProgress {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  targetProjectId: string;
  targetChannelId: string;
  chatName: string | null;
  phase:
    | 'queued'
    | 'parsing'
    | 'resolving_users'
    | 'importing_messages'
    | 'importing_media'
    | 'indexing'
    | 'completed'
    | 'failed';
  totalMessages: number | null;
  importedMessages: number;
  totalMedia: number | null;
  importedMedia: number;
  unresolvedNames: string[];
  warnings: string[];
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  errorMessage?: string;
  result?: {
    externalSourceId: string;
    externalSourceCreated: boolean;
    importedMessages: number;
    importedMedia: number;
    skippedMessages: number;
    unmatchedMediaRefs: string[];
  };
}

export interface WhatsAppImportSourceSummary {
  externalSourceId: string;
  displayName: string;
  channelId: string;
  chatName: string | null;
  createdAt: string;
  importedMessageCount: number;
  attachmentCount: number;
}

export interface WhatsAppPurgeImportResponse {
  dryRun: boolean;
  stats: {
    externalSourceId: string;
    displayName: string;
    channelId: string;
    externalMessageCount: number;
    importedMessageCount: number;
    attachmentCount: number;
    conversationCount: number;
    repliedConversationCount: number;
  };
  result?: {
    deletedExternalMessages: number;
    hardDeletedMessages: number;
    softDeletedMessages: number;
    deletedAttachments: number;
    deletedConversations: number;
  };
}

class WhatsAppMigrationService {
  async preview(payload: FormData): Promise<WhatsAppMigrationPreviewResponse> {
    const response = await apiInstance.post<{
      success: true;
      data: WhatsAppMigrationPreviewResponse;
    }>(`${WHATSAPP_MIGRATION_BASE_URL}/preview`, payload, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data.data;
  }

  async execute(payload: FormData): Promise<{ jobId: string }> {
    const response = await apiInstance.post<{ success: true; data: { jobId: string } }>(
      `${WHATSAPP_MIGRATION_BASE_URL}/execute`,
      payload,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return response.data.data;
  }

  async getStatus(jobId: string): Promise<WhatsAppMigrationJobProgress> {
    const response = await apiInstance.get<{ success: true; data: WhatsAppMigrationJobProgress }>(
      `${WHATSAPP_MIGRATION_BASE_URL}/status/${jobId}`,
    );
    return response.data.data;
  }

  async listSources(targetChannelId: string): Promise<WhatsAppImportSourceSummary[]> {
    const response = await apiInstance.get<{ success: true; data: WhatsAppImportSourceSummary[] }>(
      `${WHATSAPP_MIGRATION_BASE_URL}/sources`,
      {
        params: { targetChannelId },
      },
    );
    return response.data.data;
  }

  async purgeImport(payload: {
    externalSourceId: string;
    targetChannelId: string;
    dryRun?: boolean;
  }): Promise<WhatsAppPurgeImportResponse> {
    const response = await apiInstance.post<{ success: true; data: WhatsAppPurgeImportResponse }>(
      `${WHATSAPP_MIGRATION_BASE_URL}/purge`,
      payload,
    );
    return response.data.data;
  }
}

export const whatsAppMigrationService = new WhatsAppMigrationService();
