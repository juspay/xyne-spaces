import { config } from '@/config/env';
import { getStorageService } from '@/services/storage';
import { logger } from '@/utils/logger';

const JIRA_RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const JIRA_MAX_RETRY_ATTEMPTS = 5;
const JIRA_BASE_RETRY_DELAY_MS = 1000;
const JIRA_MAX_RETRY_DELAY_MS = 15000;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const escapeJqlString = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export const buildProjectJql = (projectKey: string, dateFrom?: string, issueKeys?: string[]): string => {
  const clauses = [`project = "${escapeJqlString(projectKey)}"`];

  if (dateFrom) {
    clauses.push(`created >= "${dateFrom}"`);
  }

  if (issueKeys && issueKeys.length > 0) {
    const escapedIssueKeys = issueKeys.map(key => `"${key.replace(/"/g, '\\"')}"`);
    clauses.push(`issuekey IN (${escapedIssueKeys.join(', ')})`);
  }

  return `${clauses.join(' AND ')} ORDER BY created ASC`;
};

export interface JiraIssueRecord {
  id: string;
  key: string;
  fields: Record<string, any>;
}

interface JiraSearchResponse {
  issues: JiraIssueRecord[];
  nextPageToken?: string;
  isLast?: boolean;
  maxResults?: number;
  total?: number;
}

export interface JiraCommentRecord {
  id: string;
  body?: unknown;
  created?: string;
  updated?: string;
  author?: {
    accountId?: string;
    displayName?: string;
    emailAddress?: string;
  };
}

interface JiraCommentResponse {
  startAt: number;
  maxResults: number;
  total: number;
  comments: JiraCommentRecord[];
}

export interface JiraFieldRecord {
  id: string;
  name: string;
  schema?: {
    type?: string;
    items?: string;
    custom?: string;
  };
}

const JIRA_LIGHTWEIGHT_INDEX_FIELDS = ['summary', 'status', 'reporter', 'creator', 'assignee', 'labels'] as const;

export interface JiraAttachmentRecord {
  id: string;
  filename: string;
  mimeType?: string;
  size?: number;
  created?: string;
  content?: string;
  author?: {
    accountId?: string;
    displayName?: string;
    emailAddress?: string;
  };
}

export class JiraMigrationClient {
  private buildHeaders(): Record<string, string> {
    const { migrationBotEmail, migrationBotAuthToken } = config.jira;
    if (!config.jira.baseUrl || !migrationBotEmail || !migrationBotAuthToken) {
      throw new Error('Jira migration requires JUSPAY_JIRA_BASEURL, JIRA_MIGRATION_BOT_EMAIL, and JIRA_MIGRATION_BOT_AUTH_TOKEN');
    }
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${migrationBotEmail}:${migrationBotAuthToken}`).toString('base64')}`,
    };
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

  async fetchJiraWithRetry(
    url: string,
    init?: RequestInit,
    context?: string,
    logPrefix = '[jira-migration][jira-api]',
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
        logger.warn(`${logPrefix} Retrying Jira request after retryable response`, {
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
        logger.warn(`${logPrefix} Retrying Jira request after network error`, {
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

  private async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchJiraWithRetry(
      `${config.jira.baseUrl}${path}`,
      {
        ...init,
        headers: { ...this.buildHeaders(), ...(init?.headers || {}) },
      },
      path,
      '[jira-migration][jira-api]',
    );
    return response.json() as Promise<T>;
  }

  async fetchIssuesPage(
    projectKey: string,
    requestPageToken?: string,
    maxResults: number = 100,
    dateFrom?: string,
    fields: string[] = ['*all'],
  ) {
    const result = await this.fetchJson<JiraSearchResponse>('/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify({
        jql: buildProjectJql(projectKey, dateFrom),
        maxResults,
        fields,
        ...(requestPageToken ? { nextPageToken: requestPageToken } : {}),
      }),
    });

    logger.info('[JiraMigrationImport] Jira search page fetched', {
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

  async fetchIssuesByKeys(
    projectKey: string,
    issueKeys: string[],
    dateFrom?: string,
    fields: string[] = ['*all'],
  ): Promise<JiraIssueRecord[]> {
    const uniqueIssueKeys = [...new Set(issueKeys.map(key => key.trim().toUpperCase()).filter(Boolean))];
    if (uniqueIssueKeys.length === 0) {
      return [];
    }
    const issueChunks: JiraIssueRecord[] = [];
    const chunkSize = 100;

    for (let index = 0; index < uniqueIssueKeys.length; index += chunkSize) {
      const issueKeyChunk = uniqueIssueKeys.slice(index, index + chunkSize);
      const result = await this.fetchJson<JiraSearchResponse>('/rest/api/3/search/jql', {
        method: 'POST',
        body: JSON.stringify({
          jql: buildProjectJql(projectKey, dateFrom, issueKeyChunk),
          maxResults: Math.min(issueKeyChunk.length, chunkSize),
          fields,
        }),
      });
      issueChunks.push(...result.issues);
    }

    logger.info('[JiraMigrationImport] Jira search page fetched for selected issue keys', {
      projectKey,
      requestedIssueKeyCount: uniqueIssueKeys.length,
      returnedIssueCount: issueChunks.length,
      sampleIssueKeys: issueChunks.slice(0, 10).map(issue => issue.key),
    });

    return issueChunks;
  }

  async fetchIssuesMetadataPage(
    projectKey: string,
    requestPageToken?: string,
    maxResults: number = 100,
    dateFrom?: string,
  ) {
    const result = await this.fetchJson<JiraSearchResponse>('/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify({
        jql: buildProjectJql(projectKey, dateFrom),
        maxResults,
        fields: [...JIRA_LIGHTWEIGHT_INDEX_FIELDS],
        ...(requestPageToken ? { nextPageToken: requestPageToken } : {}),
      }),
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

  async fetchFieldDefinitions(): Promise<JiraFieldRecord[]> {
    return this.fetchJson<JiraFieldRecord[]>('/rest/api/3/field');
  }

  async fetchAllComments(issueKey: string): Promise<JiraCommentRecord[]> {
    const comments: JiraCommentRecord[] = [];
    let startAt = 0;
    const maxResults = 100;
    let total = 0;

    do {
      const result = await this.fetchJson<JiraCommentResponse>(
        `/rest/api/3/issue/${issueKey}/comment?startAt=${startAt}&maxResults=${maxResults}`,
      );
      total = result.total;
      comments.push(...result.comments);
      startAt += result.comments.length;
      if (result.comments.length === 0) break;
    } while (comments.length < total);

    return comments;
  }

  async downloadAttachment(attachment: JiraAttachmentRecord, issueKey: string) {
    if (!attachment.content) {
      throw new Error(`Jira attachment ${attachment.id} does not have a content URL`);
    }

    const response = await this.fetchJiraWithRetry(
      attachment.content,
      {
        headers: this.buildHeaders(),
      },
      `attachment download for ${issueKey}/${attachment.id}`,
    );

    const buffer = Buffer.from(await response.arrayBuffer());
    const uploaded = await getStorageService().uploadFile(buffer, {
      filename: attachment.filename,
      contentType: attachment.mimeType || response.headers.get('content-type') || 'application/octet-stream',
      metadata: {
        jiraIssueKey: issueKey,
        jiraAttachmentId: attachment.id,
        importedAt: new Date().toISOString(),
      },
      scopeType: 'TICKET',
      scopeId: issueKey,
    });

    return {
      storagePath: uploaded.path,
      size: uploaded.size,
      filename: uploaded.filename,
      mimeType: attachment.mimeType || response.headers.get('content-type') || 'application/octet-stream',
    };
  }
}
