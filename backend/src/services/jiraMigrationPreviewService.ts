import { DatabaseClient } from '@/database/client';
import { config } from '@/config/env';
import { FormContextType, FormEntityType } from '@prisma/client';
import { logger } from '@/utils/logger';

const JIRA_RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const JIRA_MAX_RETRY_ATTEMPTS = 5;
const JIRA_BASE_RETRY_DELAY_MS = 1000;
const JIRA_MAX_RETRY_DELAY_MS = 15000;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

type JiraFieldDefinition = {
  id: string;
  key?: string;
  name: string;
  schema?: {
    type?: string;
    items?: string;
    system?: string;
    custom?: string;
  };
};

type JiraUser = {
  accountId?: string;
  displayName?: string;
  emailAddress?: string;
};

type JiraIssue = {
  id: string;
  key: string;
  fields: Record<string, any>;
};

type JiraProjectStatusesResponse = Array<{
  id: string;
  name: string;
  subtask: boolean;
  statuses: Array<{
    id: string;
    name: string;
    description?: string;
  }>;
}>;

type JiraSearchResponse = {
  issues: JiraIssue[];
  nextPageToken?: string;
  isLast?: boolean;
  maxResults?: number;
  total?: number;
};

type JiraProjectResponse = {
  id: string;
  key: string;
  name: string;
};

type JiraFieldSearchResponse = {
  values: JiraFieldDefinition[];
  startAt: number;
  maxResults: number;
  total: number;
  isLast?: boolean;
};

export interface JiraMigrationPreviewInput {
  jiraProjectKey: string;
  targetProjectId: string;
  targetBoardId: string;
  targetChannelId: string;
  nextPageToken?: string;
  maxResults?: number;
  dateFrom?: string;
}

export interface JiraMigrationPreviewResult {
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

const db = DatabaseClient.getInstance();

const CORE_FIELD_MAPPINGS: Array<{ jiraField: string; targetField: string; notes?: string }> = [
  { jiraField: 'summary', targetField: 'Ticket.title' },
  { jiraField: 'description', targetField: 'Ticket.description' },
  { jiraField: 'reporter', targetField: 'Ticket.createdBy', notes: 'Fallback equivalent for Jira reporter' },
  { jiraField: 'assignee', targetField: 'Ticket.assignedTo' },
  { jiraField: 'priority', targetField: 'Ticket.priority' },
  { jiraField: 'labels', targetField: 'TicketTag.name[]' },
  { jiraField: 'issuetype', targetField: 'Ticket.ticketType' },
  { jiraField: 'status', targetField: 'Ticket.stageName + Ticket.statusV2' },
  { jiraField: 'created', targetField: 'Ticket.createdAt' },
  { jiraField: 'updated', targetField: 'Ticket.updatedAt' },
  { jiraField: 'parent', targetField: 'TicketSubTicketMapping / metadata' },
  { jiraField: 'attachment', targetField: 'MessageAttachment / ticket attachment import' },
  { jiraField: 'comment', targetField: 'conversation messages' },
];

const PREVIEW_BASE_ISSUE_FIELDS = [
  'summary',
  'status',
  'issuetype',
  'reporter',
  'assignee',
  'comment',
  'attachment',
  'labels',
  'parent',
  'issuelinks',
] as const;

const buildPreviewIssueFields = (fieldDefinitions: JiraFieldDefinition[]): string[] => {
  const customFieldIds = fieldDefinitions
    .map(field => field.id)
    .filter(fieldId => fieldId.startsWith('customfield_'));

  return [...PREVIEW_BASE_ISSUE_FIELDS, ...customFieldIds];
};

const PREVIEW_CUSTOM_FIELD_SAMPLE_LIMIT = 10;

const BOARD_FIELD_TYPE_MAP: Record<string, string> = {
  string: 'STRING',
  number: 'NUMBER',
  date: 'DATE',
  datetime: 'DATE',
  option: 'SINGLE_SELECT',
  array: 'MULTI_SELECT',
  user: 'USER',
  boolean: 'BOOLEAN',
};

const sanitizeFieldName = (value: string): string =>
  value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s-]/g, '')
    .trim();

