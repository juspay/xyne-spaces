import { API_BASE_URL, isLocalhost, isSandboxLocal, isTestEnv } from '../../config';
import { apiInstance } from '../clients/apiClient';

// API_BASE_URL is expected to end with "/api". If it doesn't, fall back to appending it to avoid silently
// calling the wrong route.
const normalizedApiBaseUrl = API_BASE_URL.endsWith('/api')
  ? API_BASE_URL
  : `${API_BASE_URL.replace(/\/$/, '')}/api`;

const JIRA_MIGRATION_BASE_URL = normalizedApiBaseUrl.replace(
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
  epicKeys?: string[];
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
    epics: Array<{
      issueKey: string;
      summary: string;
    }>;
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
  issueKeys?: string[];
  jiraBoardId?: number;
  nextPageToken?: string;
  maxResults?: number;
  dateFrom?: string;
  filters?: JiraMigrationFilters;
  loadFilterOptions?: boolean;
}

export interface JiraMigrationBaseRequest {
  jiraProjectKey: string;
  targetProjectId: string;
  targetBoardId: string;
  targetChannelId: string;
  issueKeys?: string[];
  jiraBoardId?: number;
  dateFrom?: string;
  filters?: JiraMigrationFilters;
}

export interface JiraMigrationExecuteRequest extends JiraMigrationBaseRequest {
  issueKeys?: string[];
  statusV2Mappings: Record<string, string>;
  skipCustomFieldIds?: string[];
  jiraStatusSequence?: string[];
  excludedStageNames?: string[];
  userEmailMappings?: Record<string, string>;
  jiraBoardName?: string;
}

export interface JiraBoard {
  id: number;
  name: string;
  type: string | null;
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

export interface JiraMigrationBulkStartResponse {
  jobs: Array<{
    jobId: string;
    jiraProjectKey: string;
    jiraBoardId: number | null;
    jiraBoardName: string | null;
    targetProjectId: string;
    targetBoardId: string;
    targetChannelId: string;
  }>;
}

export interface JiraMigrationResolveUsersRequest {
  jiraProjectKey: string;
  issueKeys?: string[];
  dateFrom?: string;
  includeComments?: boolean;
  includeAttachments?: boolean;
  nextPageToken?: string | null;
  pageSize?: number;
  jiraBoardId?: number;
  boardStartAt?: number;
  userEmailMappings?: Record<string, string>;
}

export interface JiraMigrationResolveUsersResponse {
  jiraProjectKey: string;
  nextPageToken: string | null;
  hasNextPage: boolean;
  boardNextStartAt: number | null;
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

export interface JiraMigrationMoveChannelProjectRequest {
  channelId: string;
  sourceProjectId: string;
  targetProjectId: string;
  updatedAt?: string;
}

export interface JiraMigrationMoveChannelProjectResponse {
  updatedCount: number;
  channel: {
    id: string;
    name: string;
    projectId: string;
    isMigrated: boolean;
    updatedAt: string;
  } | null;
}

export interface JiraMigrationChangeTicketCreatedByRequest {
  ticketId: string;
  newCreatedByUserId: string;
  updatedAt?: string;
  cascadeConversationAndMessages?: boolean;
}

export interface JiraMigrationChangeTicketCreatedByResponse {
  updatedCount: number;
  cascadeConversationAndMessages?: boolean;
  conversationUpdatedCount?: number;
  messageUpdatedCount?: number;
  attachmentUpdatedCount?: number;
  ticket: {
    id: string;
    xyneId: string;
    title: string;
    projectId: string;
    channelId: string;
    createdBy: string;
    updatedBy: string;
    updatedAt: string;
  } | null;
}

export interface JiraMigrationMoveJiraProjectBoardRequest {
  jiraProjectKey: string;
  channelId: string;
  sourceBoardId: string;
  targetBoardId: string;
  tagNames?: string[];
  dryRun?: boolean;
  confirmText?: string;
}

export interface JiraMigrationMoveJiraProjectBoardResponse {
  dryRun: boolean;
  externalSourceId?: string;
  jiraProjectKey: string;
  channelId: string;
  sourceBoardId: string;
  targetBoardId: string;
  tagNames?: string[];
  movedTickets: number;
  missingStages: string[];
  warnings?: string[];
}

export interface JiraMigrationMoveJiraProjectChannelRequest {
  jiraProjectKey: string;
  sourceChannelId: string;
  targetChannelId: string;
  dryRun?: boolean;
  confirmText?: string;
}

export interface JiraMigrationMoveJiraProjectChannelResponse {
  dryRun: boolean;
  externalSourceId?: string;
  jiraProjectKey: string;
  sourceChannelId: string;
  sourceChannelName?: string;
  targetChannelId: string;
  targetChannelName?: string;
  movedTickets: number;
  movedConversations: number;
  movedParticipants: number;
  externalSourceUpdated: boolean;
  warnings?: string[];
}

export interface JiraMigrationPurgeProjectMigrationRequest {
  projectId: string;
  confirmText?: string;
  dryRun?: boolean;
  externalSourceId?: string;
  jiraProjectKey?: string;
}

export interface JiraMigrationPurgeProjectMigrationResponse {
  dryRun?: boolean;
  jobId?: string;
  stats: {
    projectId: string;
    channelCount: number;
    jiraExternalSourceCount: number;
    externalMessageCount: number;
    ticketCount: number;
    conversationCount: number;
    mappedMessageCount: number;
    mappedAttachmentCount: number;
  };
  externalSources?: Array<{ id: string; name: string; channelId: string | null }>;
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
  jiraBoardId?: number;
  jiraBoardName?: string;
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

