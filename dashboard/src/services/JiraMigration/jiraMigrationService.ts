import { apiInstance } from '../clients/apiClient';

export interface JiraMigrationPreviewResponse {
  jiraProject: {
    id: string;
    key: string;
    name: string;
    totalIssues: number;
  };
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
    assignee: string | null;
    commentCount: number;
    attachmentCount: number;
  }>;
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
  nextPageToken?: string;
  maxResults?: number;
  dateFrom?: string;
}

export interface JiraMigrationExecuteRequest extends JiraMigrationPreviewRequest {
  issueKeys?: string[];
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
  }>;
  issueResults: JiraMigrationIssueResult[];
  warnings: string[];
}

export interface JiraMigrationStartResponse {
  jobId: string;
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
  jiraProjectKey: string;
  targetProjectId: string;
  targetBoardId: string;
  targetChannelId: string;
  issueKeys?: string[];
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
      '/migration/jira/preview',
      payload,
    );

    return response.data.data;
  }

  async startMigration(payload: JiraMigrationExecuteRequest): Promise<JiraMigrationStartResponse> {
    const response = await apiInstance.post<{ success: true; data: JiraMigrationStartResponse }>(
      '/migration/jira/execute',
      payload,
    );

    return response.data.data;
  }

  async getMigrationHistory(): Promise<JiraMigrationHistoryItem[]> {
    const response = await apiInstance.get<{ success: true; data: JiraMigrationHistoryItem[] }>(
      '/migration/jira/history',
    );

    return response.data.data;
  }

  async getMigrationStatus(jobId: string): Promise<JiraMigrationJobProgress> {
    const response = await apiInstance.get<{ success: true; data: JiraMigrationJobProgress }>(
      `/migration/jira/status/${jobId}`,
    );

    return response.data.data;
  }
}

export const jiraMigrationService = new JiraMigrationService();
