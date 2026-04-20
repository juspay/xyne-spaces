import { JiraMigrationClient } from '@/services/jira/client';

export interface JiraMigrationUserOption {
  accountId: string;
  displayName: string;
  emailAddress?: string;
}

export interface JiraMigrationFilters {
  reporterAccountIds?: string[];
  creatorAccountIds?: string[];
  assigneeAccountIds?: string[];
  labels?: string[];
}

export interface JiraMigrationProjectIssueIndexItem {
  id: string;
  key: string;
  summary: string;
  status: string;
  reporter: JiraMigrationUserOption | null;
  creator: JiraMigrationUserOption | null;
  assignee: JiraMigrationUserOption | null;
  labels: string[];
}

export interface JiraMigrationProjectIssueIndex {
  projectKey: string;
  dateFrom?: string;
  issues: JiraMigrationProjectIssueIndexItem[];
  generatedAt: string;
}

export interface JiraMigrationFilterOptions {
  reporters: JiraMigrationUserOption[];
  creators: JiraMigrationUserOption[];
  assignees: JiraMigrationUserOption[];
  labels: string[];
}

type CachedProjectIssueIndex = {
  expiresAt: number;
  value: JiraMigrationProjectIssueIndex;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const INDEX_PAGE_SIZE = 100;

const normalizeFilterValues = (values?: string[]): string[] =>
  [...new Set((values || []).map(value => value.trim()).filter(Boolean))];

const normalizeLabel = (label: string): string => label.trim().toLowerCase();

export class JiraMigrationProjectIndexService {
  private jiraClient = new JiraMigrationClient();
  private cache = new Map<string, CachedProjectIssueIndex>();

  private buildCacheKey(projectKey: string, dateFrom?: string): string {
    return `${projectKey.trim().toUpperCase()}:${dateFrom || ''}`;
  }

  private normalizeUserOption(user: {
    accountId?: string;
    displayName?: string;
    emailAddress?: string;
  } | null | undefined): JiraMigrationUserOption | null {
    if (!user?.accountId) {
      return null;
    }

    return {
      accountId: user.accountId,
      displayName: user.displayName?.trim() || user.emailAddress?.trim() || user.accountId,
      ...(user.emailAddress ? { emailAddress: user.emailAddress } : {}),
    };
  }

  private buildFilterOptions(issues: JiraMigrationProjectIssueIndexItem[]): JiraMigrationFilterOptions {
    const reportersById = new Map<string, JiraMigrationUserOption>();
    const creatorsById = new Map<string, JiraMigrationUserOption>();
    const assigneesById = new Map<string, JiraMigrationUserOption>();
    const labels = new Set<string>();

    for (const issue of issues) {
      if (issue.reporter?.accountId && !reportersById.has(issue.reporter.accountId)) {
        reportersById.set(issue.reporter.accountId, issue.reporter);
      }

      if (issue.creator?.accountId && !creatorsById.has(issue.creator.accountId)) {
        creatorsById.set(issue.creator.accountId, issue.creator);
      }

      if (issue.assignee?.accountId && !assigneesById.has(issue.assignee.accountId)) {
        assigneesById.set(issue.assignee.accountId, issue.assignee);
      }

      for (const label of issue.labels) {
        if (label.trim()) {
          labels.add(label.trim());
        }
      }
    }

    const sortUsers = (users: JiraMigrationUserOption[]) =>
      users.sort((left, right) =>
        left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' }),
      );

    return {
      reporters: sortUsers(Array.from(reportersById.values())),
      creators: sortUsers(Array.from(creatorsById.values())),
      assignees: sortUsers(Array.from(assigneesById.values())),
      labels: Array.from(labels).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' })),
    };
  }

  async getProjectIssueIndex(projectKey: string, dateFrom?: string): Promise<JiraMigrationProjectIssueIndex> {
    const cacheKey = this.buildCacheKey(projectKey, dateFrom);
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const issues: JiraMigrationProjectIssueIndexItem[] = [];
    let nextPageToken: string | undefined;

    do {
      const page = await this.jiraClient.fetchIssuesMetadataPage(
        projectKey,
        nextPageToken,
        INDEX_PAGE_SIZE,
        dateFrom,
      );

      issues.push(
        ...page.issues.map(issue => ({
          id: issue.id,
          key: issue.key,
          summary: issue.fields.summary || 'Untitled',
          status: issue.fields.status?.name || 'Unknown',
          reporter: this.normalizeUserOption(issue.fields.reporter),
          creator: this.normalizeUserOption(issue.fields.creator),
          assignee: this.normalizeUserOption(issue.fields.assignee),
          labels: Array.isArray(issue.fields.labels)
            ? issue.fields.labels.filter((label: unknown): label is string => typeof label === 'string')
            : [],
        })),
      );

      nextPageToken = page.hasNextPage ? page.nextPageToken || undefined : undefined;
    } while (nextPageToken);

    const value: JiraMigrationProjectIssueIndex = {
      projectKey: projectKey.trim().toUpperCase(),
      ...(dateFrom ? { dateFrom } : {}),
      issues,
      generatedAt: new Date().toISOString(),
    };

    this.cache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value,
    });

    return value;
  }

  filterIssues(
    index: JiraMigrationProjectIssueIndex,
    filters?: JiraMigrationFilters,
  ): JiraMigrationProjectIssueIndexItem[] {
    const reporterAccountIds = new Set(normalizeFilterValues(filters?.reporterAccountIds));
    const creatorAccountIds = new Set(normalizeFilterValues(filters?.creatorAccountIds));
    const assigneeAccountIds = new Set(normalizeFilterValues(filters?.assigneeAccountIds));
    const labels = new Set(normalizeFilterValues(filters?.labels).map(normalizeLabel));

    if (reporterAccountIds.size === 0 && creatorAccountIds.size === 0 && assigneeAccountIds.size === 0 && labels.size === 0) {
      return index.issues;
    }

    return index.issues.filter(issue => {
      const matchesReporter =
        reporterAccountIds.size > 0 &&
        Boolean(issue.reporter?.accountId && reporterAccountIds.has(issue.reporter.accountId));

      const matchesCreator =
        creatorAccountIds.size > 0 &&
        Boolean(issue.creator?.accountId && creatorAccountIds.has(issue.creator.accountId));

      const matchesAssignee =
        assigneeAccountIds.size > 0 &&
        Boolean(issue.assignee?.accountId && assigneeAccountIds.has(issue.assignee.accountId));

      const matchesLabel =
        labels.size > 0 &&
        Array.from(labels).some(label => issue.labels.map(normalizeLabel).includes(label));

      return matchesReporter || matchesCreator || matchesAssignee || matchesLabel;
    });
  }

  async getFilterOptions(projectKey: string, dateFrom?: string): Promise<JiraMigrationFilterOptions> {
    const index = await this.getProjectIssueIndex(projectKey, dateFrom);
    return this.buildFilterOptions(index.issues);
  }
}

export const jiraMigrationProjectIndexService = new JiraMigrationProjectIndexService();
