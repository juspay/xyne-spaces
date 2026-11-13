/**
 * createWorkflowRouter — framework-agnostic route definitions.
 *
 * Returns an array of `RouteDefinition` objects the host maps to their
 * HTTP framework. Each definition has: method, path, handler, and its
 * `access` class, which says who authenticates the caller.
 *
 * Usage with Express:
 * ```ts
 * const routes = createWorkflowRouter(runtime, {
 *   authenticate,
 * });
 * for (const route of routes) {
 *   const handler = async (req, res) => {
 *     const result = await route.handler(
 *       { params: req.params, query: req.query, body: req.body, headers: req.headers },
 *       // The signed-in user; null for `provider` routes.
 *       route.access === 'provider' ? null : await authenticate(req.headers),
 *     );
 *     res.status(result.status).json(result.body);
 *   };
 *   router[route.method.toLowerCase()](route.path, handler);
 * }
 * ```
 */

import type { WorkflowRuntime } from '../runtime/workflow-runtime.js';
import type { RouteAccess, RouteDefinition, RouteRequest, RouteResponse, AuthContext, RouterOptions } from './types.js';
import { httpStatusFor } from '../completion/types.js';
import type { DeliveryFile } from '../completion/types.js';
import type { InboundReply } from '../ingest/types.js';
import { agentLoop } from '@earendil-works/pi-agent-core';
import type { AgentContext, AgentLoopConfig, AgentEvent, AgentTool } from '@earendil-works/pi-agent-core';
import { createChatAgentTools } from '../agents/builtin/chat-tools.js';
import { buildWorkflowContext, buildExecutionDataFile, collectExecutionAttachments, EXECUTION_DATA_PATH } from './approval-context.js';
import type { SandboxFileUpload } from '../sandbox/types.js';
import type { ExecutionDetail } from '../client/types.js';
import type { PendingApprovalBucket } from '../persistence/types.js';
import type { AssistantMessage, Model, UserMessage, Message } from '@earendil-works/pi-ai';
import type { AiBuilderChatRequest, ApprovalChatRequest, BuilderChatRequest, ApprovalChatResponse, BuilderChatResponse } from '../ai-builder/types.js';
import { OPERATOR_DESCRIPTORS } from '../types/operators.js';
import { getAvailableContext } from '../engine/available-context.js';
import type { WorkflowConfig } from '../types/workflow-config.js';
import type { MutationOptions, ResumeInput } from '../runtime/types.js';
import { executionTopic, workflowTopic, folderTopic, rootTopic } from '../events/types.js';
import type { BusEvent, EventTopic, Unsubscribe } from '../events/types.js';
import type { StorageScope } from '../storage/types.js';
import type {
  ResumePayload,
  ResumeAction,
  ResumeAttachment,
} from '../common/resume-payload.js';
import type { Attachment } from '../common/attachment.js';
import { isExecutable } from '../common/executable-check.js';
import { createFileAccess } from '../storage/files.js';
import { isAttachmentArrayProperty } from '../common/attachment.js';
import { addMultipartValue, coerceTextFields } from '../common/multipart-values.js';
import { createEventChannel } from '../util/event-channel.js';
import { AccessDeniedError, ResourceNotFoundError } from '../authz/default.js';
import { conversationRoutes } from '../conversational-flow/server/routes.js';
import type { ResourceAttributes } from '../authz/attributes.js';
import {
  CredentialNameSchema,
  CredentialAuthSchema,
  validateCredentialValues,
} from '../common/credentials.js';
import type {
  CreateCredentialInput,
  AuthSpecificValues,
} from '../common/credentials.js';

// ─── Helpers ───

function ok(body: unknown): RouteResponse {
  return { status: 200, body };
}

function created(body: unknown): RouteResponse {
  return { status: 201, body };
}

function notFound(msg: string): RouteResponse {
  return { status: 404, body: { error: msg } };
}

function badRequest(msg: string): RouteResponse {
  return { status: 400, body: { error: msg } };
}

// Step 12: 409 Conflict — used by the credential routes for two distinct
// "the resource is in a state that forbids this operation" cases:
//   - creating a credential whose name already exists, and
//   - replacing values on a credential that has been REVOKED.
function conflict(msg: string): RouteResponse {
  return { status: 409, body: { error: msg } };
}

function error(status: number, msg: string): RouteResponse {
  return { status, body: { error: msg } };
}

function objectBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
}

function buildMultipartTriggerPayload(
  req: RouteRequest,
  inputSchema?: Record<string, unknown>,
): Record<string, unknown> {
  // Re-read against the declared input schema, the same way a wait callback's
  // fields are read against its contract — a field declared as a string stays
  // one rather than being parsed into a number.
  const payload = { ...(coerceTextFields(objectBody(req.body), inputSchema) as Record<string, unknown>) };

  const groupedFiles = new Map<string, Attachment[]>();
  for (const file of req.files ?? []) {
    if (!file.fieldName) {
      throw new Error(`Uploaded file "${file.attachment.name}" is missing a multipart field name`);
    }
    const group = groupedFiles.get(file.fieldName) ?? [];
    group.push(file.attachment);
    groupedFiles.set(file.fieldName, group);
  }

  for (const [fieldName, attachments] of groupedFiles) {
    addMultipartValue(
      payload,
      fieldName,
      isAttachmentArrayProperty(inputSchema, fieldName) || attachments.length > 1
        ? attachments
        : attachments[0],
    );
  }
  return payload;
}

/**
 * Give back files the route is about to refuse.
 *
 * Bytes are streamed into storage while the request is parsed, so by the time a
 * handler can judge them they already exist. Best-effort on purpose: a failed
 * delete must not turn a clean 400 into a 500, and the host's sweep for
 * unreferenced objects is the backstop.
 */
async function discardFiles(
  storage: WorkflowRuntime['storage'],
  files: readonly { attachment: Attachment }[] | undefined,
  scope?: StorageScope,
): Promise<void> {
  if (!storage || !files || files.length === 0) return;
  await Promise.all(
    files.map((f) => storage.delete(f.attachment, scope).catch(() => {
      /* left for the sweep */
    })),
  );
}

/** The perimeter rule on uploads, as a message — null when nothing is refused. */
function executableRefusal(
  files: readonly { attachment: Attachment }[] | undefined,
  allowExecutables: boolean,
): string | null {
  if (allowExecutables || !files) return null;
  for (const { attachment } of files) {
    const reason = isExecutable(attachment.mimeType, attachment.name);
    if (reason) return `"${attachment.name}" rejected: ${reason}`;
  }
  return null;
}

/** Format a single SSE message. */
function formatSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * An SSE comment. Carries no event, so it never reaches a client handler — it
 * exists purely so that something crosses the wire on an idle connection, before
 * a proxy or load balancer decides the stream is dead and closes it.
 */
const SSE_KEEPALIVE = ': keepalive\n\n';

/** How long an event stream may sit silent before it sends a keepalive. */
const KEEPALIVE_INTERVAL_MS = 25_000;

/**
 * Marker pushed through an event channel to trigger a keepalive. A symbol so it
 * can never be mistaken for — or collide with — a real event.
 */
const KEEPALIVE = Symbol('keepalive');

/** Ceiling on topics per multiplexed connection. */
const MAX_STREAM_TOPICS = 100;

/**
 * The writer's self-declared identity, read from `X-Workflow-Origin` and echoed
 * back on the change event the mutation emits.
 *
 * A header rather than a body field: it describes the call, not the resource, so
 * it works the same on JSON, multipart and empty-bodied routes without any of
 * them having to make room for it in their schema.
 *
 * Untrusted by construction — a client may send whatever it likes. Nothing is
 * authorized on it; it only ever lets a client recognise the echo of its own
 * write. Truncated so a subscriber cannot be made to carry an unbounded string.
 */
