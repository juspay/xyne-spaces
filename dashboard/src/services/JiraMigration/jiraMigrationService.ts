import { API_BASE_URL, isLocalhost, isSandboxLocal, isTestEnv } from '../../config';
import { apiInstance } from '../clients/apiClient';

const JIRA_MIGRATION_BASE_URL = API_BASE_URL.replace(
  /\/api$/,
  isLocalhost || isTestEnv || isSandboxLocal
    ? '/api/migration/jira'
    : '/migrate/api/migration/jira',
);

export interface JiraMigrationFilters {
  reporterAccountIds?: string[];
  creatorAccountIds?: string[];
  assigneeAccountIds?: string[];
  labels?: string[];
}

export interface JiraMigrationPreviewResponse {
  jiraProject: {
    id: string;
    key: string;
    name: string;
    totalIssues: number;
  };
  jiraBoards: Array<{ id: number; name: string; type: string | null }>;
  selectedJiraBoardId: number | null;
  jiraStatusSequence: string[];
  jiraStatusSequenceSource: 'agile_board' | 'project_statuses' | 'fallback';
  target: {
    projectId: string;
    projectName: string;
    boardId: string;
    boardName: string;
    channelId: string;
    existingBoardCustomFields: Array<{
      id: string;
      name: string;
      fieldType: string;
      isOptional: boolean;
    }>;
    stages: Array<{
      id: string;
      name: string;
      sequenceNumber: number;
      defaultTicketStatusV2: string;
    }>;
  };
  coreMappings: Array<{
    jiraField: string;
    targetField: string;
    notes?: string;
  }>;
  statusMappings: Array<{
    jiraStatus: string;
    suggestedStageName: string | null;
    confidence: 'high' | 'medium' | 'low';
  }>;
  customFieldMappings: Array<{
    jiraFieldId: string;
    jiraFieldName: string;
    jiraFieldType: string;
    issueCoverageCount: number;
    sampleValues: string[];
    action: 'create_board_custom_field' | 'reuse_existing_board_custom_field' | 'store_in_metadata';
    suggestedXyneFieldName: string;
    suggestedXyneFieldType: string;
    matchedExistingFieldId?: string;
    reason: string;
  }>;
  issueSamples: Array<{
    id: string;
    key: string;
    summary: string;
    issueType: string;
    status: string;
    reporter: string | null;
    creator: string | null;
    assignee: string | null;
    labels: string[];
    commentCount: number;
    attachmentCount: number;
  }>;
  filterOptions: {
    reporters: Array<{
      accountId: string;
      displayName: string;
      emailAddress?: string;
    }>;
    creators: Array<{
      accountId: string;
      displayName: string;
      emailAddress?: string;
    }>;
    assignees: Array<{
      accountId: string;
      displayName: string;
      emailAddress?: string;
    }>;
    labels: string[];
  };
  appliedFilters: JiraMigrationFilters;
  filteredIssueCount: number;
  pagination: {
    pageSize: number;
    currentPageIssueCount: number;
    nextPageToken: string | null;
    hasNextPage: boolean;
    requestPageToken: string | null;
  };
}

export interface JiraMigrationPreviewRequest {
  jiraProjectKey: string;
  targetProjectId: string;
  targetBoardId: string;
  targetChannelId: string;
  jiraBoardId?: number;
  nextPageToken?: string;
  maxResults?: number;
  dateFrom?: string;
  filters?: JiraMigrationFilters;
  loadFilterOptions?: boolean;
}

export interface JiraMigrationExecuteRequest extends JiraMigrationPreviewRequest {
  issueKeys?: string[];
  statusV2Mappings: Record<string, string>;
  skipCustomFieldIds?: string[];
  jiraStatusSequence?: string[];
  excludedStageNames?: string[];
  userEmailMappings?: Record<string, string>;
}

export interface JiraMigrationIssueResult {
  issueKey: string;
  summary: string;
  status: 'completed' | 'partial' | 'failed';
  failedStep:
    | 'ticket'
    | 'ticket_resolution'
    | 'external_mapping'
    | 'form_values'
    | 'comments'
    | 'attachments'
    | 'comment_attachments'
    | null;
  errors: string[];
}

export interface JiraMigrationExecuteResponse {
  jiraProjectKey: string;
  externalSourceCreated: boolean;
  externalSourceId?: string;
  importedTickets: number;
  skippedTickets: number;
  importedComments: number;
  skippedComments: number;
  importedAttachments: number;
  skippedAttachments: number;
  createdBoardCustomFields: number;
  reusedBoardCustomFields: number;
  linkedTickets: number;
  createdSubTickets: number;
  unresolvedUsers: Array<{
    displayName: string | null;
    accountId: string | null;
    suggestedEmails: string[];
    issueKeys: string[];
  }>;
  issueResults: JiraMigrationIssueResult[];
  warnings: string[];
}

