/**
 * createWorkflowClient — typed HTTP client for the workflow router.
 *
 * Framework-agnostic: works in browsers, Node, Deno, Bun — anywhere
 * that has a global `fetch`. The UI hooks wrap this with TanStack Query
 * for caching/polling; this layer is pure fetch + type safety.
 */

import { buildUrl } from './url.js';
import { createEventsClient } from './events-client.js';
import type {
  // ── Other types ──
  ExecutionDetail,
  ActivationOutcome,
  AdvanceConversation,
  AnalyticsClient,
  AnalyticsSummaryResult,
  ApprovalAnalyticsResult,
  ConnectorCredentialTypes,
  CreateCredentialRequest,
  CreateFolderInput,
  CreateWorkflowInput,
  CredentialListResponse,
  CredentialSummary,
  CredentialsClient,
  ExecutionListParams,
  ExecutionRecord,
  ExecutionsClient,
  FieldOptionsRequest,
  FolderRecord,
  FoldersClient,
  LastRun,
  PaginatedList,
  PendingApprovalCountParams,
  PendingApprovalFacets,
  PendingApprovalParams,
  PendingApprovalSummary,
  PendingWorkflowSummary,
  ReplaceCredentialValuesInput,
  RequestOpts,
  RerunInput,
  ResumeInput,
  SchemaClient,
  StepEvent,
  TopError,
  TriggerV2Input,
  UpdateFolderInput,
  UpdateWorkflowInput,
  UploadsClient,
  WorkflowClient,
  WorkflowClientConfig,
  WorkflowCounts,
  WorkflowRecord,
  WorkflowsCrudClient,
} from './types.js';
import type { ConversationsClient } from './types.js';
import type { ConversationStreamEvent, Turn } from '../conversational-flow/turn.js';
import { readSSE } from './sse.js';
import type { Action } from '../authz/types.js';
import type { WorkflowConfig } from '../types/workflow-config.js';
import type { FieldOptionsPage } from '../schema/options.js';
import type { StepSummary, StepDescriptor } from '../steps/step-descriptor.js';
import type { TriggerSummary, TriggerDescriptor } from '../triggers/trigger-descriptor.js';
import type { OperatorDescriptor } from '../types/operators.js';
import type { AvailableContext } from '../engine/available-context.js';
import type { ValidationResult } from '../types/validation.js';
import type { Attachment } from '../common/attachment.js';

// ─── Error ───

export class WorkflowClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'WorkflowClientError';
  }
}

// ─── Internal helpers ───

interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
  /** Abort the in-flight request, so a superseded read really stops. */
  signal?: AbortSignal | undefined;
}


