/**
 * Repo Knowledge is a workflow run, so its controls are the run's: start one, or stop
 * the one going. No refresh or retry — a second run updates what the first produced.
 */

import { SDLC_ACTIVE_RUN_STATUSES } from '@xyne/shared';

const ACTIVE_RUN_STATUSES: ReadonlySet<string> = new Set(SDLC_ACTIVE_RUN_STATUSES);

export type RepoKnowledgePhase = 'NOT_CONFIGURED' | 'NOT_STARTED' | 'RUNNING' | 'READY' | 'FAILED';

export interface RepoKnowledgeRun {
  id: string;
  status: string;
  updatedAt?: number | null;
}

export interface RepoKnowledgeState {
  phase: RepoKnowledgePhase;
  workflowId?: string;
  runId?: string;
  updatedAt?: number;
}

export function repoKnowledgeState(input: {
  workflowId?: string | null;
  runs?: readonly RepoKnowledgeRun[] | null;
}): RepoKnowledgeState {
  if (!input.workflowId) return { phase: 'NOT_CONFIGURED' };

  // Newest-first from the query. An older failure is history, not a problem.
  const latest = input.runs?.[0];
  if (!latest) return { phase: 'NOT_STARTED', workflowId: input.workflowId };

  const phase: RepoKnowledgePhase = ACTIVE_RUN_STATUSES.has(latest.status)
    ? 'RUNNING'
    : latest.status === 'COMPLETED' || latest.status === 'SUCCESS'
      ? 'READY'
      : 'FAILED';

  return {
    phase,
    workflowId: input.workflowId,
    runId: latest.id,
    ...(typeof latest.updatedAt === 'number' ? { updatedAt: latest.updatedAt } : {}),
  };
}

export interface RepoKnowledgeAction {
  key: string;
  label: string;
  success: string;
}

export const RUN_REPO_KNOWLEDGE: RepoKnowledgeAction = {
  key: 'knowledge-run',
  label: 'Generate Repo Knowledge',
  success: 'Repo Knowledge generation started',
};

export const CANCEL_REPO_KNOWLEDGE: RepoKnowledgeAction = {
  key: 'knowledge-cancel',
  label: 'Cancel',
  success: 'Repo Knowledge generation cancelled',
};

export function repoKnowledgeAction(phase: RepoKnowledgePhase): RepoKnowledgeAction {
  return phase === 'RUNNING' ? CANCEL_REPO_KNOWLEDGE : RUN_REPO_KNOWLEDGE;
}