export interface JiraMigrationStartResponse {
  jobId: string;
}

export interface JiraMigrationResolveUsersRequest {
  jiraProjectKey: string;
  issueKeys?: string[];
  dateFrom?: string;
  includeComments?: boolean;
  includeAttachments?: boolean;
  nextPageToken?: string | null;
  pageSize?: number;
  userEmailMappings?: Record<string, string>;
}

export interface JiraMigrationResolveUsersResponse {
  jiraProjectKey: string;
  nextPageToken: string | null;
  hasNextPage: boolean;
  totalIssuesScanned: number;
  jiraUsersSeen: number;
  resolvedUsers: number;
  resolvedUserMappings: Array<{
    jiraUserKey: string;
    displayName: string | null;
    accountId: string | null;
    emailAddress: string | null;
    resolvedUserId: string;
    resolvedEmail: string | null;
  }>;
  resolvedUserMappingsTruncated: boolean;
  unresolvedUsers: Array<{
    displayName: string | null;
    accountId: string | null;
    suggestedEmails: string[];
    issueKeys: string[];
  }>;
}

export interface JiraMigrationHistoryItem {
  externalSourceId: string;
  jiraProjectKey: string;
  displayName: string;
  targetBoardId: string | null;
  targetChannelId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JiraMigrationJobProgress {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  controlStatus: 'running' | 'paused' | 'cancel_requested';
  jiraProjectKey: string;
  targetProjectId: string;
  targetBoardId: string;
  targetChannelId: string;
  issueKeys?: string[];
  stageSequence?: Array<{ sequenceNumber: number; name: string; defaultTicketStatusV2: string }>;
  totalIssues: number | null;
  processedIssues: number;
  importedTickets: number;
  skippedTickets: number;
  importedComments: number;
  skippedComments: number;
  importedAttachments: number;
  skippedAttachments: number;
  currentIssueKey: string | null;
  currentStep: string | null;
  warnings: string[];
  issueResults: JiraMigrationIssueResult[];
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  errorMessage?: string;
  result?: JiraMigrationExecuteResponse;
}

class JiraMigrationService {
  async previewMigration(
    payload: JiraMigrationPreviewRequest,
  ): Promise<JiraMigrationPreviewResponse> {
    const response = await apiInstance.post<{ success: true; data: JiraMigrationPreviewResponse }>(
      `${JIRA_MIGRATION_BASE_URL}/preview`,
      payload,
    );

    return response.data.data;
  }

  async startMigration(payload: JiraMigrationExecuteRequest): Promise<JiraMigrationStartResponse> {
    const response = await apiInstance.post<{ success: true; data: JiraMigrationStartResponse }>(
      `${JIRA_MIGRATION_BASE_URL}/execute`,
      payload,
    );

    return response.data.data;
  }

  async resolveUsers(
    payload: JiraMigrationResolveUsersRequest,
  ): Promise<JiraMigrationResolveUsersResponse> {
    const response = await apiInstance.post<{
      success: true;
      data: JiraMigrationResolveUsersResponse;
    }>(`${JIRA_MIGRATION_BASE_URL}/resolve-users`, payload);

    return response.data.data;
  }

  async getMigrationHistory(): Promise<JiraMigrationHistoryItem[]> {
    const response = await apiInstance.get<{ success: true; data: JiraMigrationHistoryItem[] }>(
      `${JIRA_MIGRATION_BASE_URL}/history`,
    );

    return response.data.data;
  }

  async getMigrationStatus(jobId: string): Promise<JiraMigrationJobProgress> {
    const response = await apiInstance.get<{ success: true; data: JiraMigrationJobProgress }>(
      `${JIRA_MIGRATION_BASE_URL}/status/${jobId}`,
    );

    return response.data.data;
  }

  async stopMigration(jobId: string): Promise<JiraMigrationJobProgress> {
    const response = await apiInstance.post<{ success: true; data: JiraMigrationJobProgress }>(
      `${JIRA_MIGRATION_BASE_URL}/stop/${jobId}`,
    );
    return response.data.data;
  }

  async pauseMigration(
    jobId: string,
    pauseForMs: number = 2 * 60 * 1000,
  ): Promise<JiraMigrationJobProgress> {
    const response = await apiInstance.post<{ success: true; data: JiraMigrationJobProgress }>(
      `${JIRA_MIGRATION_BASE_URL}/pause/${jobId}`,
      { pauseForMs },
    );
    return response.data.data;
  }

  async resumeMigration(jobId: string): Promise<JiraMigrationJobProgress> {
    const response = await apiInstance.post<{ success: true; data: JiraMigrationJobProgress }>(
      `${JIRA_MIGRATION_BASE_URL}/resume/${jobId}`,
    );
    return response.data.data;
  }
}

export const jiraMigrationService = new JiraMigrationService();