const normalize = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

const JIRA_CUSTOM_FIELD_NAME_SKIP_PATTERNS = [
  'rank',
  'epiclink',
  'epiclinkdeprecated',
  'development',
  'timeinstatus',
  'charttimeinstatus',
  'requiredfields',
  'go-livechecklist',
  'golivechecklist',
  'checklistsheet',
];

const JIRA_CUSTOM_FIELD_CUSTOM_SCHEMA_SKIP_PATTERNS = [
  'lexorank',
  'epiclink',
  'development',
  'timeinstatus',
];

const isOpaqueJiraCustomFieldString = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return true;

  return (
    /\{[a-z]+\=/.test(trimmed) ||
    trimmed.includes('json={"cachedValue"') ||
    trimmed.includes('summary={') ||
    trimmed.includes('dataType=')
  );
};

const shouldSkipJiraCustomField = (definition?: JiraFieldDefinition): boolean => {
  if (!definition) return false;

  const normalizedName = normalize(definition.name || '');
  const normalizedCustom = normalize(definition.schema?.custom || '');

  return (
    JIRA_CUSTOM_FIELD_NAME_SKIP_PATTERNS.some(pattern => normalizedName.includes(pattern)) ||
    JIRA_CUSTOM_FIELD_CUSTOM_SCHEMA_SKIP_PATTERNS.some(pattern => normalizedCustom.includes(pattern))
  );
};

const valueToPreviewString = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => valueToPreviewString(item))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.displayName === 'string') return obj.displayName;
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.value === 'string') return obj.value;
    if (typeof obj.key === 'string') return obj.key;
    if (typeof obj.id === 'string') return obj.id;
    return JSON.stringify(obj);
  }
  return String(value);
};

const inferXyneFieldType = (field: JiraFieldDefinition, sampleValues: string[]): string => {
  const schemaType = field.schema?.type;
  const schemaItems = field.schema?.items;

  if (schemaType === 'array' && schemaItems === 'user') return 'USER';
  if (schemaType === 'user') return 'USER';
  if (schemaType && BOARD_FIELD_TYPE_MAP[schemaType]) return BOARD_FIELD_TYPE_MAP[schemaType];
  if (schemaType === 'array') return 'MULTI_SELECT';

  const hasBoolean = sampleValues.some(v => v === 'true' || v === 'false');
  if (hasBoolean) return 'BOOLEAN';

  const hasOnlyNumbers = sampleValues.length > 0 && sampleValues.every(v => /^-?\d+(\.\d+)?$/.test(v));
  if (hasOnlyNumbers) return 'NUMBER';

  return 'STRING';
};


const escapeJqlString = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const buildProjectJql = (projectKey: string, dateFrom?: string): string => {
  const clauses = [`project = "${escapeJqlString(projectKey)}"`];

  if (dateFrom) {
    clauses.push(`created >= "${dateFrom}"`);
  }

  return `${clauses.join(' AND ')} ORDER BY created ASC`;
};

const inferStatusMatch = (
  jiraStatus: string,
  stages: Array<{ name: string }>,
): { suggestedStageName: string | null; confidence: 'high' | 'medium' | 'low' } => {
  const exact = stages.find(stage => normalize(stage.name) === normalize(jiraStatus));
  if (exact) {
    return { suggestedStageName: exact.name, confidence: 'high' };
  }

  const contains = stages.find(stage => {
    const stageValue = normalize(stage.name);
    const jiraValue = normalize(jiraStatus);
    return stageValue.includes(jiraValue) || jiraValue.includes(stageValue);
  });

  if (contains) {
    return { suggestedStageName: contains.name, confidence: 'medium' };
  }

  return { suggestedStageName: null, confidence: 'low' };
};

