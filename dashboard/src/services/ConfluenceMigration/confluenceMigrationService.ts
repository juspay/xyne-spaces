import { API_BASE_URL, isSandBox } from '../../config';
import { apiInstance } from '../clients/apiClient';

const CONFLUENCE_MIGRATION_BASE_URL = API_BASE_URL.replace(
  /\/api$/,
  isSandBox ? '/api/migration/confluence' : '/migrate/api/migration/confluence',
);

export type ConfluenceSectionMapping =
  | { type: 'channel'; channelId?: string; channelName?: string }
  | { type: 'channelFolder'; channelId?: string }
  | { type: 'projectFolder' };

export interface ConfluencePreviewUser {
  accountId: string | null;
  email: string | null;
  displayName: string | null;
  publicName: string | null;
  username: string | null;
  userKey: string | null;
}

export interface ConfluenceMigrationPreviewResponse {
  spaceKey: string;
  spaceName: string;
  totalPages: number;
  leafPages: number;
  containerPages: number;
  rootPages: Array<{ id: string; title: string; childPages: number }>;
  sections: Array<{
    id: string;
    title: string;
    childPages: number;
    destination: ConfluenceSectionMapping;
  }>;
  targetProject: { id: string; name: string; code: string | null } | null;
  targetChannel: { id: string; name: string; projectId: string } | null;
  projectChannels: Array<{ id: string; name: string }>;
  visibilitySummary?: {
    publicCanvases: number;
    privateCanvases: number;
    readRestrictedPages: number;
    unknownRestrictionPages: number;
  };
  pageAuthorSamples: Array<{
    id: string;
    title: string;
    isLeafPage: boolean;
    xyneVisibility?: 'PRIVATE' | 'PUBLIC' | null;
    hasReadRestriction?: boolean | null;
    restrictionStatus?: 'checked' | 'unknown' | null;
    createdDate: string | null;
    createdBy: ConfluencePreviewUser | null;
    lastUpdatedAt: string | null;
    lastUpdatedBy: ConfluencePreviewUser | null;
  }>;
  suggestedConfig: {
    spaceKey: string;
    projectId?: string;
    projectName: string;
    defaultDestination: 'channelFolder';
    sectionMappings?: Record<string, ConfluenceSectionMapping>;
  };
  warnings: string[];
}

export interface ConfluenceMigrationPreviewRequest {
  spaceKey: string;
  targetProjectId?: string;
  projectId?: string;
  targetChannelId?: string;
  targetChannelName?: string;
  sectionMappings?: Record<string, ConfluenceSectionMapping>;
}

export interface ConfluenceMigrationExecuteRequest extends ConfluenceMigrationPreviewRequest {
  projectName?: string;
  projectCode?: string;
  migrateAttachments?: boolean;
  createProjectIfMissing?: boolean;
  createDefaultChannel?: boolean;
  defaultDestination?: 'channelFolder' | 'projectFolder';
  frontendBaseUrl?: string;
}

export interface ConfluencePageResult {
  confluencePageId: string;
  canvasId?: string;
  title: string;
  status: 'created' | 'updated' | 'partial' | 'failed';
  failedStep?: 'canvas' | 'attachments' | 'link_rewrite' | null;
  errors?: string[];
  visibility?: 'PRIVATE' | 'PUBLIC';
  confluenceReadRestricted?: boolean;
  confluenceRestrictionStatus?: 'checked' | 'unknown';
  destination?: ConfluenceSectionMapping & {
    projectId?: string;
    channelId?: string;
    folderId?: string;
    folderName?: string;
    sectionTitle?: string;
  };
  error?: string;
}

export interface UnresolvedConfluenceUser {
  displayName: string | null;
  accountId: string | null;
  suggestedEmails: string[];
  pageIds: string[];
}

export interface ConfluenceMigrationSummary {
  spaceKey: string;
  projectId: string;
  createdProject: boolean;
  reusedProject: boolean;
  createdChannels: number;
  reusedChannels: number;
  totalPages: number;
  createdCanvases: number;
  updatedCanvases: number;
  createdFolders: number;
  reusedFolders: number;
  migratedAttachments: number;
  reusedAttachments: number;
  failedAttachments: number;
  warnings: string[];
  unresolvedUsers: UnresolvedConfluenceUser[];
  pageResults: ConfluencePageResult[];
  defaultChannelId?: string;
}

export interface ConfluenceMigrationStartResponse {
  jobId: string;
}

export interface ConfluenceMigrationJobProgress {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  spaceKey: string;
  targetProjectId: string;
  targetChannelId?: string;
  totalPages: number | null;
  processedPages: number;
  createdCanvases: number;
  updatedCanvases: number;
  createdFolders: number;
  reusedFolders: number;
  migratedAttachments: number;
  reusedAttachments: number;
  failedAttachments: number;
  currentPageTitle: string | null;
  currentStep: string | null;
  warnings: string[];
  unresolvedUsers: UnresolvedConfluenceUser[];
  pageResults: ConfluencePageResult[];
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  errorMessage?: string;
  result?: ConfluenceMigrationSummary;
}

export interface ConfluenceMigrationHistoryItem {
  canvasId: string;
  title: string;
  projectId: string | null;
  channelId: string | null;
  folderId: string | null;
  viewAccessId: string | null;
  spaceKey: string | null;
  confluencePageId: string | null;
  externalSourceUrl: string | null;
  lastImportedAt: string | null;
  updatedAt: string;
}

class ConfluenceMigrationService {
  async previewMigration(
    payload: ConfluenceMigrationPreviewRequest,
  ): Promise<ConfluenceMigrationPreviewResponse> {
    const response = await apiInstance.post<{
      success: true;
      data: ConfluenceMigrationPreviewResponse;
    }>(`${CONFLUENCE_MIGRATION_BASE_URL}/preview`, payload);

    return response.data.data;
  }

  async startMigration(
    payload: ConfluenceMigrationExecuteRequest,
  ): Promise<ConfluenceMigrationStartResponse> {
    const response = await apiInstance.post<{
      success: true;
      data: ConfluenceMigrationStartResponse;
    }>(`${CONFLUENCE_MIGRATION_BASE_URL}/execute`, payload);

    return response.data.data;
  }

  async getMigrationStatus(jobId: string): Promise<ConfluenceMigrationJobProgress> {
    const response = await apiInstance.get<{
      success: true;
      data: ConfluenceMigrationJobProgress;
    }>(`${CONFLUENCE_MIGRATION_BASE_URL}/status/${jobId}`);

    return response.data.data;
  }

  async getMigrationHistory(): Promise<ConfluenceMigrationHistoryItem[]> {
    const response = await apiInstance.get<{
      success: true;
      data: ConfluenceMigrationHistoryItem[];
    }>(`${CONFLUENCE_MIGRATION_BASE_URL}/history`);

    return response.data.data;
  }
}

export const confluenceMigrationService = new ConfluenceMigrationService();