  async startBulkMigration(payload: {
    jobs: JiraMigrationExecuteRequest[];
  }): Promise<JiraMigrationBulkStartResponse> {
    const response = await apiInstance.post<{
      success: true;
      data: JiraMigrationBulkStartResponse;
    }>(`${JIRA_MIGRATION_BASE_URL}/bulk-execute`, payload);

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

  async fetchBoards(projectKey: string): Promise<JiraBoard[]> {
    const response = await apiInstance.get<{ success: true; data: JiraBoard[] }>(
      `${JIRA_MIGRATION_BASE_URL}/boards?projectKey=${encodeURIComponent(projectKey)}`,
    );
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

  async moveChannelProject(
    payload: JiraMigrationMoveChannelProjectRequest,
  ): Promise<JiraMigrationMoveChannelProjectResponse> {
    const response = await apiInstance.post<{
      success: true;
      data: JiraMigrationMoveChannelProjectResponse;
    }>(`${JIRA_MIGRATION_BASE_URL}/move-channel-project`, payload);
    return response.data.data;
  }

  async changeTicketCreatedBy(
    payload: JiraMigrationChangeTicketCreatedByRequest,
  ): Promise<JiraMigrationChangeTicketCreatedByResponse> {
    const response = await apiInstance.post<{
      success: true;
      data: JiraMigrationChangeTicketCreatedByResponse;
    }>(`${JIRA_MIGRATION_BASE_URL}/change-ticket-created-by`, payload);
    return response.data.data;
  }

  async purgeProjectMigration(
    payload: JiraMigrationPurgeProjectMigrationRequest,
  ): Promise<JiraMigrationPurgeProjectMigrationResponse> {
    const response = await apiInstance.post<{
      success: true;
      data: JiraMigrationPurgeProjectMigrationResponse;
    }>(`${JIRA_MIGRATION_BASE_URL}/purge-project-migration`, payload);
    return response.data.data;
  }

  async moveJiraProjectBoard(
    payload: JiraMigrationMoveJiraProjectBoardRequest,
  ): Promise<JiraMigrationMoveJiraProjectBoardResponse> {
    const response = await apiInstance.post<{
      success: true;
      data: JiraMigrationMoveJiraProjectBoardResponse;
    }>(`${JIRA_MIGRATION_BASE_URL}/move-jira-project-board`, payload);
    return response.data.data;
  }

  async moveJiraProjectChannel(
    payload: JiraMigrationMoveJiraProjectChannelRequest,
  ): Promise<JiraMigrationMoveJiraProjectChannelResponse> {
    const response = await apiInstance.post<{
      success: true;
      data: JiraMigrationMoveJiraProjectChannelResponse;
    }>(`${JIRA_MIGRATION_BASE_URL}/move-jira-project-channel`, payload);
    return response.data.data;
  }
}

export const jiraMigrationService = new JiraMigrationService();