function readOrigin(req: RouteRequest): MutationOptions {
  const raw = req.headers['x-workflow-origin'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ? { origin: value.slice(0, 128) } : {};
}

/**
 * Parse an id list from a query parameter, accepting both `?a=1,2` and `?a=1&a=2`
 * so the route does not depend on how the host's framework folds repeats.
 */
function parseIdList(raw: string | string[] | undefined): string[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const ids = new Set<string>();
  for (const part of parts) {
    for (const id of part.split(',')) {
      const trimmed = id.trim();
      if (trimmed) ids.add(trimmed);
    }
  }
  return [...ids];
}

/**
 * Read the paging parameters off a query string. `limit` and `cursor` are the
 * only two — there is deliberately no `offset`.
 *
 * Shape only; the runtime's `resolvePage` decides the default and the cap.
 */
function readPage(query: RouteRequest['query']): { limit?: number; cursor?: string } {
  const page: { limit?: number; cursor?: string } = {};
  const limit = query['limit'];
  const cursor = query['cursor'];
  if (typeof limit === 'string') page.limit = Number(limit);
  if (typeof cursor === 'string' && cursor !== '') page.cursor = cursor;
  return page;
}

/**
 * Read the approvals bucket and the caller's end-of-day from a query string.
 *
 * Shared by the list and the count so a section's rows and its header can
 * never be answered by different rules. An unparseable `dayEnd` is dropped
 * rather than passed on: NaN in a date comparison silently matches nothing,
 * which would read as "no approvals are due today".
 */
function readBucket(
  query: RouteRequest['query'],
): { bucket?: PendingApprovalBucket; dayEnd?: number } {
  const out: { bucket?: PendingApprovalBucket; dayEnd?: number } = {};
  const bucket = query['bucket'];
  if (bucket === 'overdue' || bucket === 'dueToday' || bucket === 'dueSoon') out.bucket = bucket;
  const dayEnd = query['dayEnd'];
  if (typeof dayEnd === 'string' && dayEnd !== '') {
    const ms = Number(dayEnd);
    if (Number.isFinite(ms)) out.dayEnd = ms;
  }
  return out;
}

/** Read a repeated/comma query param as a string list, or undefined when absent. */
function readList(raw: string | string[] | undefined): string[] | undefined {
  const parsed = parseIdList(raw);
  return parsed.length > 0 ? parsed : undefined;
}

/** A route as written in this file: `access` may be omitted, and defaults to `session`. */
type RouteSpec<TCtx> = Omit<RouteDefinition<TCtx>, 'access'> & { access?: RouteAccess };

// ─── Router Factory ───

export function createWorkflowRouter<TCtx = AuthContext>(
  // `any` for services: the router never touches TServices, only forwards ctx.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runtime: WorkflowRuntime<any, TCtx>,
  // `authenticate` is invoked by the host glue, not the factory (see file header);
  // `rootId` (when the host supplies it) is read by the `/events` root-scope feed.
  opts: RouterOptions<TCtx>,
): RouteDefinition<TCtx>[] {
  const routes: RouteSpec<TCtx>[] = [];

  // `session` handlers always receive a resolved ctx — the host authenticates
  // before dispatch. `provider` routes never forward `auth` to a guarded runtime
  // call, so this narrowing is sound.
  const asCtx = (auth: TCtx | null): TCtx => auth as TCtx;

  // ─── Workflow CRUD ───

  routes.push({
    method: 'GET',
    path: '/workflows',
    handler: async (req, auth) => {
      const q = req.query;
      const result = await runtime.listWorkflows(asCtx(auth), {
        ...readPage(q),
        ...(typeof q['folderId'] === 'string' ? { folderId: q['folderId'] } : {}),
      });
      return ok({ workflows: result.items, nextCursor: result.nextCursor });
    },
  });

  // Workflows awaiting review. Registered before `/workflows/:id`, for the
  // same reason `counts` is: otherwise "pending" is captured as an :id.
  routes.push({
    method: 'GET',
    path: '/workflows/pending',
    handler: async (req, auth) =>
      ok(await runtime.listPendingWorkflows(asCtx(auth), readPage(req.query))),
  });

  // Registered before `/workflows/:id` so "last-runs" isn't captured as an :id.
  routes.push({
    method: 'GET',
    path: '/workflows/last-runs',
    handler: async (req, auth) => {
      const q = req.query;
      const lastRuns = await runtime.lastRunByWorkflow(asCtx(auth), {
        ...(typeof q['folderId'] === 'string' ? { folderId: q['folderId'] } : {}),
        ...(readList(q['workflowIds']) ? { workflowIds: readList(q['workflowIds'])! } : {}),
      });
      return ok({ lastRuns });
    },
  });

  // Counts for the folder rail (total + per-folder). Registered before
  // `/workflows/:id` so "counts" isn't captured as an :id.
  routes.push({
    method: 'GET',
    path: '/workflows/counts',
    handler: async (_req, auth) => {
      const counts = await runtime.workflowCounts(asCtx(auth));
      return ok(counts);
    },
  });

  routes.push({
    method: 'GET',
    path: '/workflows/:id',
    handler: async (req, auth) => {
      const id = req.params['id'];
      if (!id) return badRequest('Missing workflow ID');
      // Missing → ResourceNotFoundError → 404 at the wrapper below.
      return ok(await runtime.getWorkflow(asCtx(auth), id));
    },
  });

  routes.push({
    method: 'POST',
    path: '/workflows',
    handler: async (req, auth) => {
      const body = req.body as Record<string, unknown> | undefined;
      if (!body || !body['name'] || !body['config']) {
        return badRequest('Body must contain "name" and "config"');
      }
      if (typeof body['folderId'] !== 'string') {
        return badRequest('Body must contain a "folderId" (every workflow belongs to a folder)');
      }
      try {
        const workflow = await runtime.createWorkflow(asCtx(auth), {
          name: body['name'] as string,
          config: body['config'] as WorkflowConfig,
          metadata: (body['metadata'] as Record<string, unknown>) ?? undefined,
          summary: typeof body['summary'] === 'string' ? body['summary'] : null,
          folderId: body['folderId'],
          attributes: body['attributes'],
        }, readOrigin(req));
        return created(workflow);
      } catch (err) {
        if (err instanceof AccessDeniedError) throw err;
        return error(
          400,
          err instanceof Error ? err.message : 'Create failed',
        );
      }
    },
  });

  routes.push({
    method: 'PUT',
    path: '/workflows/:id',
    handler: async (req, auth) => {
      const id = req.params['id'];
      if (!id) return badRequest('Missing workflow ID');
      const body = req.body as Record<string, unknown> | undefined;
      if (!body) return badRequest('Request body is required');
      try {
        const input: {
          name?: string;
          config?: WorkflowConfig;
          metadata?: Record<string, unknown>;
          summary?: string | null;
          folderId?: string;
        } = {};
        if (typeof body['name'] === 'string') input.name = body['name'];
        if (body['config']) input.config = body['config'] as WorkflowConfig;
        if (body['metadata']) input.metadata = body['metadata'] as Record<string, unknown>;
        if (typeof body['summary'] === 'string' || body['summary'] === null) {
          input.summary = body['summary'] as string | null;
        }
        if (typeof body['folderId'] === 'string') input.folderId = body['folderId'];
        const workflow = await runtime.updateWorkflow(asCtx(auth), id, input, readOrigin(req));
        return ok(workflow);
      } catch (err) {
        if (err instanceof AccessDeniedError) throw err;
        if (err instanceof Error && err.message.includes('not found')) {
          return notFound(err.message);
        }
        return error(
          400,
          err instanceof Error ? err.message : 'Update failed',
        );
      }
    },
  });

  // ─── Folders ───

  routes.push({
    method: 'GET',
    path: '/folders',
    handler: async (req, auth) => {
      const result = await runtime.listFolders(asCtx(auth), readPage(req.query));
      return ok({ folders: result.items, nextCursor: result.nextCursor });
    },
  });

  routes.push({
    method: 'GET',
    path: '/folders/:id',
    handler: async (req, auth) => {
      const id = req.params['id'];
      if (!id) return badRequest('Missing folder ID');
      // Missing → ResourceNotFoundError → 404 at the wrapper below.
      return ok(await runtime.getFolder(asCtx(auth), id));
    },
  });

  // What may this caller do at the top level? Folder and workflow rows carry
  // their own `permittedActions`, but a root-level "New folder" button has no
  // row to read — this is that decision, and it is the same one create enforces.
  routes.push({
    method: 'GET',
    path: '/capabilities',
    handler: async (_req, auth) => {
      return ok({ permittedActions: await runtime.capabilities(asCtx(auth)) });
    },
  });

  routes.push({
    method: 'POST',
    path: '/folders',
    handler: async (req, auth) => {
      const body = req.body as Record<string, unknown> | undefined;
      if (!body || typeof body['name'] !== 'string') {
        return badRequest('Body must contain "name"');
      }
      const parentId = typeof body['parentId'] === 'string' ? body['parentId'] : null;
      try {
        const folder = await runtime.createFolder(asCtx(auth), {
          name: body['name'],
          ...(body['metadata'] ? { metadata: body['metadata'] as Record<string, unknown> } : {}),
          parentId,
          attributes: body['attributes'],
        });
        return created(folder);
      } catch (err) {
        if (err instanceof AccessDeniedError) throw err;
        return error(400, err instanceof Error ? err.message : 'Create failed');
      }
    },
  });

  routes.push({
    method: 'PUT',
    path: '/folders/:id',
    handler: async (req, auth) => {
      const id = req.params['id'];
      if (!id) return badRequest('Missing folder ID');
      const body = req.body as Record<string, unknown> | undefined;
      if (!body) return badRequest('Missing body');
      const update: { name?: string; parentId?: string | null } = {};
      if (typeof body['name'] === 'string') update.name = body['name'];
      if ('parentId' in body) {
        update.parentId = typeof body['parentId'] === 'string' ? body['parentId'] : null;
      }
      try {
        await runtime.updateFolder(asCtx(auth), id, update);
        return ok({ updated: true });
      } catch (err) {
        if (err instanceof AccessDeniedError) throw err;
        return error(400, err instanceof Error ? err.message : 'Update failed');
      }
    },
  });

  routes.push({
    method: 'DELETE',
    path: '/folders/:id',
    handler: async (req, auth) => {
      const id = req.params['id'];
      if (!id) return badRequest('Missing folder ID');
      try {
        await runtime.deleteFolder(asCtx(auth), id);
        return ok({ deleted: true });
      } catch (err) {
        if (err instanceof AccessDeniedError) throw err;
        const msg = err instanceof Error ? err.message : 'Delete failed';
        // Folder still holds workflows — conflict, not a generic failure.
        if (msg.includes('not empty')) return error(409, msg);
        return error(400, msg);
      }
    },
  });

  // ─── Batch Move ───

  routes.push({
    method: 'POST',
    path: '/move-batch',
    handler: async (req, auth) => {
      const body = req.body as Record<string, unknown> | undefined;
      if (!body) return badRequest('Request body is required');
      const folders = Array.isArray(body['folders']) ? body['folders'] as Array<{ id: string; parentId: string | null }> : [];
      const workflows = Array.isArray(body['workflows']) ? body['workflows'] as Array<{ id: string; folderId: string }> : [];
      if (folders.length === 0 && workflows.length === 0) return badRequest('Nothing to move');
      try {
        await runtime.moveBatch(asCtx(auth), { folders, workflows }, readOrigin(req));
        return ok({ moved: folders.length + workflows.length });
      } catch (err) {
        if (err instanceof AccessDeniedError) throw err;
        return error(400, err instanceof Error ? err.message : 'Move failed');
      }
    },
  });

  // ─── Validation ───

  routes.push({
    method: 'POST',
    path: '/workflows/validate',
    handler: async (req, auth) => {
      const config = req.body as Record<string, unknown> | undefined;
      if (!config || !config['trigger'] || !config['steps']) {
        return badRequest('Body must be a WorkflowConfig with trigger and steps');
      }
      const raw = req.query['workflowId'];
      const workflowId = typeof raw === 'string' && raw !== '' ? raw : undefined;

      const result = await runtime.validateConfig(
        asCtx(auth),
        config as unknown as Parameters<typeof runtime.validateConfig>[1],
        workflowId,
      );
      return ok(result);
    },
  });

  // ─── Lifecycle ───

  routes.push({
    method: 'POST',
    path: '/workflows/:id/activate',
    handler: async (req, auth) => {
      const id = req.params['id'];
      if (!id) return badRequest('Missing workflow ID');
      try {
        // The outcome, not a bare acknowledgement: activating can end live or
        // in review, and the caller is told which rather than having to re-read.
        return ok(await runtime.activateWorkflow(asCtx(auth), id, readOrigin(req)));
      } catch (err) {
        if (err instanceof AccessDeniedError) throw err;
        return error(
          400,
          err instanceof Error ? err.message : 'Activation failed',
        );
      }
    },
  });

  routes.push({
    method: 'POST',
    path: '/workflows/:id/deactivate',
    handler: async (req, auth) => {
      const id = req.params['id'];
      if (!id) return badRequest('Missing workflow ID');
      try {
        await runtime.deactivateWorkflow(asCtx(auth), id, readOrigin(req));
        return ok({ deactivated: true });
      } catch (err) {
        if (err instanceof AccessDeniedError) throw err;
        return error(
          400,
          err instanceof Error ? err.message : 'Deactivation failed',
        );
      }
    },
  });

  routes.push({
    method: 'POST',
    path: '/workflows/:id/approve',
    handler: async (req, auth) => {
      const id = req.params['id'];
      if (!id) return badRequest('Missing workflow ID');
      try {
        await runtime.approveWorkflow(asCtx(auth), id, readOrigin(req));
        return ok({ approved: true });
      } catch (err) {
        if (err instanceof AccessDeniedError) throw err;
        return error(400, err instanceof Error ? err.message : 'Approval failed');
      }
    },
  });

  routes.push({
    method: 'POST',
    path: '/workflows/:id/reject',
    handler: async (req, auth) => {
      const id = req.params['id'];
      if (!id) return badRequest('Missing workflow ID');
      try {
        await runtime.rejectWorkflow(asCtx(auth), id, readOrigin(req));
        return ok({ rejected: true });
      } catch (err) {
        if (err instanceof AccessDeniedError) throw err;
        return error(400, err instanceof Error ? err.message : 'Rejection failed');
      }
    },
  });

  // ─── Trigger ───

  routes.push({
    method: 'POST',
    path: '/workflows/:id/trigger',
    handler: async (req, auth) => {
      const id = req.params['id'];
      if (!id) return badRequest('Missing workflow ID');
      try {
        const payload = (req.body as Record<string, unknown>) ?? {};
        const executionId = await runtime.triggerManual(asCtx(auth), id, payload);
        return created({ executionId });
      } catch (err) {
        if (err instanceof AccessDeniedError) throw err;
        if (err instanceof Error && err.message.includes('not found')) {
          return notFound(err.message);
        }
        // A run identifier someone typed is taken: 409, so the form can say
        // "choose another" instead of showing a generic failure.
        if (err instanceof Error && /Workflow run identifier .* already exists/.test(err.message)) {
          return conflict(err.message);
        }
        return error(
          400,
          err instanceof Error ? err.message : 'Trigger failed',
        );
      }
    },
  });

  routes.push({
    method: 'POST',
    path: '/v2/workflows/:workflowId/trigger/v2',
    // No session. The SDK does not authenticate this caller; a host that exposes
    // the route guards it, for example with an API key.
    access: 'provider',
    multipart: 'any',
    handler: async (req) => {
      const workflowId = req.params['workflowId'];
      if (!workflowId) return badRequest('Missing workflow ID');
      if (!runtime.storage) {
        return error(501, 'No StorageAdapter configured — multipart trigger uploads are disabled');
      }

      // Perimeter first: dangerous content is refused before any lookup, and
      // the handle already encodes ownership, so the discard needs no scope.
      const refusal = executableRefusal(req.files, runtime.allowExecutableUploads);
      if (refusal) {
        await discardFiles(runtime.storage, req.files);
        return badRequest(refusal);
      }

      try {
        const target = await runtime.getApiTriggerTarget(workflowId);
        const payload = buildMultipartTriggerPayload(req, target.inputSchema);
        const executionId = await runtime.triggerViaApi(workflowId, payload);
        return created({ executionId });
      } catch (err) {
        // An unknown workflow goes to the uniform 404 mapping at the end of this file.
        if (err instanceof ResourceNotFoundError) throw err;
        if (err instanceof Error && err.message.includes('not found')) {
          return notFound(err.message);
        }
        return error(
          400,
          err instanceof Error ? err.message : 'Multipart trigger failed',
        );
      }
    },
  });

  // ─── Uploads (multipart) ───

  routes.push({
    method: 'POST',
    path: '/uploads',
    multipart: 'files',
    // TODO(uploads): guard via the authorizer once blobs are ACL-modeled. The scope
    // below gives tenant attribution; it is not authorization.
    handler: async (req, auth) => {
      if (!runtime.storage) {
        return error(501, 'No StorageAdapter configured — file uploads are disabled');
      }
      const files = req.files;
      if (!files || files.length === 0) {
        return badRequest('No files in request — did the host run a multipart parser?');
      }

      // The host's auth context IS its storage scope for caller-initiated work: an
      // upload has a person and no workflow yet. Not provable here (TCtx is unbound
      // at this point), so the host's adapter validates and rejects a scope it
      // cannot read a tenant from.
      const scope = auth as StorageScope;

      // Perimeter check: reject executables unless the host opted in. This
      // applies to ALL uploads regardless of workflow — the upload route
      // doesn't know which workflow the files are for yet. The bytes are
      // already stored by now, so a refusal has to take them back out.
      const refusal = executableRefusal(files, runtime.allowExecutableUploads);
      if (refusal) {
        await discardFiles(runtime.storage, files, scope);
        return badRequest(refusal);
      }

      // Nothing to do but hand the references back: the host streamed each part
      // into storage as it parsed, so this route never sees a byte.
      return created({ attachments: files.map((f) => f.attachment) });
    },
  });

  // ─── Attachment download (serve bytes / redirect to signed URL) ───
  //
  // The only route that emits a blob. Prefers a host-signed URL (offloads bytes
  // to the blob store); falls back to streaming `storage.read` for adapters
  // without `signUrl` (e.g. the in-memory adapter). Tenant scoping is the
  // adapter's responsibility — the opaque `ref` encodes ownership and the
  // host's `read`/`signUrl` must reject refs outside the caller's scope.
  routes.push({
    method: 'GET',
    path: '/attachments',
    handler: async (req, auth) => {
      if (!runtime.storage) {
        return error(501, 'No StorageAdapter configured — downloads are disabled');
      }
      const ref = typeof req.query['ref'] === 'string' ? req.query['ref'] : undefined;
      if (!ref) return badRequest('Missing required query param: ref');
      const name = typeof req.query['name'] === 'string' ? req.query['name'] : 'download';
      const mime = typeof req.query['mime'] === 'string' ? req.query['mime'] : 'application/octet-stream';
      const attachment: Attachment = { name, mimeType: mime, handle: ref };
      try {
        if (runtime.storage.signUrl) {
          const url = await runtime.storage.signUrl(attachment, 300);
          return { status: 302, body: null, headers: { Location: url } };
        }
        // Pass the caller so a tenant-enforcing adapter can refuse a reference
        // owned by another workspace. `ref` is client-supplied.
        //
        // Piped, not read: without `signUrl` the bytes do cross this process,
        // but they pass through it rather than pile up in it. `info` supplies
        // Content-Length without touching the object's contents.
        const scope = auth as StorageScope;
        const known = await runtime.storage.info(attachment, scope);
        if (!known) return notFound('Attachment not found');
        const body = await runtime.storage.stream(attachment, scope);
        return {
          status: 200,
          body: null,
          bodyStream: body,
          headers: {
            'Content-Type': mime,
            // Force download; never inline-render. An uploaded HTML/SVG must not
            // execute script in the app origin (stored XSS). nosniff stops the
            // browser re-interpreting the type; the CSP neuters any script if a
            // browser renders it regardless.
            'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox",
            'Content-Length': String(known.size),
          },
        };
      } catch (err) {
        if (err instanceof AccessDeniedError) throw err;
        return error(500, err instanceof Error ? err.message : 'Download failed');
      }
    },
  });

  // ─── Executions ───

  // Specific paths before parameterized :execId routes — otherwise
  // "pending-approvals" is captured as an :execId.

  routes.push({
    method: 'GET',
    path: '/executions/pending-approvals/count',
    handler: async (req, auth) =>
      ok({ count: await runtime.countPendingApprovals(asCtx(auth), readBucket(req.query)) }),
  });

  // Facets cover the whole visible set, not the page in hand.
  routes.push({
    method: 'GET',
    path: '/executions/pending-approvals/facets',
    handler: async (_req, auth) =>
      ok(await runtime.pendingApprovalFacets(asCtx(auth))),
  });

  routes.push({
    method: 'GET',
    path: '/executions/pending-approvals',
    handler: async (req, auth) => {
      const q = req.query;
      const sort = q['sort'];
      return ok(
        await runtime.listPendingApprovals(asCtx(auth), {
          ...readPage(q),
          ...(readList(q['workflowIds']) ? { workflowIds: readList(q['workflowIds'])! } : {}),
          ...(readList(q['stages']) ? { stages: readList(q['stages'])! } : {}),
          ...(readList(q['tags']) ? { tags: readList(q['tags'])! } : {}),
          ...(typeof q['search'] === 'string' && q['search'] !== ''
            ? { search: q['search'] }
            : {}),
          ...(sort === 'oldest' || sort === 'newest' || sort === 'due' ? { sort } : {}),
          ...readBucket(q),
        }),
      );
    },
  });

  routes.push({
    method: 'GET',
    path: '/executions/:execId',
    handler: async (req, auth) => {
      const execId = req.params['execId'];
      if (!execId) return badRequest('Missing execution ID');
      const detail = await runtime.getExecutionDetail(asCtx(auth), execId);
      if (!detail) return notFound(`Execution ${execId} not found`);
      return ok({
        ...detail.execution,
        steps: detail.steps,
        config: detail.config,
        triggerData: detail.triggerData,
        summary: detail.summary,
        name: detail.name,
        permittedActions: detail.permittedActions,
      });
    },
  });

  routes.push({
    method: 'POST',
    path: '/executions/:execId/resume',
    handler: async (req, auth) => {
      const execId = req.params['execId'];
      if (!execId) return badRequest('Missing execution ID');
      const body = (req.body ?? {}) as Record<string, unknown>;
      const resumeInput: ResumeInput = {};
      if (body['data'] !== undefined) {
        const parsed = parseResumePayload(body['data']);
        if (!parsed) return badRequest('Invalid resume payload: missing or invalid `action`');
        resumeInput.data = parsed;
      }
      if (typeof body['abort'] === 'boolean') {
        resumeInput.abort = body['abort'];
      }
      // Target a specific paused gate by node-path (required when >1 gate is
      // open — e.g. a PARALLEL with concurrent WAITs).
      if (typeof body['nodePath'] === 'string') {
        resumeInput.nodePath = body['nodePath'];
      }
      try {
        await runtime.resume(asCtx(auth), execId, resumeInput);
        return ok({ resumed: true });
      } catch (err) {
        if (err instanceof AccessDeniedError) throw err;
        if (err instanceof Error && err.message.includes('not found')) {
          return notFound(err.message);
        }
        return error(
          400,
          err instanceof Error ? err.message : 'Resume failed',
        );
      }
    },
  });

  // ─── Continuing a run from outside ───

  /**
   * What an external system reports back to a run that is waiting for it.
   *
   * `provider`, like the trigger routes: the SDK authenticates nobody. A host
   * mounts this where its own gate already is — ours mounts it on the app
   * router, so an install may answer a run of a workflow it is attached to, and
   * nothing else. The engine has no principal to ask about, which is why the
   * decision belongs to that mount rather than here.
   *
   * The outcome picks the status. `ignored` is deliberately 2xx: a non-2xx
   * would have a sender's recovery worker redeliver what we dropped on purpose.
   */
  routes.push({
    method: 'POST',
    path: '/executions/:execId/waits/:stepId',
    access: 'provider',
    // Either content type on one URL: a sender with a result posts JSON, and one
    // with a result and a file posts multipart. A gate's contract describes both
    // the same way, so which was used is not the author's concern.
    multipart: 'any',
    handler: async (req) => {
      const executionId = req.params['execId'] ?? '';
      const stepId = req.params['stepId'] ?? '';
      if (executionId === '' || stepId === '') return badRequest('Missing execution or step');

      const nodePath = req.query['nodePath'];
      const fence = Number(req.query['fence']);
      const deliveryId = req.headers['x-delivery-id'];

      const refusal = executableRefusal(req.files, runtime.allowExecutableUploads);
      if (refusal) {
        await discardFiles(runtime.storage, req.files);
        return badRequest(refusal);
      }

      const files: DeliveryFile[] = [];
      for (const file of req.files ?? []) {
        if (!file.fieldName) {
          await discardFiles(runtime.storage, req.files);
          return badRequest(
            `Uploaded file "${file.attachment.name}" is missing a multipart field name`,
          );
        }
        files.push({ fieldName: file.fieldName, attachment: file.attachment });
      }

      // Only how it arrived is decided here. What a text field means is the
      // gate contract's business, and the contract is on the parked record,
      // which only `deliver` has resolved by the time it matters.
      const multipart = String(req.headers['content-type'] ?? '').includes('multipart/form-data');

      const outcome = await runtime.deliver(
        {
          executionId,
          stepId,
          ...(typeof nodePath === 'string' && nodePath !== '' ? { nodePath } : {}),
          ...(Number.isInteger(fence) ? { fence } : {}),
        },
        {
          payload: multipart ? objectBody(req.body) : req.body,
          ...(files.length > 0 ? { files } : {}),
          ...(multipart ? { encoding: 'multipart' as const } : {}),
          ...(typeof deliveryId === 'string' && deliveryId !== '' ? { deliveryId } : {}),
        },
      );
      return { status: httpStatusFor(outcome), body: outcome };
    },
  });

  // Per-step activity events (agent thinking / tool calls / logs) for the run
  // view's activity timeline. Lazy: fetched only when a step panel is opened,
  // so the execution-detail payload stays lean. Live runs append the SSE
  // `step_progress` events on top of this historical snapshot.
  routes.push({
    method: 'GET',
    path: '/executions/:execId/steps/:stepName/events',
    handler: async (req, auth) => {
      const execId = req.params['execId'];
      const stepName = req.params['stepName'];
      if (!execId || !stepName) return badRequest('Missing execution ID or step name');
      const afterStr = req.query['after'];
      const after = typeof afterStr === 'string' && afterStr ? new Date(afterStr) : undefined;
      if (after && isNaN(after.getTime())) {
        return badRequest('Invalid query param: after must be an ISO 8601 date string');
      }
      const events = await runtime.getStepEvents(asCtx(auth), execId, stepName, after);
      return ok({ events });
    },
  });

  // ─── Analytics ───

  routes.push({
    method: 'GET',
    path: '/analytics/summary',
    handler: async (req, auth) => {
      const sinceStr = req.query['since'];
      const rangeDaysStr = req.query['rangeDays'];
      if (typeof sinceStr !== 'string' || !sinceStr) return badRequest('Missing required query param: since');
      const since = new Date(sinceStr);
      if (isNaN(since.getTime())) return badRequest('Invalid query param: since must be an ISO 8601 date string');
      const rangeDays = typeof rangeDaysStr === 'string' && rangeDaysStr ? parseInt(rangeDaysStr, 10) : 7;
      const folderId = typeof req.query['folderId'] === 'string' ? req.query['folderId'] : undefined;
      const summary = await runtime.getAnalyticsSummary(asCtx(auth), { since, rangeDays, ...(folderId ? { folderId } : {}) });
      return ok(summary);
    },
  });

  routes.push({
    method: 'GET',
    path: '/analytics/approvals',
    handler: async (req, auth) => {
      const sinceStr = req.query['since'];
      if (typeof sinceStr !== 'string' || !sinceStr) return badRequest('Missing required query param: since');
      const since = new Date(sinceStr);
      if (isNaN(since.getTime())) return badRequest('Invalid query param: since must be an ISO 8601 date string');
      return ok(await runtime.getApprovalAnalytics(asCtx(auth), { since }));
    },
  });

  routes.push({
    method: 'GET',
    path: '/analytics/top-errors',
    handler: async (req, auth) => {
      const sinceStr = req.query['since'];
      const limitStr = req.query['limit'];
      const folderIdStr = req.query['folderId'];
      const sinceDate = typeof sinceStr === 'string' && sinceStr ? new Date(sinceStr) : undefined;
      if (sinceDate && isNaN(sinceDate.getTime())) return badRequest('Invalid query param: since must be an ISO 8601 date string');
      const since = sinceDate;
      const limit = typeof limitStr === 'string' && limitStr ? parseInt(limitStr, 10) : 5;
      const folderId = typeof folderIdStr === 'string' ? folderIdStr : undefined;
      const topErrors = await runtime.getTopErrors(asCtx(auth), { ...(since ? { since } : {}), limit, ...(folderId !== undefined ? { folderId } : {}) });
      return ok({ topErrors });
    },
  });

  // ─── Webhooks (no session — the trigger's own verify authenticates the sender) ───

  const webhookResponse = (reply: InboundReply): RouteResponse => ({
    status: reply.status,
    body: reply.body,
    ...(reply.headers ? { headers: { ...reply.headers } } : {}),
  });

  // A provider's GET handshake (Meta's `hub.challenge`, say). Only the trigger's
  // `handshake` answers it: a GET carries no body to verify, so it never starts a run.
  routes.push({
    method: 'GET',
    path: '/webhooks/:workflowId',
    access: 'provider',
    handler: async (req) => {
      const { reply } = await runtime.handleWebhook(req.params['workflowId'] ?? '', {
        method: 'GET',
        headers: req.headers,
        query: req.query,
        rawBody: new Uint8Array(),
      });
      return webhookResponse(reply);
    },
  });

  routes.push({
    method: 'POST',
    path: '/webhooks/:workflowId',
    access: 'provider',
    rawBody: true,
    handler: async (req) => {
      if (!req.rawBody) {
        // A signature covers the bytes as sent, so a parsed body cannot be
        // verified. Refuse rather than silently skip authentication.
        return error(
          500,
          'Webhook route requires the raw request body; the host must honour RouteDefinition.rawBody',
        );
      }
      const { reply } = await runtime.handleWebhook(req.params['workflowId'] ?? '', {
        method: 'POST',
        headers: req.headers,
        query: req.query,
        rawBody: req.rawBody,
      });
      return webhookResponse(reply);
    },
  });

  // ─── Schema metadata (for UI) ───

  routes.push({
    method: 'GET',
    path: '/schema/credentials',
    handler: async () => {
      return ok({ connectors: runtime.connectors.listCredentialTypes() });
    },
  });

  routes.push({
    method: 'GET',
    path: '/schema/triggers',
    handler: async () => {
      return ok({
        triggers: runtime.connectors.listTriggerSummaries(),
      });
    },
  });

  routes.push({
    method: 'GET',
    path: '/schema/steps',
    handler: async () => {
      return ok({
        steps: runtime.connectors.listStepSummaries(),
      });
    },
  });

  // ─── Schema detail (single step/trigger with full JSON Schema) ───

  routes.push({
    method: 'GET',
    path: '/schema/triggers/:type',
    handler: async (req) => {
      const type = req.params['type'];
      if (!type) return badRequest('Missing trigger type');
      if (!runtime.connectors.hasTrigger(type)) {
        return notFound(`Unknown trigger type "${type}"`);
      }
      return ok(runtime.connectors.getTriggerDescriptor(type));
    },
  });

  routes.push({
    method: 'GET',
    path: '/schema/steps/:type',
    handler: async (req) => {
      const type = req.params['type'];
      if (!type) return badRequest('Missing step type');
      if (!runtime.connectors.hasStep(type)) {
        return notFound(`Unknown step type "${type}"`);
      }
      return ok(runtime.connectors.getStepDescriptor(type));
    },
  });

  // ─── Field options (pickers for config fields) ───

  const configFrom = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;

  routes.push({
    method: 'POST',
    path: '/schema/:kind/:type/options',
    handler: async (req, auth) => {
      const kind = req.params['kind'];
      const type = req.params['type'];
      if (kind !== 'steps' && kind !== 'triggers') {
        return badRequest('Options are only available for steps and triggers');
      }
      if (!type) return badRequest('Missing type');

      const body = (req.body ?? {}) as {
        field?: unknown;
        config?: unknown;
        search?: unknown;
        cursor?: unknown;
        values?: unknown;
        workflowId?: unknown;
        folderId?: unknown;
      };
      if (typeof body.field !== 'string' || !body.field) return badRequest('Missing field');

      const page = await runtime.getFieldOptions(asCtx(auth), {
        ...(req.signal !== undefined ? { signal: req.signal } : {}),
        kind: kind === 'steps' ? 'step' : 'trigger',
        type,
        field: body.field,
        ...(configFrom(body.config) ? { config: configFrom(body.config)! } : {}),
        ...(typeof body.search === 'string' ? { search: body.search } : {}),
        ...(typeof body.cursor === 'string' ? { cursor: body.cursor } : {}),
        ...(Array.isArray(body.values)
          ? { values: body.values.filter((v): v is string => typeof v === 'string') }
          : {}),
        ...(typeof body.workflowId === 'string' ? { workflowId: body.workflowId } : {}),
        ...(typeof body.folderId === 'string' ? { folderId: body.folderId } : {}),
      });

      return ok(page);
    },
  });

  routes.push({
    method: 'GET',
    path: '/schema/operators',
    handler: async () => {
      return ok({ operators: OPERATOR_DESCRIPTORS });
    },
  });

  // ─── Available Context (for variable picker UI) ───

  routes.push({
    method: 'POST',
    path: '/schema/available-context',
    handler: async (req) => {
      const body = req.body as Record<string, unknown> | undefined;
      if (!body || !body['config'] || !body['atStepId']) {
        return badRequest('Body must contain "config" (WorkflowConfig) and "atStepId" (string)');
      }
      const config = body['config'] as WorkflowConfig;
      const atStepId = body['atStepId'] as string;
      const context = getAvailableContext(config, atStepId, runtime.connectors);
      return ok({ context });
    },
  });

  // ─── Execution List ───

  routes.push({
    method: 'GET',
    path: '/executions',
    handler: async (req, auth) => {
      const q = req.query;
      const result = await runtime.listExecutions(asCtx(auth), {
        ...readPage(q),
        ...(typeof q['workflowId'] === 'string' ? { workflowId: q['workflowId'] } : {}),
        ...(typeof q['status'] === 'string' ? { status: q['status'] } : {}),
        ...(typeof q['folderId'] === 'string' ? { folderId: q['folderId'] } : {}),
      });
      return ok(result);
    },
  });

  // ─── Execution Rerun ───

  routes.push({
    method: 'POST',
    path: '/executions/:execId/rerun',
    handler: async (req, auth) => {
      const execId = req.params['execId'];
      if (!execId) return badRequest('Missing execution ID');
      const body = (req.body ?? {}) as Record<string, unknown>;
      const fromStepId = body['fromStepId'];
      if (typeof fromStepId !== 'string' || !fromStepId) {
        return badRequest('Missing or invalid fromStepId');
      }
      const opts: {
        configOverrides?: Record<string, unknown>;
        inheritStepState?: boolean;
      } = {};
      if (body['configOverrides'] && typeof body['configOverrides'] === 'object') {
        opts.configOverrides = body['configOverrides'] as Record<string, unknown>;
      }
      if (typeof body['inheritStepState'] === 'boolean') {
        opts.inheritStepState = body['inheritStepState'];
      }
      try {
        const newExecutionId = await runtime.rerunFromStep(asCtx(auth), execId, fromStepId, opts);
        return ok({ executionId: newExecutionId });
      } catch (err) {
        if (err instanceof AccessDeniedError) throw err;
        if (err instanceof Error && err.message.includes('not found')) {
          return notFound(err.message);
        }
        return error(
          400,
          err instanceof Error ? err.message : 'Rerun failed',
        );
      }
    },
  });

  // ─── Execution Cancel ───

  routes.push({
    method: 'POST',
    path: '/executions/:execId/cancel',
    handler: async (req, auth) => {
      const execId = req.params['execId'];
      if (!execId) return badRequest('Missing execution ID');
      try {
        await runtime.cancelExecution(asCtx(auth), execId);
        return ok({ cancelled: true });
      } catch (err) {
        if (err instanceof AccessDeniedError) throw err;
        if (err instanceof Error && err.message.includes('not found')) {
          return notFound(err.message);
        }
        return error(
          400,
          err instanceof Error ? err.message : 'Cancel failed',
        );
      }
    },
  });

  const findCredential = async (auth: TCtx | null, name: string) =>
    (await runtime.getCredentialByName(asCtx(auth), name)) ?? undefined;

  // ── GET /credentials ──
  // Returns a page of visible credential summaries (ACTIVE and REVOKED).
  // Never decrypts or returns stored values.
  routes.push({
    method: 'GET',
    path: '/credentials',
    handler: async (req, auth) => {
      const result = await runtime.listCredentials(asCtx(auth), readPage(req.query));
      return ok({ credentials: result.items, nextCursor: result.nextCursor });
    },
  });

  // ── POST /credentials ──
  // Create a new credential of a connector-declared type. The shape comes from
  // the type's definition, never from the client, and values are validated
  // strictly against it.
  routes.push({
    method: 'POST',
    path: '/credentials',
    handler: async (req, auth) => {
      if (auth === null) {
        return error(401, 'Authentication required to create a credential');
      }
      const capabilities = await runtime.capabilities(auth);
      if (!capabilities.includes('credential:manage')) {
        return error(403, 'Not permitted to create credentials');
      }

      const body = req.body as Record<string, unknown> | undefined;
      if (!body) return badRequest('Request body is required');

      const nameResult = CredentialNameSchema.safeParse(body['name']);
      if (!nameResult.success) {
        return badRequest('Invalid or missing "name"');
      }

      const credType = body['credType'];
      const definition =
        typeof credType === 'string'
          ? runtime.connectors.findCredentialDefinition(credType)
          : undefined;
      if (!definition) {
        return badRequest('Invalid or missing "credType"');
      }

      const credentialAuthResult = CredentialAuthSchema.safeParse({
        authType: definition.authType,
        values: body['values'],
      });
      if (!credentialAuthResult.success) {
        return badRequest(`Invalid "values" for credential type "${definition.credType}"`);
      }

      const input: CreateCredentialInput = {
        name: nameResult.data,
        credType: definition.credType,
        ...credentialAuthResult.data,
      };

      try {
        const cred = await runtime.createCredential(
          body['attributes'] as ResourceAttributes<'credential'>,
          input,
        );
        return created(cred);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/already exists/i.test(msg)) {
          return conflict(`Credential "${input.name}" already exists`);
        }
        throw err;
      }
    },
  });

  // ── PUT /credentials/:name ──
  // Completely replace an existing credential's values. Name and auth type are
  // immutable — the new values are validated against the STORED auth type.
  routes.push({
    method: 'PUT',
    path: '/credentials/:name',
    handler: async (req, auth) => {
      if (auth === null) {
        return error(401, 'Authentication required to update a credential');
      }

      const name = req.params['name'];
      if (!name) return badRequest('Missing credential name');

      const body = req.body as Record<string, unknown> | undefined;
      if (!body || body['values'] === undefined) {
        return badRequest('Body must contain "values"');
      }

      const credential = await findCredential(auth, name);
      if (!credential) {
        return notFound(`Credential "${name}" not found`);
      }
      if (!credential.permittedActions?.includes('credential:manage')) {
        return error(403, `Not permitted to manage credential "${name}"`);
      }
      const { summary } = credential;
      if (summary.status === 'REVOKED') {
        return conflict(`Credential "${name}" is revoked and cannot be updated`);
      }

      let values: AuthSpecificValues;
      try {
        values = validateCredentialValues(summary.authType, body['values']);
      } catch {
        return badRequest(
          `Invalid values for auth type "${summary.authType}"`,
        );
      }

      const updated = await runtime.replaceCredentialValues(
        body['attributes'] as ResourceAttributes<'credential'>,
        name,
        values,
      );
      // Defensive: a concurrent revoke between our lookup and the write would
      // make the adapter return null. Treat that as a 409.
      if (!updated) {
        return conflict(`Credential "${name}" could not be updated`);
      }
      return ok(updated);
    },
  });

  // ── POST /credentials/:name/revoke ──
  // Revoke a credential (terminal ACTIVE → REVOKED). No request body. Idempotent
  // — revoking an already-revoked credential returns its existing summary
  // unchanged.
  routes.push({
    method: 'POST',
    path: '/credentials/:name/revoke',
    handler: async (req, auth) => {
      if (auth === null) {
        return error(401, 'Authentication required to revoke a credential');
      }

      const name = req.params['name'];
      if (!name) return badRequest('Missing credential name');

      const credential = await findCredential(auth, name);
      if (!credential) {
        return notFound(`Credential "${name}" not found`);
      }
      if (!credential.permittedActions?.includes('credential:manage')) {
        return error(403, `Not permitted to manage credential "${name}"`);
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const revoked = await runtime.revokeCredential(
        body['attributes'] as ResourceAttributes<'credential'>,
        name,
      );
      
      if (!revoked) {
        return notFound(`Credential "${name}" not found`);
      }
      return ok(revoked);
    },
  });

  // ─── SSE: Multiplexed Change Stream ───
  //
  // One connection, many topics: `GET /events?workflows=a,b`.
  //
  // The topic set lives in the URL and nowhere else, which is what keeps this
  // working behind a load balancer with no session affinity. There is no
  // server-side subscription to mutate, so a client that wants to watch something
  // new simply reconnects with a different query string — and any pod can serve
  // it, because every pod subscribes to whatever its own clients asked for.
  //
  // Frames are notifications, not payloads: `workflow_changed` says *that* a
  // workflow changed, and the client re-reads through the ordinary authorized
  // GET. `workflows` and `folders` are accepted, and both carry run-level
  // notifications (`run_changed`) as well as definition changes — that is what
  // lets a list stay fresh without a timer.
  //
  // A live execution keeps its own richer stream at `/executions/:execId/stream`,
  // which patches step state in place rather than re-reading; duplicating it
  // here would give it two meanings. The query shape is keyed by entity so
  // further families slot in unchanged.

  routes.push({
    method: 'GET',
    path: '/events',
    handler: async (req, auth) => {
      const eventBus = runtime.eventBus;
      if (!eventBus) {
        return error(501, 'Event streaming not configured');
      }

      const workflowIds = parseIdList(req.query['workflows']);
      const folderIds = parseIdList(req.query['folders']);
      const requested = [
        ...workflowIds.map((id) => ({ kind: 'workflow' as const, id })),
        ...folderIds.map((id) => ({ kind: 'folder' as const, id })),
      ];

      // The root-scope feed, for the unscoped Executions list. The id comes from
      // the authenticated ctx via the host's resolver — never from the query — so a
      // caller can only ever stream its own root scope, and no per-id authz is
      // needed. A root-only subscription (no workflows/folders) is valid.
      const wantsRoot = req.query['root'] === '1';
      const rootId = wantsRoot ? opts.rootId?.(asCtx(auth)) : undefined;

      if (requested.length === 0 && !rootId) {
        return badRequest(
          'Specify at least one id, e.g. ?workflows=a,b or ?folders=f1, or ?root=1',
        );
      }
      if (requested.length > MAX_STREAM_TOPICS) {
        return badRequest(
          `Too many topics (${String(requested.length)}); the limit is ${String(MAX_STREAM_TOPICS)}`,
        );
      }

      // Authorize every id up front, through the same read the client would do.
      // A bus is addressed by resource id and knows nothing about principals, so
      // this is the only place the caller's access is actually decided.
      //
      // One unreadable id does not fail the connection: on a multiplexed stream
      // that would take down every other topic the client is watching, and access
      // can be lost mid-session. The `ready` frame reports what was accepted, so
      // the client is never left believing it is watching something it is not.
      // Each id authorized through the same read the client would do — a folder
      // is no more subscribable than it is readable.
      const subscribed: Array<{ kind: 'workflow' | 'folder'; id: string }> = [];
      const rejected: string[] = [];
      await Promise.all(
        requested.map(async (topic) => {
          try {
            if (topic.kind === 'workflow') await runtime.getWorkflow(asCtx(auth), topic.id);
            else await runtime.getFolder(asCtx(auth), topic.id);
            subscribed.push(topic);
          } catch {
            rejected.push(topic.id);
          }
        }),
      );

      const channel = createEventChannel<BusEvent | typeof KEEPALIVE>();
      const topics: EventTopic[] = subscribed.map((topic) =>
        topic.kind === 'workflow' ? workflowTopic(topic.id) : folderTopic(topic.id),
      );
      if (rootId) topics.push(rootTopic(rootId));
      const results = await Promise.allSettled(
        topics.map((topic) => eventBus.subscribe(topic, channel.push)),
      );
      const unsubs: Unsubscribe[] = results.flatMap((r) =>
        r.status === 'fulfilled' ? [r.value] : [],
      );
      if (unsubs.length !== results.length) {
        // A partially-subscribed stream is worse than none: it looks live and is
        // silently blind to some of its topics. Tear it down and let the client
        // reconnect.
        for (const unsub of unsubs) unsub();
        channel.end();
        return error(503, 'Could not open the event stream');
      }

      const keepalive = setInterval(() => {
        channel.push(KEEPALIVE);
      }, KEEPALIVE_INTERVAL_MS);

      async function* generateSSE(): AsyncIterable<string> {
        try {
          yield formatSSE('ready', {
            subscribed: [...subscribed.map((t) => t.id), ...(rootId ? ['root'] : [])],
            rejected,
          });

          for await (const frame of channel) {
            yield frame === KEEPALIVE ? SSE_KEEPALIVE : formatSSE(frame.event, frame.data);
          }
        } finally {
          clearInterval(keepalive);
          for (const unsub of unsubs) unsub();
          channel.end();
        }
      }

      return {
        status: 200,
        body: null,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
        stream: generateSSE(),
      };
    },
  });

  // ─── SSE: Execution Event Stream ───

  routes.push({
    method: 'GET',
    path: '/executions/:execId/stream',
    handler: async (req, auth) => {
      const execId = req.params['execId'];
      if (!execId) return badRequest('Missing execution ID');

      const eventBus = runtime.eventBus;
      if (!eventBus) {
        return error(501, 'Event streaming not configured');
      }

      // Subscribe BEFORE reading the snapshot, not after.
      //
      // Anything published in between is then delivered twice — once folded into
      // the snapshot, once live — which costs a redundant repaint, because every
      // execution event is idempotent. A miss is not recoverable: drop
      // `execution_completed` and the client sits on an open connection waiting
      // for a frame that has already been and gone. Subscribing second is a race
      // even in-process; against a distributed bus, where subscribe is a network
      // round trip, it is a race you lose regularly.
      //
      // Ordering it this way subscribes fractionally before the caller's access is
      // checked. Nothing is delivered in that window: every failure path below
      // tears the subscription down and drops the channel unread, and the first
      // frame is only ever yielded after `getExecutionDetail` has authorized it.
      const channel = createEventChannel<BusEvent>();
      const unsub = await eventBus.subscribe(executionTopic(execId), channel.push);

      const found = await runtime
        .getExecutionDetail(asCtx(auth), execId)
        .catch((err: unknown) => {
          unsub();
          throw err;
        });
      if (!found) {
        unsub();
        return notFound(`Execution ${execId} not found`);
      }
      // Re-bound after the guard: `generateSSE` is a hoisted declaration, so TS
      // will not carry the null-narrowing of `found` into it.
      const detail = found;

      const isTerminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(
        detail.execution.status,
      );

      async function* generateSSE(): AsyncIterable<string> {
        try {
          // 1. Send the initial snapshot (buffered events wait their turn).
          yield formatSSE('snapshot', {
            ...detail.execution,
            steps: detail.steps,
            config: detail.config,
            triggerData: detail.triggerData,
            summary: detail.summary,
            name: detail.name,
          });

          // 2. If already terminal, close immediately.
          if (isTerminal) return;

          // 3. Drain live events.
          for await (const event of channel) {
            yield formatSSE(event.event, event.data);

            // Close stream on terminal events
            if (
              event.event === 'execution_completed' ||
              event.event === 'execution_failed' ||
              event.event === 'execution_cancelled'
            ) {
              break;
            }
          }
        } finally {
          // Runs however the generator ends — terminal event, client disconnect,
          // or a throw mid-yield.
          unsub();
          channel.end();
        }
      }

      return {
        status: 200,
        body: null,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
        stream: generateSSE(),
      };
    },
  });

  // ─── AI Builder ───

  if (runtime.aiBuilder) {
    const aiCfg = runtime.aiBuilder;
    const modelId = aiCfg.model ?? 'claude-sonnet-4-20250514';
    const maxTokens = aiCfg.maxTokens ?? 16384;

    const aiModel: Model<string> = {
      id: modelId,
      name: modelId,
      api: 'openai-completions',
      provider: 'litellm',
      baseUrl: aiCfg.baseUrl,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens,
    };

    const loopConfig: AgentLoopConfig = {
      model: aiModel,
      getApiKey: () => aiCfg.apiKey,
      maxTokens,
      convertToLlm: (messages) =>
        (messages as Array<{ role: string }>).filter(
          (m) => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult',
        ) as Message[],
    };

    // Tools shared by every Ask AI chat (builder + approval) — `run_code` etc.,
    // always executed through the host sandbox. See agents/builtin/chat-tools.ts.
    const chatTools: AgentTool[] = createChatAgentTools(runtime.sandbox);

    const liveClean = (t: string): string =>
      t.replace(/```[\s\S]*?```/g, '').replace(/```[\s\S]*$/, '').trim();

    // Stream a chat turn over SSE: assistant text snapshots + compact tool-call
    // frames, then a final `done` (and `formfill`/`patch` if produced). An
    // AbortController is aborted in `finally`, so a client disconnect (which
    // ends the generator) cancels the server-side agent loop.
    const streamChat = (
      prompts: UserMessage[],
      context: AgentContext,
      finalize: (text: string) => { message: string; formFill?: Record<string, unknown>; workflowPatch?: WorkflowConfig },
      tag: string,
    ): RouteResponse => {
      async function* generateSSE(): AsyncIterable<string> {
        const controller = new AbortController();
        let assistantText = '';
        try {
          for await (const event of agentLoop(prompts, context, loopConfig, controller.signal) as AsyncIterable<AgentEvent>) {
            if (event.type === 'tool_execution_start') {
              yield formatSSE('tool', { id: event.toolCallId, name: event.toolName, status: 'start' });
            } else if (event.type === 'tool_execution_end') {
              yield formatSSE('tool', { id: event.toolCallId, name: event.toolName, status: 'end', isError: event.isError });
            } else if (event.type === 'message_update' || event.type === 'message_end') {
              const msg = event.message;
              if (msg.role === 'assistant') {
                assistantText = (msg as AssistantMessage).content
                  .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
                  .map((c) => c.text)
                  .join('');
                yield formatSSE('text', { text: liveClean(assistantText) });
              }
            }
          }
        } catch (err) {
          if (err instanceof AccessDeniedError) throw err;
          const m = err instanceof Error ? err.message : String(err);
          console.error(`[${tag}] agentLoop failed:`, m);
          yield formatSSE('error', { error: `LLM call failed: ${m}` });
          return;
        } finally {
          controller.abort();
        }
        const result = finalize(assistantText);
        if (result.formFill) yield formatSSE('formfill', { formFill: result.formFill });
        if (result.workflowPatch) yield formatSSE('patch', { workflowPatch: result.workflowPatch });
        yield formatSSE('done', { message: result.message });
      }
      return {
        status: 200,
        body: null,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
        stream: generateSSE(),
      };
    };

    routes.push({
      method: 'POST',
      path: '/ai-builder/chat',
      access: 'session',
      handler: async (req, auth): Promise<RouteResponse> => {
        const body = req.body as Partial<AiBuilderChatRequest>;

        if (!body.messages || !Array.isArray(body.messages)) {
          return badRequest('messages array is required');
        }

        const acceptHeader = req.headers['accept'];
        const wantsStream = typeof acceptHeader === 'string' && acceptHeader.includes('text/event-stream');
        const mode = (body as { mode?: string }).mode ?? 'builder';

        if (mode === 'approval') {
          const approvalBody = body as Partial<ApprovalChatRequest>;
          if (!approvalBody.executionId) {
            return badRequest('executionId is required for approval mode');
          }
          // The chat always runs inside a specific run, so we load it server-side
          // rather than trusting/transferring a large client blob.
          const detail = await runtime.getExecutionDetail(asCtx(auth), approvalBody.executionId);
          if (!detail) return notFound(`Execution ${approvalBody.executionId} not found`);
          const execCtx: ExecutionDetail = {
            ...detail.execution,
            steps: detail.steps,
            ...(detail.config !== undefined ? { config: detail.config } : {}),
            ...(detail.triggerData !== undefined ? { triggerData: detail.triggerData } : {}),
            ...(detail.summary !== undefined ? { summary: detail.summary } : {}),
            ...(detail.name !== undefined ? { name: detail.name } : {}),
          };
          const workflowContext = buildWorkflowContext(execCtx);
          
          const MAX_MOUNT_BYTES = 16 * 1024 * 1024;
          const mountedPaths = new Map<string, string>();
          const preloadFiles: SandboxFileUpload[] = [];
          if (runtime.storage) {
            for (const att of collectExecutionAttachments(execCtx)) {
              if (typeof att.attachment.size === 'number' && att.attachment.size > MAX_MOUNT_BYTES) continue;
              try {
                const bytes = await createFileAccess(runtime.storage, auth as StorageScope)
                  .buffer(att.attachment, { maxBytes: MAX_MOUNT_BYTES });
                preloadFiles.push({ path: att.sandboxPath, bytes });
                mountedPaths.set(att.attachment.handle, att.sandboxPath);
              } catch {
                // Unavailable — left unmounted; annotated with sandboxPath: null.
              }
            }
          }
          preloadFiles.unshift({
            path: EXECUTION_DATA_PATH,
            bytes: new TextEncoder().encode(buildExecutionDataFile(execCtx, mountedPaths)),
          });
          const approvalTools = createChatAgentTools(runtime.sandbox, preloadFiles);

          const currentFormValues = (approvalBody as Partial<ApprovalChatRequest>).currentFormValues;
          const formValuesSection = currentFormValues && Object.keys(currentFormValues).length > 0
            ? `\n\nCurrent form values (live state as of this message — what is actually filled in the form right now):\n\`\`\`json\n${JSON.stringify(currentFormValues, null, 2)}\n\`\`\``
            : '';

          // Explicitly extract form fields so the model has an unambiguous list to work through.
          const pauseStep = execCtx.steps.find((s) => s.status === 'EXTERNAL_WAIT');
          let formFieldsSection = '';
          try {
            const pauseData = pauseStep?.data ? JSON.parse(pauseStep.data) as Record<string, unknown> : null;
            const fields = (pauseData?.['pauseState'] as Record<string, unknown> | undefined)?.['form'] as { fields?: Array<{ name: string; label: string; required?: boolean }> } | undefined;
            if (fields?.fields && fields.fields.length > 0) {
              const fieldList = fields.fields.map((f, i) =>
                `  ${i + 1}. name="${f.name}" label="${f.label}" required=${f.required ?? false}`
              ).join('\n');
              formFieldsSection = `\n\nForm fields to collect (${fields.fields.length} total — you must ask for ALL of these before outputting the formfill block):\n${fieldList}`;
            }
          } catch { /* ok */ }

          const systemPrompt = `${APPROVAL_AI_SYSTEM_PROMPT}\n\nWorkflow structure:\n${workflowContext}${formFieldsSection}${formValuesSection}`;
          // Build full conversation history so the model remembers prior turns.
          // body.messages contains the complete history (user + assistant) sent by the client.
          // We pass everything except the last message as context, and the last message as the prompt.
          const allMessages = [...body.messages];
          const currentMsg = allMessages[allMessages.length - 1];
          const historyMsgs = allMessages.slice(0, -1);

          const context: AgentContext = {
            systemPrompt,
            messages: historyMsgs.map((m) =>
              m.role === 'user'
                ? ({ role: 'user' as const, content: m.content, timestamp: Date.now() } as UserMessage)
                : ({ role: 'assistant' as const, content: [{ type: 'text' as const, text: m.content }], timestamp: Date.now() } as AssistantMessage),
            ),
            tools: approvalTools,
          };
          const prompts: UserMessage[] = currentMsg
            ? [{ role: 'user' as const, content: currentMsg.content, timestamp: Date.now() }]
            : [];

          // Final cleaning + form-fill extraction, shared by stream + JSON paths.
          const finalizeApproval = (text: string): { message: string; formFill?: Record<string, unknown> } => {
            const formFill = parseFormFill(text);
            const message = text.replace(/```json:formfill[\s\S]*?```/mg, '').trim() || 'Done.';
            return formFill ? { message, formFill } : { message };
          };

          if (wantsStream) {
            return streamChat(prompts, context, finalizeApproval, 'approval-ai');
          }

          let assistantText = '';
          try {
            for await (const event of agentLoop(prompts, context, loopConfig) as AsyncIterable<AgentEvent>) {
              if (event.type === 'message_end') {
                const msg = (event as Extract<AgentEvent, { type: 'message_end' }>).message;
                if (msg.role === 'assistant') {
                  assistantText = (msg as AssistantMessage).content
                    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
                    .map((c) => c.text)
                    .join('');
                }
              }
            }
          } catch (err) {
            if (err instanceof AccessDeniedError) throw err;
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[approval-ai] agentLoop failed:', msg);
            return { status: 502, body: { error: `LLM call failed: ${msg}` } };
          }

          const { message: cleanMessage, formFill } = finalizeApproval(assistantText);
          const response: ApprovalChatResponse = formFill
            ? { message: cleanMessage, formFill }
            : { message: cleanMessage };
          return ok(response);
        }

        // ── Builder mode (default) ──
        const builderBody = body as Partial<BuilderChatRequest>;
        if (!builderBody.currentConfig) {
          return badRequest('currentConfig is required');
        }

        let messages = [...body.messages];
        const uploadedFile = req.files?.[0];
        if (uploadedFile && runtime.storage) {
          const fileText = await aiBuilderFileText(
            runtime.storage,
            uploadedFile.attachment,
            auth as StorageScope,
          );
          if (fileText) {
            const lastUserIdx = [...messages].reverse().findIndex((m) => m.role === 'user');
            if (lastUserIdx !== -1) {
              const idx = messages.length - 1 - lastUserIdx;
              messages = [...messages];
              messages[idx] = {
                ...messages[idx]!,
                content: `${messages[idx]!.content}\n\n--- Attached: ${uploadedFile.attachment.name} ---\n${fileText}`,
              };
            }
          }
        }

        const configSummary = JSON.stringify(builderBody.currentConfig, null, 2);
        const systemWithConfig =
          `${AI_BUILDER_SYSTEM_PROMPT}\n\n` +
          `Current workflow config:\n\`\`\`json\n${configSummary}\n\`\`\``;

        const context: AgentContext = { systemPrompt: systemWithConfig, messages: [], tools: chatTools };

        const prompts: UserMessage[] = messages
          .filter((m) => m.role === 'user')
          .map((m) => ({ role: 'user' as const, content: m.content, timestamp: Date.now() }));

        // Final cleaning + workflow-patch extraction, shared by stream + JSON paths.
        const finalizeBuilder = (text: string): { message: string; workflowPatch?: WorkflowConfig } => {
          const parsed = parseWorkflowPatch(text);
          let message: string;
          if (parsed) {
            const lastFenceEnd = text.lastIndexOf('```');
            const trailing = lastFenceEnd !== -1 ? text.slice(lastFenceEnd + 3).trim() : '';
            message = trailing || 'Workflow updated.';
          } else {
            message = text.replace(/```(?:json)?\s*[\s\S]*?```/gm, '').trim() || 'No changes made.';
          }
          return parsed ? { message, workflowPatch: parsed.patch as WorkflowConfig } : { message };
        };

        if (wantsStream) {
          return streamChat(prompts, context, finalizeBuilder, 'ai-builder');
        }

        let assistantText = '';
        try {
          for await (const event of agentLoop(prompts, context, loopConfig) as AsyncIterable<AgentEvent>) {
            if (event.type === 'message_end') {
              const msg = (event as Extract<AgentEvent, { type: 'message_end' }>).message;
              if (msg.role === 'assistant') {
                assistantText = (msg as AssistantMessage).content
                  .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
                  .map((c) => c.text)
                  .join('');
              }
            }
          }
        } catch (err) {
          if (err instanceof AccessDeniedError) throw err;
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[ai-builder] agentLoop failed:', msg);
          return { status: 502, body: { error: `LLM call failed: ${msg}` } };
        }

        const { message, workflowPatch } = finalizeBuilder(assistantText);
        const response: BuilderChatResponse = workflowPatch
          ? { message, workflowPatch }
          : { message };

        return ok(response);
      },
    });
  }

  // ─── Conversations: a run answered turn by turn ───

  routes.push(...conversationRoutes(runtime, asCtx));

  // Uniformly map the runtime's two authorization outcomes to HTTP across every
  // handler, so enforcement in the runtime surfaces as a proper status rather
  // than a 500 — and so a new route cannot forget to do it.
  return routes.map((route) => ({
    ...route,
    // A route that does not declare its access needs a signed-in user, so
    // forgetting to classify one never mounts it open.
    access: route.access ?? 'session',
    handler: async (req, auth) => {
      try {
        return await route.handler(req, auth);
      } catch (err) {
        if (err instanceof AccessDeniedError) {
          return { status: 403, body: { error: err.message } };
        }
        if (err instanceof ResourceNotFoundError) {
          return { status: 404, body: { error: err.message } };
        }
        throw err;
      }
    },
  }));
}

