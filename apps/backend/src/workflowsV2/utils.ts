import type {
  CredentialAuthType,
  CredentialStatus,
  CredentialSummary,
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
): ExecutionRecord => ({
  id: row.id,
  workflowId: row.workflowId,
  status: row.status,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  ...(row.tag === 'rerun' && row.parentWorkflowExecutionId
    ? { sourceExecutionId: row.parentWorkflowExecutionId }
    : {}),
  workflowName: readNameFromMetadata(workflowMetadata) ?? row.workflowId,
});

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
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): CredentialSummary => ({
  name: row.name,
  authType: row.credType as CredentialAuthType,
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