export class JiraMigrationPreviewService {
  private buildHeaders(): Record<string, string> {
    const { migrationBotEmail, migrationBotAuthToken } = config.jira;
    if (!config.jira.baseUrl || !migrationBotEmail || !migrationBotAuthToken) {
      throw new Error('Jira migration preview requires JUSPAY_JIRA_BASEURL, JIRA_MIGRATION_BOT_EMAIL, and JIRA_MIGRATION_BOT_AUTH_TOKEN');
    }

    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${migrationBotEmail}:${migrationBotAuthToken}`).toString('base64')}`,
    };
  }

  private async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchJiraWithRetry(`${config.jira.baseUrl}${path}`, {
      ...init,
      headers: {
        ...this.buildHeaders(),
        ...(init?.headers || {}),
      },
    }, path);

    return response.json() as Promise<T>;
  }

  private parseRetryAfterMs(value: string | null): number | null {
    if (!value) return null;

    const seconds = Number(value);
    if (!Number.isNaN(seconds) && seconds >= 0) {
      return seconds * 1000;
    }

    const retryAt = Date.parse(value);
    if (Number.isNaN(retryAt)) {
      return null;
    }

    return Math.max(0, retryAt - Date.now());
  }

  private computeRetryDelayMs(attempt: number, retryAfterHeader: string | null): number {
    const retryAfterMs = this.parseRetryAfterMs(retryAfterHeader);
    if (retryAfterMs !== null) {
      return Math.min(retryAfterMs, JIRA_MAX_RETRY_DELAY_MS);
    }

    const exponentialDelay = Math.min(
      JIRA_BASE_RETRY_DELAY_MS * 2 ** (attempt - 1),
      JIRA_MAX_RETRY_DELAY_MS,
    );
    const jitter = Math.floor(Math.random() * 250);
    return Math.min(exponentialDelay + jitter, JIRA_MAX_RETRY_DELAY_MS);
  }

  private async fetchJiraWithRetry(
    url: string,
    init?: RequestInit,
    context?: string,
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= JIRA_MAX_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(url, init);

        if (response.ok) {
          return response;
        }

        if (!JIRA_RETRYABLE_STATUS_CODES.has(response.status) || attempt === JIRA_MAX_RETRY_ATTEMPTS) {
          const errorText = await response.text();
          throw new Error(`Jira request failed (${response.status})${context ? ` during ${context}` : ''}: ${errorText}`);
        }

        const delayMs = this.computeRetryDelayMs(attempt, response.headers.get('Retry-After'));
        logger.warn('[JiraMigrationPreview] Retrying Jira request after retryable response', {
          context,
          attempt,
          maxAttempts: JIRA_MAX_RETRY_ATTEMPTS,
          statusCode: response.status,
          delayMs,
          url,
        });
        await sleep(delayMs);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        lastError = err;

        const isRetryableNetworkError = !('message' in err) || !err.message.includes('Jira request failed (');
        if (!isRetryableNetworkError || attempt === JIRA_MAX_RETRY_ATTEMPTS) {
          throw err;
        }

        const delayMs = this.computeRetryDelayMs(attempt, null);
        logger.warn('[JiraMigrationPreview] Retrying Jira request after network error', {
          context,
          attempt,
          maxAttempts: JIRA_MAX_RETRY_ATTEMPTS,
          delayMs,
          url,
          error: err.message,
        });
        await sleep(delayMs);
      }
    }

    throw lastError || new Error(`Jira request failed${context ? ` during ${context}` : ''}`);
  }

  private async fetchAllProjectStatuses(projectKey: string): Promise<Set<string>> {
    try {
      const issueTypes = await this.fetchJson<JiraProjectStatusesResponse>(
        `/rest/api/3/project/${encodeURIComponent(projectKey)}/statuses`,
      );
      const allStatuses = new Set<string>();
      for (const issueType of issueTypes) {
        for (const status of issueType.statuses) {
          if (typeof status.name === 'string' && status.name.trim()) {
            allStatuses.add(status.name.trim());
          }
        }
      }
      return allStatuses;
    } catch (err) {
      logger.warn('[JiraMigrationPreview] Failed to fetch project statuses from API, will fall back to statuses seen in issues', { projectKey, err });
      return new Set<string>();
    }
  }

  private async fetchAllProjectCustomFields(projectKey: string): Promise<JiraFieldDefinition[]> {
    try {
      const project = await this.fetchJson<JiraProjectResponse>(
        `/rest/api/3/project/${encodeURIComponent(projectKey)}`,
      );

      const fields: JiraFieldDefinition[] = [];
      let startAt = 0;
      const maxResults = 100;

      while (true) {
        const response = await this.fetchJson<JiraFieldSearchResponse>(
          `/rest/api/3/field/search?type=custom&projectIds=${encodeURIComponent(project.id)}&startAt=${startAt}&maxResults=${maxResults}`,
        );

        fields.push(...response.values.filter(field => field.id.startsWith('customfield_')));

        const hasMoreByCount = response.startAt + response.values.length < response.total;
        const hasMoreByFlag = response.isLast === false;
        if (!hasMoreByCount && !hasMoreByFlag) {
          break;
        }

        startAt += response.values.length;
        if (response.values.length === 0) {
          break;
        }
      }

      return fields;
    } catch (err) {
      logger.warn('[JiraMigrationPreview] Failed to fetch project custom fields from API, will fall back to issue-sampled custom fields', { projectKey, err });
      return [];
    }
  }

  private async fetchIssuesPage(
    projectKey: string,
    fields: string[],
    requestPageToken?: string,
    maxResults: number = 25,
    dateFrom?: string,
  ): Promise<{
    total: number;
    issues: JiraIssue[];
    nextPageToken: string | null;
    hasNextPage: boolean;
    pageSize: number;
    requestPageToken: string | null;
  }> {
    const result = await this.fetchJson<JiraSearchResponse>('/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify({
        jql: buildProjectJql(projectKey, dateFrom),
        maxResults,
        fields,
        ...(requestPageToken ? { nextPageToken: requestPageToken } : {}),
      }),
    });

    logger.info('[JiraMigrationPreview] Jira search page fetched', {
      projectKey,
      maxResults,
      nextPageTokenPresent: Boolean(requestPageToken),
      returnedIssueCount: result.issues.length,
      total: result.total,
      isLast: result.isLast,
      responseNextPageTokenPresent: Boolean(result.nextPageToken),
      sampleIssueKeys: result.issues.slice(0, 5).map(issue => issue.key),
    });

    return {
      total: typeof result.total === 'number' ? result.total : result.issues.length,
      issues: result.issues,
      nextPageToken: result.nextPageToken || null,
      hasNextPage: result.isLast !== true && Boolean(result.nextPageToken),
      pageSize: maxResults,
      requestPageToken: requestPageToken || null,
    };
  }

  async preview(input: JiraMigrationPreviewInput): Promise<JiraMigrationPreviewResult> {
    const jiraProjectKey = input.jiraProjectKey.trim().toUpperCase();
    const pageSize = Math.min(Math.max(input.maxResults || 25, 1), 100);

    const [project, board, channel, boardStages, fieldDefinitions, existingBoardFields, allProjectStatuses, allProjectCustomFields] = await Promise.all([
      db.project.findUnique({ where: { id: input.targetProjectId } }),
      db.board.findUnique({ where: { id: input.targetBoardId } }),
      db.channel.findUnique({ where: { id: input.targetChannelId } }),
      db.stage.findMany({
        where: { boardId: input.targetBoardId },
        orderBy: { sequenceNumber: 'asc' },
      }),
      this.fetchJson<JiraFieldDefinition[]>('/rest/api/3/field'),
      db.$queryRaw<Array<{ id: string; fieldName: string; fieldType: string; isOptional: boolean }>>`
        SELECT ff.id, ff."fieldName", ff."fieldType", ff."isOptional"
        FROM public.form_fields ff
        INNER JOIN public.forms_context_mapping fcm ON fcm."formId" = ff."formId"
        WHERE fcm."contextId" = ${input.targetBoardId}
          AND fcm."contextType" = CAST(${FormContextType.BOARD} AS "FormContextType")
          AND fcm."entityType" = CAST(${FormEntityType.TICKET} AS "FormEntityType")
        ORDER BY ff."createdAt" ASC
      `,
      this.fetchAllProjectStatuses(jiraProjectKey),
      this.fetchAllProjectCustomFields(jiraProjectKey),
    ]);

    if (!project) throw new Error('Target project not found');
    if (!board) throw new Error('Target board not found');
    if (!channel) throw new Error('Target channel not found');

    const issueData = await this.fetchIssuesPage(
      jiraProjectKey,
      buildPreviewIssueFields(fieldDefinitions),
      input.nextPageToken,
      pageSize,
      input.dateFrom,
    );

    const fieldDefinitionMap = new Map(fieldDefinitions.map(field => [field.id, field]));
    const customFieldStats = new Map<
      string,
      { values: Set<string>; issueCoverageCount: number }
    >();
    const seenStatuses = new Set<string>();

    for (const issue of issueData.issues) {
      const statusName = issue.fields.status?.name;
      if (typeof statusName === 'string' && statusName.trim()) {
        seenStatuses.add(statusName);
      }

      for (const [fieldId, rawValue] of Object.entries(issue.fields)) {
        if (!fieldId.startsWith('customfield_')) continue;
        if (shouldSkipJiraCustomField(fieldDefinitionMap.get(fieldId))) continue;
        if (rawValue === null || rawValue === undefined) continue;
        if (Array.isArray(rawValue) && rawValue.length === 0) continue;
        if (typeof rawValue === 'string' && rawValue.trim() === '') continue;

        const stat = customFieldStats.get(fieldId) || {
          values: new Set<string>(),
          issueCoverageCount: 0,
        };

        stat.issueCoverageCount += 1;

        const previewValue = valueToPreviewString(rawValue);
        if (previewValue && isOpaqueJiraCustomFieldString(previewValue)) {
          continue;
        }
        if (previewValue && stat.values.size < PREVIEW_CUSTOM_FIELD_SAMPLE_LIMIT) {
          stat.values.add(previewValue);
        }

        customFieldStats.set(fieldId, stat);
      }
    }

    const allCustomFieldIds = new Set<string>([
      ...Array.from(customFieldStats.keys()),
      ...allProjectCustomFields
        .filter(field => !shouldSkipJiraCustomField(field))
        .map(field => field.id),
    ]);

    const customFieldMappings = Array.from(allCustomFieldIds)
      .map((fieldId) => {
        const definition = fieldDefinitionMap.get(fieldId) || allProjectCustomFields.find(field => field.id === fieldId);
        const jiraFieldName = definition?.name || fieldId;
        const stats = customFieldStats.get(fieldId);
        const sampleValues = Array.from(stats?.values || []).slice(0, 5);
        const suggestedXyneFieldName = sanitizeFieldName(jiraFieldName);
        const suggestedXyneFieldType = inferXyneFieldType(
          definition || { id: fieldId, name: jiraFieldName },
          sampleValues,
        );

        const matchedExistingField = existingBoardFields.find(
          field => normalize(field.fieldName) === normalize(suggestedXyneFieldName),
        );

        const isComplexUnsupported =
          definition?.schema?.custom?.includes('cascadingselect') ||
          definition?.schema?.custom?.includes('grouppicker') ||
          definition?.schema?.custom?.includes('version') ||
          definition?.schema?.custom?.includes('project');

        if (matchedExistingField) {
          return {
            jiraFieldId: fieldId,
            jiraFieldName,
            jiraFieldType: definition?.schema?.type || 'unknown',
            issueCoverageCount: stats?.issueCoverageCount || 0,
            sampleValues,
            action: 'reuse_existing_board_custom_field' as const,
            suggestedXyneFieldName,
            suggestedXyneFieldType,
            matchedExistingFieldId: matchedExistingField.id,
            reason: 'Board already has a custom field with the same normalized name',
          };
        }

        if (isComplexUnsupported) {
          return {
            jiraFieldId: fieldId,
            jiraFieldName,
            jiraFieldType: definition?.schema?.type || 'unknown',
            issueCoverageCount: stats?.issueCoverageCount || 0,
            sampleValues,
            action: 'store_in_metadata' as const,
            suggestedXyneFieldName,
            suggestedXyneFieldType,
            reason: 'Field type is not a clean board-form fit and should be preserved in metadata',
          };
        }

        return {
          jiraFieldId: fieldId,
          jiraFieldName,
          jiraFieldType: definition?.schema?.type || 'unknown',
          issueCoverageCount: stats?.issueCoverageCount || 0,
          sampleValues,
          action: 'create_board_custom_field' as const,
          suggestedXyneFieldName,
          suggestedXyneFieldType,
          reason: 'Standard Jira custom field that can be represented as a board custom field',
        };
      })
      .sort((a, b) => a.jiraFieldName.localeCompare(b.jiraFieldName));

    // Merge statuses from the project API (complete list) with statuses seen in this page's issues
    const allStatuses = new Set([...allProjectStatuses, ...seenStatuses]);

    const statusMappings = Array.from(allStatuses)
      .sort((a, b) => a.localeCompare(b))
      .map(status => ({
        jiraStatus: status,
        ...inferStatusMatch(status, boardStages),
      }));

    const issueSamples = issueData.issues.slice(0, 25).map(issue => ({
      id: issue.id,
      key: issue.key,
      summary: issue.fields.summary || 'Untitled',
      issueType: issue.fields.issuetype?.name || 'Unknown',
      status: issue.fields.status?.name || 'Unknown',
      reporter: (issue.fields.reporter as JiraUser | undefined)?.displayName || null,
      assignee: (issue.fields.assignee as JiraUser | undefined)?.displayName || null,
      commentCount: issue.fields.comment?.total || 0,
      attachmentCount: Array.isArray(issue.fields.attachment) ? issue.fields.attachment.length : 0,
    }));

    return {
      jiraProject: {
        id: jiraProjectKey,
        key: jiraProjectKey,
        name: jiraProjectKey,
        totalIssues: issueData.total,
      },
      target: {
        projectId: project.id,
        projectName: project.name,
        boardId: board.id,
        boardName: board.name,
        channelId: channel.id,
        existingBoardCustomFields: existingBoardFields.map(field => ({
          id: field.id,
          name: field.fieldName,
          fieldType: field.fieldType,
          isOptional: field.isOptional,
        })),
        stages: boardStages.map(stage => ({
          id: stage.id,
          name: stage.name,
          sequenceNumber: stage.sequenceNumber,
          defaultTicketStatusV2: stage.defaultTicketStatusV2,
        })),
      },
      coreMappings: CORE_FIELD_MAPPINGS,
      statusMappings,
      customFieldMappings,
      issueSamples,
      pagination: {
        pageSize: issueData.pageSize,
        currentPageIssueCount: issueData.issues.length,
        nextPageToken: issueData.nextPageToken,
        hasNextPage: issueData.hasNextPage,
        requestPageToken: issueData.requestPageToken,
      },
    };
  }
}

export const jiraMigrationPreviewService = new JiraMigrationPreviewService();
