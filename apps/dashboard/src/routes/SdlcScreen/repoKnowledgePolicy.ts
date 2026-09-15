import { SDLC_SETUP_STATUSES, type SdlcSetupStatus } from '@xyne/shared/sdlc';

export type RepoKnowledgeControl = 'GENERATE' | 'CANCEL' | 'RETRY' | 'REFRESH';

export interface RepoKnowledgeAction {
  key: string;
  label: string;
  path: 'setup' | 'setup/cancel' | 'setup/retry' | 'setup/refresh';
  success: string;
}

const REPO_KNOWLEDGE_ACTIONS: Record<RepoKnowledgeControl, RepoKnowledgeAction> = {
  GENERATE: {
    key: 'knowledge-generate',
    label: 'Generate Repo Knowledge',
    path: 'setup',
    success: 'Repo Knowledge generation queued',
  },
  CANCEL: {
    key: 'knowledge-cancel',
    label: 'Cancel',
    path: 'setup/cancel',
    success: 'Repo Knowledge generation cancelled',
  },
  RETRY: {
    key: 'knowledge-retry',
    label: 'Retry Repo Knowledge',
    path: 'setup/retry',
    success: 'Repo Knowledge retry queued',
  },
  REFRESH: {
    key: 'knowledge-refresh',
    label: 'Refresh Repo Knowledge',
    path: 'setup/refresh',
    success: 'Repo Knowledge refresh queued',
  },
};

export interface RepoKnowledgeState {
  phase: SdlcSetupStatus;
  error?: string;
  conversationId?: string;
  sessionId?: string;
  currentBaselineKind?: string;
  completedCount: number;
  updatedAt?: number;
}

function isSetupStatus(value: unknown): value is SdlcSetupStatus {
  return typeof value === 'string' && SDLC_SETUP_STATUSES.includes(value as SdlcSetupStatus);
}

export function repoKnowledgeState(
  execution:
    | { status?: string; context?: string | null; updatedAt?: number | null }
    | null
    | undefined,
): RepoKnowledgeState {
  if (!execution) return { phase: 'NOT_STARTED', completedCount: 0 };
  try {
    const context = JSON.parse(execution.context || '{}') as {
      phase?: unknown;
      error?: string;
      conversationId?: string;
      sessionId?: string;
      currentBaselineKind?: string;
      completedBaselineKinds?: unknown;
    };
    const phase =
      execution.status === 'FAILURE'
        ? 'PARTIALLY_FAILED'
        : execution.status === 'CANCELLED'
          ? 'CANCELLED'
          : isSetupStatus(context.phase)
            ? context.phase
            : execution.status === 'SUCCESS'
              ? 'READY_FOR_REVIEW'
              : execution.status === 'RUNNING'
                ? 'GENERATING'
                : 'QUEUED';
    return {
      phase,
      completedCount: Array.isArray(context.completedBaselineKinds)
        ? context.completedBaselineKinds.length
        : 0,
      ...((context.error || execution.status === 'FAILURE') && {
        error: context.error || 'Setup failed. Retry the run.',
      }),
      ...(context.conversationId && { conversationId: context.conversationId }),
      ...(context.sessionId && { sessionId: context.sessionId }),
      ...(context.currentBaselineKind && { currentBaselineKind: context.currentBaselineKind }),
      ...(typeof execution.updatedAt === 'number' && { updatedAt: execution.updatedAt }),
    };
  } catch {
    return {
      phase:
        execution.status === 'FAILURE'
          ? 'PARTIALLY_FAILED'
          : execution.status === 'CANCELLED'
            ? 'CANCELLED'
            : execution.status === 'SUCCESS'
              ? 'READY_FOR_REVIEW'
              : execution.status === 'RUNNING'
                ? 'GENERATING'
                : 'QUEUED',
      completedCount: 0,
      ...(typeof execution.updatedAt === 'number' && { updatedAt: execution.updatedAt }),
    };
  }
}

export function repoKnowledgeControl(phase: SdlcSetupStatus): RepoKnowledgeControl {
  switch (phase) {
    case 'NOT_STARTED':
      return 'GENERATE';
    case 'QUEUED':
    case 'CLONING':
    case 'GENERATING':
      return 'CANCEL';
    case 'PARTIALLY_FAILED':
    case 'CANCELLED':
      return 'RETRY';
    case 'READY_FOR_REVIEW':
    case 'APPROVED':
      return 'REFRESH';
  }
}

export function isRepoKnowledgeRunning(phase: SdlcSetupStatus): boolean {
  return repoKnowledgeControl(phase) === 'CANCEL';
}

export function repoKnowledgeAction(control: RepoKnowledgeControl): RepoKnowledgeAction {
  return REPO_KNOWLEDGE_ACTIONS[control];
}

export function canDebugRepoKnowledge(input: {
  isAdmin: boolean;
  executionId: string | null | undefined;
  conversationId: string | null | undefined;
}): boolean {
  return Boolean(input.isAdmin && input.executionId && input.conversationId);
}

export type RepoSetupExecution = {
  id: string;
  status: string;
  context: string | null;
  updatedAt: number | null;
};