// ─── AI Builder helpers ───

const AI_BUILDER_SYSTEM_PROMPT = `You are a workflow automation assistant. Output valid WorkflowConfig JSON.

## WorkflowConfig shape
\`\`\`
{
  "trigger": { "type": "MANUAL|WEBHOOK|CRON|EVENT", "config": {} },
  "steps": [
    { "id": "snake_case_id", "type": "STEP_TYPE", "name": "Human Name", "config": {} }
  ]
}
\`\`\`

## Step types (UPPERCASE only)
HTTP_REQUEST, CODE, CONDITIONAL, SWITCH, LOOP, PARALLEL, WAIT, DEDUP, RUN_AGENT

## Trigger types (UPPERCASE only)
MANUAL, WEBHOOK, CRON, EVENT

## CRITICAL: Steps array is ALWAYS flat
- Never nest a "steps" array inside a step's config.
- CONDITIONAL and SWITCH configs reference other steps by their snake_case id string only.
- Example CONDITIONAL: { "condition": "context.x > 0", "on_true": "step_a", "on_false": "step_b" }
- Example SWITCH: { "expression": "context.status", "cases": { "approved": "approve_step", "rejected": "reject_step" }, "default": "default_step" }
- All steps live in the top-level "steps" array, never inside another step's config.

## STRICT OUTPUT RULES — follow exactly
1. BEGIN your response IMMEDIATELY with the \`\`\`json code block. Do not write a single word, explanation, or reasoning before the opening \`\`\`json.
2. The \`\`\`json block must contain the ENTIRE WorkflowConfig (trigger + all steps together).
3. The JSON MUST have both "trigger" and "steps" at the top level.
4. Never split the config across multiple code blocks. Never output partial configs.
5. After the SINGLE closing \`\`\` fence, write ONE sentence describing what changed.
6. Do not explain, do not think aloud, do not ask questions — start with \`\`\`json immediately.

## Example of correct output format
\`\`\`json
{
  "trigger": { "type": "MANUAL", "config": {} },
  "steps": [
    { "id": "fetch_data", "type": "HTTP_REQUEST", "name": "Fetch Data", "config": { "url": "https://api.example.com", "method": "GET" } }
  ]
}
\`\`\`
Added one HTTP_REQUEST step that fetches from the example API.`;