async function request<T>(
  config: WorkflowClientConfig,
  opts: RequestOptions,
): Promise<T> {
  const fetchFn = config.fetch ?? globalThis.fetch;
  const headers = await config.getHeaders();
  const url = buildUrl(config.baseUrl, opts.path, opts.query);

  const init: RequestInit = {
    method: opts.method,
    headers: {
      ...headers,
      // Only on writes: a read causes no change event, and keeping the header off
      // GETs leaves them byte-identical between clients and so still cacheable.
      ...(opts.method !== 'GET' && config.origin
        ? { 'X-Workflow-Origin': config.origin }
        : {}),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  };

  const response = await fetchFn(url, init);

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json() as unknown;
    } catch {
      body = await response.text();
    }
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${String(response.status)}`;
    throw new WorkflowClientError(message, response.status, body);
  }

  // 204 No Content — return undefined
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

/** Encode paging onto a query. Cursor only, everywhere. */
function pageQuery(params?: { limit?: number; cursor?: string }): Record<string, string | undefined> {
  return {
    limit: params?.limit?.toString(),
    cursor: params?.cursor,
  };
}

/** Encode a list parameter the router reads with `parseIdList`. */
function listQuery(values?: readonly string[]): string | undefined {
  return values && values.length > 0 ? values.join(',') : undefined;
}

// ─── Client Factory ───

function createSchemaClient(config: WorkflowClientConfig): SchemaClient {
  return {
    async steps(): Promise<StepSummary[]> {
      const res = await request<{ steps: StepSummary[] }>(config, {
        method: 'GET',
        path: '/schema/steps',
      });
      return res.steps;
    },

    async step(type: string): Promise<StepDescriptor> {
      return request<StepDescriptor>(config, {
        method: 'GET',
        path: `/schema/steps/${encodeURIComponent(type)}`,
      });
    },

    async triggers(): Promise<TriggerSummary[]> {
      const res = await request<{ triggers: TriggerSummary[] }>(config, {
        method: 'GET',
        path: '/schema/triggers',
      });
      return res.triggers;
    },

    async trigger(type: string): Promise<TriggerDescriptor> {
      return request<TriggerDescriptor>(config, {
        method: 'GET',
        path: `/schema/triggers/${encodeURIComponent(type)}`,
      });
    },

    async credentialTypes(): Promise<ConnectorCredentialTypes[]> {
      const res = await request<{ connectors: ConnectorCredentialTypes[] }>(config, {
        method: 'GET',
        path: '/schema/credentials',
      });
      return res.connectors;
    },

    async operators(): Promise<OperatorDescriptor[]> {
      const res = await request<{ operators: OperatorDescriptor[] }>(config, {
        method: 'GET',
        path: '/schema/operators',
      });
      return res.operators;
    },

    async availableContext(
      workflowConfig: WorkflowConfig,
      atStepId: string,
    ): Promise<AvailableContext | null> {
      const res = await request<{ context: AvailableContext | null }>(config, {
        method: 'POST',
        path: '/schema/available-context',
        body: { config: workflowConfig, atStepId },
      });
      return res.context;
    },

    async fieldOptions(input: FieldOptionsRequest): Promise<FieldOptionsPage> {
      const { kind, type, ...body } = input;
      return request<FieldOptionsPage>(config, {
        method: 'POST',
        path: `/schema/${kind}/${encodeURIComponent(type)}/options`,
        body,
      });
    },
  };
}

function createWorkflowsCrudClient(
  config: WorkflowClientConfig,
): WorkflowsCrudClient {
  return {
    async list(
      params?: { folderId?: string; limit?: number; cursor?: string },
      opts?: RequestOpts,
    ): Promise<PaginatedList<WorkflowRecord>> {
      const res = await request<{ workflows: WorkflowRecord[]; nextCursor?: string }>(config, {
        method: 'GET',
        path: '/workflows',
        query: { ...pageQuery(params), folderId: params?.folderId },
        signal: opts?.signal,
      });
      return { items: res.workflows, ...(res.nextCursor !== undefined ? { nextCursor: res.nextCursor } : {}) };
    },

    async counts(opts?: RequestOpts): Promise<WorkflowCounts> {
      return request<WorkflowCounts>(config, {
        method: 'GET',
        path: '/workflows/counts',
        signal: opts?.signal,
      });
    },

    async lastRuns(
      params?: { folderId?: string; workflowIds?: readonly string[] },
      opts?: RequestOpts,
    ): Promise<Record<string, LastRun>> {
      const res = await request<{ lastRuns: Record<string, LastRun> }>(config, {
        method: 'GET',
        path: '/workflows/last-runs',
        query: {
          folderId: params?.folderId,
          workflowIds: listQuery(params?.workflowIds),
        },
        signal: opts?.signal,
      });
      return res.lastRuns;
    },

    async get(id: string, opts?: RequestOpts): Promise<WorkflowRecord> {
      return request<WorkflowRecord>(config, {
        method: 'GET',
        path: `/workflows/${encodeURIComponent(id)}`,
        signal: opts?.signal,
      });
    },

    async create(input: CreateWorkflowInput): Promise<WorkflowRecord> {
      return request<WorkflowRecord>(config, {
        method: 'POST',
        path: '/workflows',
        body: input,
      });
    },

    async update(id: string, input: UpdateWorkflowInput): Promise<WorkflowRecord> {
      return request<WorkflowRecord>(config, {
        method: 'PUT',
        path: `/workflows/${encodeURIComponent(id)}`,
        body: input,
      });
    },

    async validate(
      workflowConfig: WorkflowConfig,
      workflowId?: string,
    ): Promise<ValidationResult> {
      return request<ValidationResult>(config, {
        method: 'POST',
        path:
          workflowId === undefined
            ? '/workflows/validate'
            : `/workflows/validate?workflowId=${encodeURIComponent(workflowId)}`,
        body: workflowConfig,
      });
    },

    async activate(id: string): Promise<ActivationOutcome> {
      return request<ActivationOutcome>(config, {
        method: 'POST',
        path: `/workflows/${encodeURIComponent(id)}/activate`,
      });
    },

    async deactivate(id: string): Promise<void> {
      await request<{ deactivated: boolean }>(config, {
        method: 'POST',
        path: `/workflows/${encodeURIComponent(id)}/deactivate`,
      });
    },

    async listPending(
      params?: { limit?: number; cursor?: string },
      opts?: RequestOpts,
    ): Promise<PaginatedList<PendingWorkflowSummary>> {
      return request<PaginatedList<PendingWorkflowSummary>>(config, {
        method: 'GET',
        path: '/workflows/pending',
        query: pageQuery(params),
        signal: opts?.signal,
      });
    },

    async approve(id: string): Promise<void> {
      await request<{ approved: boolean }>(config, {
        method: 'POST',
        path: `/workflows/${encodeURIComponent(id)}/approve`,
      });
    },

    async reject(id: string): Promise<void> {
      await request<{ rejected: boolean }>(config, {
        method: 'POST',
        path: `/workflows/${encodeURIComponent(id)}/reject`,
      });
    },

    async trigger(
      id: string,
      payload?: Record<string, unknown>,
    ): Promise<{ executionId: string }> {
      return request<{ executionId: string }>(config, {
        method: 'POST',
        path: `/workflows/${encodeURIComponent(id)}/trigger`,
        body: payload ?? {},
      });
    },

    async triggerV2(
      workflowId: string,
      input: TriggerV2Input,
    ): Promise<{ executionId: string }> {
      const fetchFn = config.fetch ?? globalThis.fetch;
      const headers = await config.getHeaders();
      const stripped: Record<string, string> = {};
      for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() !== 'content-type') stripped[k] = v;
      }

      const form = new FormData();
      for (const [key, value] of Object.entries(input.payload)) {
        appendMultipartField(form, key, value);
      }

      const url = buildUrl(
        config.baseUrl,
        `/v2/workflows/${encodeURIComponent(workflowId)}/trigger/v2`,
      );
      const response = await fetchFn(url, {
        method: 'POST',
        headers: stripped,
        body: form,
      });

      if (!response.ok) {
        let body: unknown;
        try {
          body = await response.json() as unknown;
        } catch {
          body = await response.text();
        }
        const message =
          typeof body === 'object' && body !== null && 'error' in body
            ? String((body as { error: unknown }).error)
            : `HTTP ${String(response.status)}`;
        throw new WorkflowClientError(message, response.status, body);
      }

      return response.json() as Promise<{ executionId: string }>;
    },
  };
}

function appendMultipartField(form: FormData, key: string, value: unknown): void {
  if (value === undefined || value === null) return;

  if (isBlobValue(value)) {
    form.append(key, value, fileName(value, key, 0));
    return;
  }

  if (Array.isArray(value) && value.every(isBlobValue)) {
    value.forEach((entry, index) => {
      form.append(key, entry, fileName(entry, key, index));
    });
    return;
  }

  if (typeof value === 'object') {
    form.append(key, JSON.stringify(value));
    return;
  }

  form.append(key, String(value));
}

function isBlobValue(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

function fileName(value: Blob, key: string, index: number): string {
  return typeof File !== 'undefined' && value instanceof File && value.name
    ? value.name
    : `${key}_${String(index)}`;
}

// ─── Folders Client ───

function createFoldersClient(config: WorkflowClientConfig): FoldersClient {
  return {
    async list(
      params?: { limit?: number; cursor?: string },
      opts?: RequestOpts,
    ): Promise<PaginatedList<FolderRecord>> {
      const res = await request<{ folders: FolderRecord[]; nextCursor?: string }>(config, {
        method: 'GET',
        path: '/folders',
        query: pageQuery(params),
        signal: opts?.signal,
      });
      return { items: res.folders, ...(res.nextCursor !== undefined ? { nextCursor: res.nextCursor } : {}) };
    },

    async get(id: string, opts?: RequestOpts): Promise<FolderRecord> {
      return request<FolderRecord>(config, {
        method: 'GET',
        path: `/folders/${encodeURIComponent(id)}`,
        signal: opts?.signal,
      });
    },

    async create(input: CreateFolderInput): Promise<FolderRecord> {
      return request<FolderRecord>(config, {
        method: 'POST',
        path: '/folders',
        body: input,
      });
    },

    async update(id: string, input: UpdateFolderInput): Promise<void> {
      await request<{ updated: boolean }>(config, {
        method: 'PUT',
        path: `/folders/${encodeURIComponent(id)}`,
        body: input,
      });
    },

    async delete(id: string): Promise<void> {
      await request<{ deleted: boolean }>(config, {
        method: 'DELETE',
        path: `/folders/${encodeURIComponent(id)}`,
      });
    },
  };
}

function createUploadsClient(config: WorkflowClientConfig): UploadsClient {
  return {
    async create(files: File[] | Blob[]): Promise<{ attachments: Attachment[] }> {
      const fetchFn = config.fetch ?? globalThis.fetch;
      const headers = await config.getHeaders();
      // Drop Content-Type so the browser sets the multipart boundary itself.
      const stripped: Record<string, string> = {};
      for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() !== 'content-type') stripped[k] = v;
      }

      const form = new FormData();
      files.forEach((file, i) => {
        const name = file instanceof File ? file.name : `file_${String(i)}`;
        form.append('files', file, name);
      });

      const url = buildUrl(config.baseUrl, '/uploads');
      const response = await fetchFn(url, {
        method: 'POST',
        headers: stripped,
        body: form,
      });

      if (!response.ok) {
        let body: unknown;
        try {
          body = await response.json() as unknown;
        } catch {
          body = await response.text();
        }
        const message =
          typeof body === 'object' && body !== null && 'error' in body
            ? String((body as { error: unknown }).error)
            : `HTTP ${String(response.status)}`;
        throw new WorkflowClientError(message, response.status, body);
      }

      return response.json() as Promise<{ attachments: Attachment[] }>;
    },

    url(attachment: Attachment): string {
      return buildUrl(config.baseUrl, '/attachments', {
        ref: attachment.handle,
        name: attachment.name,
        mime: attachment.mimeType,
      });
    },
  };
}

function createExecutionsClient(
  config: WorkflowClientConfig,
): ExecutionsClient {
  return {
    async list(
      params?: ExecutionListParams,
      opts?: RequestOpts,
    ): Promise<PaginatedList<ExecutionRecord>> {
      return request<PaginatedList<ExecutionRecord>>(config, {
        method: 'GET',
        path: '/executions',
        query: {
          ...pageQuery(params),
          workflowId: params?.workflowId,
          status: params?.status,
          folderId: params?.folderId,
        },
        signal: opts?.signal,
      });
    },

    async listPendingApprovals(
      params?: PendingApprovalParams,
      opts?: RequestOpts,
    ): Promise<PaginatedList<PendingApprovalSummary>> {
      const raw = await request<{
        items: Array<
          Omit<PendingApprovalSummary, 'createdAt' | 'dueAt'> & {
            createdAt: string;
            dueAt?: string;
          }
        >;
        nextCursor?: string;
      }>(config, {
        method: 'GET',
        path: '/executions/pending-approvals',
        query: {
          ...pageQuery(params),
          workflowIds: listQuery(params?.workflowIds),
          stages: listQuery(params?.stages),
          tags: listQuery(params?.tags),
          search: params?.search,
          sort: params?.sort,
          bucket: params?.bucket,
          dayEnd: params?.dayEnd !== undefined ? String(params.dayEnd) : undefined,
        },
        signal: opts?.signal,
      });
      return {
        // Both dates cross the wire as strings. `dueAt` is optional, so it is
        // revived only when present — writing `new Date(undefined)` would hand
        // callers an Invalid Date that reads as a real one.
        items: raw.items.map(({ dueAt, ...item }) => ({
          ...item,
          createdAt: new Date(item.createdAt),
          ...(dueAt !== undefined ? { dueAt: new Date(dueAt) } : {}),
        })),
        ...(raw.nextCursor !== undefined ? { nextCursor: raw.nextCursor } : {}),
      };
    },

    async countPendingApprovals(
      params?: PendingApprovalCountParams,
      opts?: RequestOpts,
    ): Promise<number> {
      const res = await request<{ count: number }>(config, {
        method: 'GET',
        path: '/executions/pending-approvals/count',
        query: {
          bucket: params?.bucket,
          dayEnd: params?.dayEnd !== undefined ? String(params.dayEnd) : undefined,
        },
        signal: opts?.signal,
      });
      return res.count;
    },

    async pendingApprovalFacets(opts?: RequestOpts): Promise<PendingApprovalFacets> {
      return request<PendingApprovalFacets>(config, {
        method: 'GET',
        path: '/executions/pending-approvals/facets',
        signal: opts?.signal,
      });
    },

    async get(id: string, opts?: RequestOpts): Promise<ExecutionDetail> {
      return request<ExecutionDetail>(config, {
        method: 'GET',
        path: `/executions/${encodeURIComponent(id)}`,
        signal: opts?.signal,
      });
    },

    async resume(id: string, input?: ResumeInput): Promise<void> {
      await request<{ resumed: boolean }>(config, {
        method: 'POST',
        path: `/executions/${encodeURIComponent(id)}/resume`,
        body: input ?? {},
      });
    },

    async rerun(id: string, input: RerunInput): Promise<{ executionId: string }> {
      return request<{ executionId: string }>(config, {
        method: 'POST',
        path: `/executions/${encodeURIComponent(id)}/rerun`,
        body: input,
      });
    },

    async cancel(id: string): Promise<void> {
      await request<void>(config, {
        method: 'POST',
        path: `/executions/${encodeURIComponent(id)}/cancel`,
      });
    },

    async getStepEvents(
      executionId: string,
      stepName: string,
      after?: string,
    ): Promise<StepEvent[]> {
      const res = await request<{ events: StepEvent[] }>(config, {
        method: 'GET',
        path: `/executions/${encodeURIComponent(executionId)}/steps/${encodeURIComponent(stepName)}/events`,
        query: { after },
      });
      return res.events;
    },
  };
}

function createConversationsClient(config: WorkflowClientConfig): ConversationsClient {
  const at = (id: string) => `/conversations/${encodeURIComponent(id)}`;

  /** A conversation as server-sent events, from wherever it is asked for. */
  async function* events(
    url: string,
    init: { method: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal },
  ): AsyncIterable<ConversationStreamEvent> {
    const fetchFn = config.fetch ?? globalThis.fetch;
    const headers = await config.getHeaders();
    const response = await fetchFn(url, {
      method: init.method,
      headers: { ...headers, Accept: 'text/event-stream', ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
    });
    if (!response.ok || !response.body) {
      let body: unknown;
      try {
        body = (await response.json()) as unknown;
      } catch {
        body = undefined;
      }
      const message = typeof body === 'object' && body !== null && 'error' in body ? String((body as { error: unknown }).error) : `HTTP ${String(response.status)}`;
      throw new WorkflowClientError(message, response.status, body);
    }
    for await (const frame of readSSE(response.body)) {
      yield JSON.parse(frame.data) as ConversationStreamEvent;
    }
  }

  function advance(input: AdvanceConversation): Promise<Turn>;
  function advance(input: AdvanceConversation & { stream: true; signal?: AbortSignal }): AsyncIterable<ConversationStreamEvent>;
  function advance(
    input: AdvanceConversation & { stream?: boolean; signal?: AbortSignal },
  ): Promise<Turn> | AsyncIterable<ConversationStreamEvent> {
    const { signal, ...body } = input;
    if (!body.stream) return request<Turn>(config, { method: 'POST', path: '/conversations', body });
    return events(buildUrl(config.baseUrl, '/conversations'), { method: 'POST', body, ...(signal ? { signal } : {}) });
  }

  return {
    advance,
    async get(id, options) {
      return request<Turn>(config, {
        method: 'GET',
        path: at(id),
        query: options?.waitMs !== undefined ? { waitMs: String(options.waitMs) } : {},
      });
    },
    watch(id, options) {
      return events(buildUrl(config.baseUrl, at(id), { stream: '1' }), { method: 'GET', ...(options?.signal ? { signal: options.signal } : {}) });
    },
    async end(id) {
      return request<Turn>(config, { method: 'POST', path: `${at(id)}/end` });
    },
  };
}

function createCredentialsClient(
  config: WorkflowClientConfig,
): CredentialsClient {
  return {

    async list(
      params?: { limit?: number; cursor?: string },
      opts?: RequestOpts,
    ): Promise<CredentialListResponse> {
      return request<CredentialListResponse>(config, {
        method: 'GET',
        path: '/credentials',
        query: pageQuery(params),
        signal: opts?.signal,
      });
    },

    async create(input: CreateCredentialRequest): Promise<CredentialSummary> {
      return request<CredentialSummary>(config, {
        method: 'POST',
        path: '/credentials',
        body: input,
      });
    },

    async replaceValues(
      name: string,
      input: ReplaceCredentialValuesInput,
    ): Promise<CredentialSummary> {
      return request<CredentialSummary>(config, {
        method: 'PUT',
        path: `/credentials/${encodeURIComponent(name)}`,
        body: input,
      });
    },

    async revoke(name: string): Promise<CredentialSummary> {
      return request<CredentialSummary>(config, {
        method: 'POST',
        path: `/credentials/${encodeURIComponent(name)}/revoke`,
      });
    },
  };
}

function createAnalyticsClient(config: WorkflowClientConfig): AnalyticsClient {
  return {
    async summary(params, opts): Promise<AnalyticsSummaryResult> {
      const query: Record<string, string | undefined> = {
        since: params.since,
        rangeDays: String(params.rangeDays),
      };
      if (params.folderId) query['folderId'] = params.folderId;
      return request<AnalyticsSummaryResult>(config, {
        method: 'GET',
        path: '/analytics/summary',
        query,
        signal: opts?.signal,
      });
    },

    async approvals(params, opts): Promise<ApprovalAnalyticsResult> {
      return request<ApprovalAnalyticsResult>(config, {
        method: 'GET',
        path: '/analytics/approvals',
        query: { since: params.since },
        signal: opts?.signal,
      });
    },

    async topErrors(params, opts): Promise<{ topErrors: TopError[] }> {
      const query: Record<string, string | undefined> = {};
      if (params?.since) query['since'] = params.since;
      if (params?.limit !== undefined) query['limit'] = String(params.limit);
      if (params?.folderId !== undefined) query['folderId'] = params.folderId;
      return request<{ topErrors: TopError[] }>(config, {
        method: 'GET',
        path: '/analytics/top-errors',
        query,
        signal: opts?.signal,
      });
    },
  };
}

// ─── Public Factory ───

/**
 * A stable id for one client instance, used when the host supplies no `origin`.
 * Random rather than derived from the user: two tabs are two independent writers,
 * and each needs to recognise only its own writes.
 */
function generateOrigin(): string {
  // Structurally typed rather than via the DOM `Crypto`: this package targets
  // browsers, Node, Deno and Bun, and does not pull in the DOM lib.
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();
  return `origin-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export function createWorkflowClient(
  userConfig: WorkflowClientConfig,
): WorkflowClient {
  const origin = userConfig.origin ?? generateOrigin();
  const config: WorkflowClientConfig = { ...userConfig, origin };

  return {
    baseUrl: config.baseUrl,
    origin,
    events: createEventsClient(config),
    schema: createSchemaClient(config),
    workflows: createWorkflowsCrudClient(config),
    folders: createFoldersClient(config),
    executions: createExecutionsClient(config),
    conversations: createConversationsClient(config),
    credentials: createCredentialsClient(config),
    uploads: createUploadsClient(config),
    analytics: createAnalyticsClient(config),
    async capabilities(): Promise<readonly Action[]> {
      const res = await request<{ permittedActions: Action[] }>(config, {
        method: 'GET',
        path: '/capabilities',
      });
      return res.permittedActions;
    },
    async moveBatch(input: {
      folders: Array<{ id: string; parentId: string | null }>;
      workflows: Array<{ id: string; folderId: string }>;
    }): Promise<void> {
      await request<{ moved: number }>(config, {
        method: 'POST',
        path: '/move-batch',
        body: input,
      });
    },
  };
}
