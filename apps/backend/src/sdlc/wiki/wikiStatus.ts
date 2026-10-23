import { SDLC_WIKI_WORKFLOW_RELATION } from '@xyne/shared';
import { leafStepId } from '@xyne/workflow-sdk';
import { db } from '@/database/client';
import { TERMINAL_EXECUTION_STATUSES } from '@/workflowsV2/constants';
import { repoIdsForChannel } from '../sdlcChannelMembership';
import { PLAN_STEP_ID, WINDOW_DONE_STEP_ID, wikiHistory } from './wikiPlanStep';

export type RepositoryWikiPhase = 'queued' | 'running' | 'failed' | 'up to date' | 'behind';

export interface RepositoryWikiStatus {
  repoId: string;
  phase: RepositoryWikiPhase;
  windowsDone: number;
  windowsPlanned: number;
  documentedSha: string | null;
  headSha: string | null;
  error: string | null;
}

interface PlannedRepository {
  repoId: string;
  fromSha: string | null;
  headSha: string;
  windows: Array<{ afterSha: string }>;
  error?: string | null;
}

const TERMINAL: ReadonlySet<string> = new Set(TERMINAL_EXECUTION_STATUSES);

function stepData(row: { data: string | null }): { input?: { generationCommit?: unknown }; output?: unknown; error?: unknown } {
  try {
    return JSON.parse(row.data ?? '{}');
  } catch {
    return {};
  }
}

/** Each hub repository's Wiki state, from the active run, or else the last run that planned windows. */
export async function wikiStatus(channelId: string): Promise<RepositoryWikiStatus[]> {
  const repoIds = await repoIdsForChannel(db, channelId);
  const link = await db.sdlcEntityLink.findFirst({
    where: { channelId, sourceType: 'CHANNEL', targetType: 'WORKFLOW', relationType: SDLC_WIKI_WORKFLOW_RELATION },
    select: { targetId: true },
  });
  const executions = link
    ? await db.workflowExecution.findMany({
        where: { workflowId: link.targetId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, status: true },
      })
    : [];

  let execution: { id: string; status: string } | undefined;
  let steps: Array<{ stepName: string | null; status: string | null; data: string | null }> = [];
  let planned: PlannedRepository[] = [];
  // The newest active run wins; a run Plan skipped has nothing to show, so look past it.
  for (const candidate of [...executions.filter((run) => !TERMINAL.has(run.status)), ...executions]) {
    steps = await db.workflowStep.findMany({
      where: { workflowExecutionId: candidate.id },
      select: { stepName: true, status: true, data: true },
    });
    const plan = steps.find((step) => step.stepName === PLAN_STEP_ID && step.status === 'COMPLETED');
    const output = plan ? (stepData(plan).output as { skipped?: boolean; repositories?: PlannedRepository[] } | undefined) : undefined;
    if (output?.skipped) continue;
    execution = candidate;
    planned = output?.repositories ?? [];
    break;
  }

  const windowSteps = steps.flatMap((step) => {
    const commit = stepData(step).input?.generationCommit;
    return typeof commit === 'string' && step.stepName
      ? [{ sha: commit.toLowerCase(), leaf: leafStepId(step.stepName), status: step.status, data: step.data }]
      : [];
  });
  const active = execution !== undefined && !TERMINAL.has(execution.status);
  // Where each repository got to in any run, for the ones this run does not cover.
  const history = link ? await wikiHistory(link.targetId) : null;
  const pastRepositories = (repoId: string) =>
    (history?.plans ?? []).flatMap((plan) => plan.repositories.filter((repository) => repository.repoId === repoId));
  const lastDocumented = (repoId: string): string | null => {
    const shas = new Set(pastRepositories(repoId).flatMap((repository) => repository.windowShas));
    return history?.written.filter((commit) => shas.has(commit.sha)).at(-1)?.sha ?? null;
  };

  return repoIds.map((repoId) => {
    const repository = planned.find((candidate) => candidate.repoId === repoId);
    const shas = repository?.windows.map((window) => window.afterSha.toLowerCase()) ?? [];
    const ours = windowSteps.filter((step) => shas.includes(step.sha));
    const done = shas.filter((sha) => ours.some((step) => step.sha === sha && step.leaf === WINDOW_DONE_STEP_ID && step.status === 'COMPLETED'));
    const documentedSha = done.at(-1) ?? lastDocumented(repoId) ?? repository?.fromSha ?? null;
    const headSha = repository?.headSha ?? pastRepositories(repoId).at(-1)?.headSha ?? null;
    const failed = ours.find((step) => step.status === 'FAILED');
    const status = (phase: RepositoryWikiPhase, error: string | null = null): RepositoryWikiStatus => ({
      repoId,
      phase,
      windowsDone: done.length,
      windowsPlanned: shas.length,
      documentedSha,
      headSha,
      error,
    });
    if (repository?.error) return status('failed', repository.error);
    if (failed && !active) {
      return status('failed', String(stepData(failed).error ?? 'Step failed'));
    }
    if (active && done.length < shas.length) {
      return status(ours.some((step) => step.status !== 'COMPLETED' && step.status !== 'FAILED') ? 'running' : 'queued');
    }
    return status(documentedSha !== null && documentedSha === headSha?.toLowerCase() ? 'up to date' : 'behind');
  });
}