const APPROVAL_AI_SYSTEM_PROMPT = `You are an assistant helping a human review a paused workflow execution.
Below you are given the workflow's STRUCTURE (its steps and what it does), its trigger inputs, and the current pause state (form fields + current values).
The FULL run data — every step's actual input and output — is NOT in this prompt. It is written to a file at /mnt/files/execution.json. To answer any question about real values or outputs (e.g. "where did this number come from", "what did a step produce", "what did the research find"), use the run_code tool to read that file with Python and print what you need. In that file each step has a stepName, status, executorType, and data: { type, input, output }. A step's stepName is its config id — for a step running inside a loop or branch it is a path like parent:branch#iteration/leaf_id. Match that id (the last path segment) to the same id in the Workflow structure below to see what the step does and its title.
Files the workflow used or produced (uploaded documents, generated reports/PDFs/spreadsheets/HTML) are mounted in the sandbox. Every attachment object in execution.json has a "sandboxPath" field with its location (under /mnt/files/attachments/<step>/<name>) — open that path with run_code to inspect the real bytes (e.g. parse the xlsx with openpyxl, read the PDF, view the HTML). A null sandboxPath means the file was not mounted (too large or unavailable); fall back to the related text outputs in that case.

## What you can do
- Answer questions about the execution: read /mnt/files/execution.json with run_code for any actual value, then answer.
- Fill the form interactively: collect each empty field's value from the user one at a time, then output the formfill block.

## Core principle
The user's most recent message is the only thing that matters. Answer it directly and completely. Prior conversation turns are context only — never summarise, repeat, or reference them unless the current question explicitly requires it.

## Rules

**Tool calls, not narration:** Whenever answering requires inspecting the run — reading /mnt/files/execution.json or any mounted attachment — call the run_code tool immediately. Do NOT emit any text before, between, or instead of a tool call: no "Let me check…", no announcing or describing what you are about to do, no restating the plan. Text output is reserved solely for your final answer once you have the tool results (or when the question needs no tool at all). If you need a tool, your turn must be the tool call and nothing else.

**Answering questions:** The answer to the immediate question is the entire response. Do not add anything before or after it. Do not mention what was discussed earlier. Do not reference form values or prior answers unless the question is specifically about them.

**Form fill:** When asked to fill the form, ask for one empty field at a time. Skip fields that already have a non-empty value in "Current form values" — only ask for truly empty fields. Ask for every empty field — required and optional alike — unless the user explicitly says to skip optional fields. After receiving a value, immediately ask for the next empty field without restating what was just provided. Keep an internal count of remaining empty fields and do NOT output the formfill block until you have explicitly asked for and received a response for every single empty field (or the user has said to skip it). Outputting the formfill block early — before all empty fields are collected — is strictly forbidden, even if you believe the form is complete.

**No value suggestions:** Never guess or infer values. If asked to suggest, say you can only fill values the user provides explicitly.

**"Current form values" is silent context:** Use it only when directly asked "what is in field X?". Never mention, list, or summarise these values in any other response.

**No state summaries:** Never open a response with a recap of field values collected so far. Never say "Noted: X" or "Central Ops Employee ID: 12345" as a preamble. Go straight to the point.

**Be concise:** One or two sentences unless collecting form values. No workflow summaries unless asked.

## Form fill output (only when all values confirmed by user)
\`\`\`json:formfill
{ "fieldKey": "user-provided value" }
\`\`\``;

