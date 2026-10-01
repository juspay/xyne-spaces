import type {
  CredentialAuthType,
  CredentialStatus,
  CredentialSummary,
  ExecutionOrigin,
  ExecutionRecord,
  FolderRecord,
  StepRecord,
  WorkflowRecord,
} from '@xyne/workflow-sdk';
import type { Workflow, WorkflowFolder } from '@prisma/client';
import { DEFAULT_FOLDER_ID } from './constants';
import type { XyneResourceAttrs } from './types';

// ─── Cursor codec ────────────────────────────────────────────────────────────

/**
 * Executions are listed newest-first and paged by `createdAt`, so the cursor is just
 * that timestamp. Base64 so it is opaque to clients and cannot be hand-edited into a
 * different query shape.
 */
export const encodeCursor = (at: Date): string =>
  Buffer.from(String(at.getTime())).toString('base64');

export const decodeCursor = (cursor: string): Date =>
  new Date(Number(Buffer.from(cursor, 'base64').toString()));

/**
 * A positional cursor over the columns an ORDER BY names, in the same order.
 *
 * Deliberately NOT "the row with this id": rows leave these lists by design — an
 * approval gets approved, a run resumes — and a cursor that looks its row up by
 * id returns an empty page the moment someone resolves the row it names,
 * stranding everything behind it. A tuple comparison has no such row to lose,
 * and stays an indexed seek at any depth.
 *
 * Base64 so it is opaque to clients and cannot be hand-edited into another query.
 */
export const encodeSeek = (parts: readonly string[]): string =>
  Buffer.from(JSON.stringify(parts)).toString('base64');

export const decodeSeek = (cursor: string): string[] | null => {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64').toString());
    return Array.isArray(parsed) && parsed.every((part) => typeof part === 'string')
      ? (parsed as string[])
      : null;
  } catch {
    // A cursor we cannot read is a cursor we ignore: serving page one beats 500.
    return null;
  }
};

export const readTagsFromMetadata = (metadata: string | null): string[] | null => {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { tags?: unknown };
    if (!Array.isArray(parsed.tags)) return null;
    const tags = parsed.tags.filter((t): t is string => typeof t === 'string');
    return tags.length > 0 ? tags : null;
  } catch {
    return null;
  }
};

/** `parallel_x:swot#0/approve` -> `approve`. The label; the path is what resumes. */
export const leafStepId = (nodePath: string): string => {
  const leaf = nodePath.slice(nodePath.lastIndexOf('/') + 1);
  return leaf.length > 0 ? leaf : nodePath;
};

/**
 * The author's own title for a step, from the workflow's stored config.
 *
 * The leaf id is what the engine addresses; the title is what a reviewer
 * recognises. Searched rather than indexed because a step may sit at any depth
 * inside parallels and loops. An unparseable config costs the label, never the row.
 */
export const readStepTitleFromConfig = (config: string | null, stepId: string): string | null => {
  if (!config) return null;
  let found: string | null = null;
  const walk = (node: unknown): void => {
    if (found !== null || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const record = node as Record<string, unknown>;
    if (record['id'] === stepId && typeof record['title'] === 'string' && record['title']) {
      found = record['title'];
      return;
    }
    for (const value of Object.values(record)) walk(value);
  };
  try {
    walk(JSON.parse(config));
  } catch {
    return null;
  }
  return found;
};

// ─── Row → SDK record mappers ────────────────────────────────────────────────

export const readNameFromMetadata = (metadata: string | null): string | null => {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { name?: unknown };
    return typeof parsed.name === 'string' ? parsed.name : null;
  } catch {
    return null;
  }
};

export const toWorkflowRecord = (row: Workflow): WorkflowRecord => ({
  id: row.id,
  status: row.status,
  config: row.context,
  metadata: row.metadata,
  eventType: row.eventType,
  summary: row.summary,
  folderId: row.folderId ?? DEFAULT_FOLDER_ID,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  attributes: { workspaceId: row.workspaceId } satisfies XyneResourceAttrs,
});

export const toFolderRecord = (row: WorkflowFolder): FolderRecord => ({
  id: row.id,
  name: row.name,
  metadata: row.metadata,
  parentId: row.parentId,
  attributes: { workspaceId: row.workspaceId } satisfies XyneResourceAttrs,
});

export const toExecutionRecord = (
  row: {
    id: string;
    workflowId: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    parentWorkflowExecutionId: string | null;
    tag: string;
  },
  workflowMetadata: string | null,
  /** The scheduling columns from the run's state row, for a run that waited. */
  scheduling?: SchedulingColumns | null,
): ExecutionRecord => ({
  id: row.id,
  workflowId: row.workflowId,
  status: row.status,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  ...(row.tag === 'rerun' && row.parentWorkflowExecutionId
    ? { sourceExecutionId: row.parentWorkflowExecutionId }
    : {}),
  ...schedulingFacts(scheduling),
  workflowName: readNameFromMetadata(workflowMetadata) ?? row.workflowId,
});

interface SchedulingColumns {
  fireAt: Date | null;
  origin: string | null;
  endReason: string | null;
}

const schedulingFacts = (
  scheduling: SchedulingColumns | null | undefined,
): Partial<Pick<ExecutionRecord, 'fireAt' | 'origin' | 'endReason'>> => {
  if (!scheduling) return {};
  const origin = parseOrigin(scheduling.origin);
  return {
    ...(scheduling.fireAt ? { fireAt: scheduling.fireAt } : {}),
    ...(origin ? { origin } : {}),
    ...(scheduling.endReason ? { endReason: scheduling.endReason } : {}),
  };
};

const parseOrigin = (raw: string | null): ExecutionOrigin | null => {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isExecutionOrigin(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const isExecutionOrigin = (value: unknown): value is ExecutionOrigin => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = (value as { event?: unknown }).event;
  if (typeof event !== 'object' || event === null) return false;
  const { type, payload } = event as { type?: unknown; payload?: unknown };
  return typeof type === 'string' && typeof payload === 'object' && payload !== null;
};

/** `stepName` is nullable on the shared table but always set on rows the adapter writes. */
export const toStepRecord = (row: {
  stepName: string | null;
  status: string | null;
  stepExecutorType: string;
  data: string | null;
}): StepRecord => ({
  stepName: row.stepName ?? '',
  status: row.status ?? '',
  executorType: row.stepExecutorType,
  data: row.data,
});

export const toCredentialSummary = (row: {
  name: string;
  credType: string;
  authType: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): CredentialSummary => ({
  name: row.name,
  credType: row.credType,
  authType: row.authType as CredentialAuthType,
  status: row.status as CredentialStatus,
  createdAt: row.createdAt.getTime(),
  updatedAt: row.updatedAt.getTime(),
});

// ─── Guards ──────────────────────────────────────────────────────────────────

export const attrsOf = (attributes: unknown): XyneResourceAttrs | undefined =>
  attributes as XyneResourceAttrs | undefined;

export const requireWorkspaceId = (attributes: unknown, method: string): string => {
  const workspaceId = attrsOf(attributes)?.workspaceId;
  if (!workspaceId) {
    throw new Error(
      `workflows persistence: ${method} called without attributes.workspaceId — ` +
        'the route must inject it from the session before dispatching to the SDK',
    );
  }
  return workspaceId;
};

export const notBacked = (method: string, reason: string): never => {
  throw new Error(`workflows persistence: ${method} is not available — ${reason}`);
};