/** Is this something whose text we can paste into a prompt? */
function aiBuilderIsText(ref: Attachment): boolean {
  const name = ref.name.toLowerCase();
  return (
    ref.mimeType.startsWith('text/') ||
    ref.mimeType === 'application/json' ||
    name.endsWith('.md') ||
    name.endsWith('.txt') ||
    name.endsWith('.json') ||
    name.endsWith('.csv')
  );
}

/**
 * The attached file's text, for the builder prompt.
 *
 * Capped: this ends up inside a model request, so a file too big to be a prompt
 * is not worth reading in the first place.
 */
const AI_BUILDER_MAX_FILE_BYTES = 1024 * 1024;

async function aiBuilderFileText(
  storage: NonNullable<WorkflowRuntime['storage']>,
  ref: Attachment,
  scope: StorageScope,
): Promise<string | undefined> {
  if (!aiBuilderIsText(ref)) return undefined;
  try {
    const bytes = await createFileAccess(storage, scope).buffer(ref, {
      maxBytes: AI_BUILDER_MAX_FILE_BYTES,
    });
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Strips leading "FieldName: value" summary lines that the model tends to
 * prepend even when instructed not to. Matches lines like:
 *   "Central Ops Employee ID: 3245y6"
 *   "Central Ops Employee ID is currently 3245y6."
 * Only strips from the very top of the text (blank lines ignored).
 */

interface ParseResult {
  patch: object;
  cleanText: string;
}

function parseWorkflowPatch(text: string): ParseResult | undefined {
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gm;
  let match: RegExpExecArray | null;
  let lastValid: { matchStr: string; patch: object } | undefined;
  while ((match = fenceRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]!) as unknown;
      if (parsed !== null && typeof parsed === 'object' && 'trigger' in parsed && 'steps' in parsed) {
        lastValid = { matchStr: match[0], patch: parsed };
      }
    } catch { /* skip */ }
  }
  if (lastValid) {
    return { patch: lastValid.patch, cleanText: text.replace(lastValid.matchStr, '').trim() };
  }

  let searchFrom = 0;
  while (searchFrom < text.length) {
    const braceStart = text.indexOf('{', searchFrom);
    if (braceStart === -1) break;
    let depth = 0;
    let i = braceStart;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) break; }
    }
    if (depth === 0) {
      const candidate = text.slice(braceStart, i + 1);
      try {
        const parsed = JSON.parse(candidate) as unknown;
        if (parsed !== null && typeof parsed === 'object' && 'trigger' in parsed && 'steps' in parsed) {
          return { patch: parsed, cleanText: (text.slice(0, braceStart) + text.slice(i + 1)).trim() };
        }
      } catch { /* keep searching */ }
    }
    searchFrom = braceStart + 1;
  }

  return undefined;
}

function parseFormFill(text: string): Record<string, unknown> | undefined {
  const match = /```json:formfill\s*([\s\S]*?)```/m.exec(text);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1]!) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch { /* ignore */ }
  return undefined;
}

const RESUME_ACTIONS: ReadonlySet<ResumeAction> = new Set<ResumeAction>([
  'approve',
  'retry',
  'abort',
]);

/**
 * Validate an arbitrary JSON body into a typed `ResumePayload`.
 * Returns null if `action` is missing or not one of the allowed values.
 */
function parseResumePayload(raw: unknown): ResumePayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const action = obj['action'];
  if (typeof action !== 'string' || !RESUME_ACTIONS.has(action as ResumeAction)) {
    return null;
  }

  const payload: ResumePayload = { action: action as ResumeAction };
  if (typeof obj['feedback'] === 'string') {
    payload.feedback = obj['feedback'];
  }
  const attachments = obj['attachments'];
  if (Array.isArray(attachments)) {
    const cleaned: ResumeAttachment[] = [];
    for (const a of attachments) {
      if (a && typeof a === 'object' && !Array.isArray(a)) {
        const rec = a as Record<string, unknown>;
        if (
          typeof rec['name'] === 'string' &&
          typeof rec['mimeType'] === 'string' &&
          typeof rec['handle'] === 'string'
        ) {
          cleaned.push({
            name: rec['name'],
            mimeType: rec['mimeType'],
            handle: rec['handle'],
          });
        }
      }
    }
    if (cleaned.length > 0) payload.attachments = cleaned;
  }
  const data = obj['data'];
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    payload.data = data as Record<string, unknown>;
  }
  return payload;
}
