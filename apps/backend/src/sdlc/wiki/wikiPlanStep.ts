import { z } from 'zod';
import { BaseActionStep, leafStepId, variableRef, type StepExecutionContext } from '@xyne/workflow-sdk';
import { db } from '@/database/client';
import { TERMINAL_EXECUTION_STATUSES } from '@/workflowsV2/constants';
import { SDLC_AGENT_STEP_TYPE } from '@/workflowsV2/agents/sdlc-agent-provider';
import type { XyneResourceAttrs } from '@/workflowsV2/types';
import { repoIdsForChannel } from '../sdlcChannelMembership';
import { sdlcVcs } from '../vcs';
import { commitWindows } from './wikiWindows';

export const SDLC_WIKI_PLAN_STEP_TYPE = 'SDLC_WIKI_PLAN';
export const HUB_CORRECTOR_STEP_ID = 'hub_correct';

// A LOOP stops at maxIterations (default 1000) without failing, so a run never plans past it.
const MAX_WINDOWS_PER_REPOSITORY = 1000;

const PlanConfigSchema = z.object({
  channelId: z.string().min(1).describe('SDLC hub whose repositories this plans'),
  commitsPerRun: z.number().int().min(1).max(100).default(10)
    .describe('Commits one Generator run covers'),
  // Wiki workflows seeded before the text form send a repository@commit array.
  overrides: variableRef(
    z.union([z.string(), z.array(z.string())])
      .describe('One per line: repository id, commit. An override wins over where the repository last ended.')
  ).default(''),
});

type PlanConfig = z.infer<typeof PlanConfigSchema>;

const CommitWindowSchema = z.object({
  repoId: z.string(),
  repository: z.string(),
  beforeSha: z.string().nullable(),
  afterSha: z.string(),
  commitCount: z.number(),
});

const RepositoryPlanSchema = z.object({
  repoId: z.string(),
  name: z.string(),
  startedFrom: z.enum(['override', 'last-run', 'first-commit']),
  fromSha: z.string().nullable(),
  headSha: z.string(),
  windows: z.array(CommitWindowSchema),
  remainingWindows: z.number(),
});

const PlanOutputSchema = z.object({
  skipped: z.boolean(),
  reason: z.string().nullable(),
  hasChanges: z.boolean(),
  repositories: z.array(RepositoryPlanSchema),
  // One line per repository the Hub Wiki hasn't caught up with.
  changes: z.array(
    z.object({
      repoId: z.string(),
      repository: z.string(),
      fromSha: z.string().nullable(),
      toSha: z.string(),
      commits: z.number(),
    })
  ),
});

type RepositoryPlan = z.infer<typeof RepositoryPlanSchema>;
type PlanOutput = z.infer<typeof PlanOutputSchema>;

interface WrittenCommit {
  sha: string;
  at: Date;
}

async function wikiHistory(
  workflowId: string
): Promise<{ written: Map<string, WrittenCommit[]>; hubSeenAt: Date | null }> {
  // Execution ids, not the workflowExecution relation filter: that let Postgres scan every workflow's steps.
  const executions = await db.workflowExecution.findMany({ where: { workflowId }, select: { id: true } });
  const rows = await db.workflowStep.findMany({
    where: {
      workflowExecutionId: { in: executions.map((execution) => execution.id) },
      status: 'COMPLETED',
      data: { contains: SDLC_AGENT_STEP_TYPE },
    },
    orderBy: { updatedAt: 'asc' },
    select: { data: true, stepName: true, updatedAt: true },
  });
  const written = new Map<string, WrittenCommit[]>();
  let hubSeenAt: Date | null = null;
  for (const row of rows) {
    if (row.stepName && leafStepId(row.stepName) === HUB_CORRECTOR_STEP_ID) {
      hubSeenAt = row.updatedAt;
      continue;
    }
    let data: { type?: unknown; input?: { repoId?: unknown; generationCommit?: unknown } };
    try {
      data = JSON.parse(row.data ?? '{}');
    } catch {
      continue;
    }
    const repoId = data.input?.repoId;
    const commit = data.input?.generationCommit;
    if (data.type !== SDLC_AGENT_STEP_TYPE || typeof repoId !== 'string' || typeof commit !== 'string') {
      continue;
    }
    const commits = written.get(repoId) ?? [];
    commits.push({ sha: commit.toLowerCase(), at: row.updatedAt });
    written.set(repoId, commits);
  }
  return { written, hubSeenAt };
}

function parseOverride(value: string): { repository: string; commit: string } {
  const match = /^(.+?)[\s,@]+([0-9a-f]{7,40})$/i.exec(value);
  if (!match) throw new Error(`Start commit "${value}" must look like: repository id, commit`);
  return { repository: match[1]!.trim(), commit: match[2]!.toLowerCase() };
}

export class SdlcWikiPlanStep extends BaseActionStep<typeof PlanConfigSchema, PlanOutput> {
  readonly type = SDLC_WIKI_PLAN_STEP_TYPE;
  readonly name = 'Plan wiki commit windows';
  readonly description = "Lists the hub's repositories and splits each one's new commits into Generator windows";
  readonly category = 'data';
  readonly configSchema = PlanConfigSchema;
  readonly outputSchema = PlanOutputSchema;

  async execute(config: PlanConfig, ctx: StepExecutionContext): Promise<PlanOutput> {
    const { workspaceId } = ctx.runtime.attributes as XyneResourceAttrs;
    const hub = await db.channel.findFirst({
      where: { id: config.channelId, workspaceId, type: 'SDLC' },
      select: { id: true },
    });
    if (!hub) throw new Error(`SDLC hub ${config.channelId} is not in this workspace`);

    const execution = await db.workflowExecution.findUnique({
      where: { id: ctx.runtime.executionId },
      select: { workflowId: true, createdAt: true },
    });
    if (!execution) throw new Error('Workflow execution not found');

    // Older runs only, or two runs started together would both skip.
    const active = await db.workflowExecution.findFirst({
      where: {
        workflowId: execution.workflowId,
        status: { notIn: [...TERMINAL_EXECUTION_STATUSES] },
        OR: [
          { createdAt: { lt: execution.createdAt } },
          { createdAt: execution.createdAt, id: { lt: ctx.runtime.executionId } },
        ],
      },
      select: { id: true },
    });
    if (active) {
      return {
        skipped: true,
        reason: `Run ${active.id} is still active`,
        hasChanges: false,
        repositories: [],
        changes: [],
      };
    }

    const repoIds = await repoIdsForChannel(db, config.channelId);
    const repositories = await db.repo.findMany({
      where: { id: { in: repoIds } },
      select: { id: true, name: true },
    });
    const byId = new Map(repositories.map((repository) => [repository.id, repository]));
    const overrides = (Array.isArray(config.overrides) ? config.overrides : (config.overrides ?? '').split('\n'))
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseOverride);
    for (const override of overrides) {
      const matches = repositories.filter(
        (repository) => repository.id === override.repository || repository.name === override.repository
      );
      if (matches.length === 0) {
        throw new Error(`Start commit repository "${override.repository}" is not in this hub`);
      }
      if (matches.length > 1) {
        throw new Error(`Start commit repository "${override.repository}" matches ${matches.length} repositories, use its id`);
      }
    }
    const { written, hubSeenAt } = await wikiHistory(execution.workflowId);

    const plans: RepositoryPlan[] = [];
    const changes: PlanOutput['changes'] = [];
    for (const repoId of repoIds) {
      const repository = byId.get(repoId);
      if (!repository) continue;
      const history = await sdlcVcs.listBaseBranchFirstParentHistory(repository.id);
      const shas = history.commits.map((commit) => commit.sha);
      const override = overrides.find(
        (candidate) => candidate.repository === repository.id || candidate.repository === repository.name
      );
      const commits = written.get(repository.id) ?? [];
      const { startedFrom, fromSha, windows } = commitWindows({
        repoId: repository.id,
        repository: repository.name,
        shas,
        commitsPerRun: config.commitsPerRun,
        written: commits.map((commit) => commit.sha),
        ...(override ? { overrideCommit: override.commit } : {}),
      });
      const planned = windows.slice(0, MAX_WINDOWS_PER_REPOSITORY);

      plans.push({
        repoId: repository.id,
        name: repository.name,
        startedFrom,
        fromSha,
        headSha: history.targetHeadSha,
        windows: planned,
        remainingWindows: Math.max(0, windows.length - MAX_WINDOWS_PER_REPOSITORY),
      });

      // From the Hub Wiki's last pass, so work from a failed run still reaches it.
      const seen = hubSeenAt ? (commits.filter((commit) => commit.at <= hubSeenAt).at(-1)?.sha ?? null) : null;
      const latest = commits.at(-1);
      const unseen = latest && (!hubSeenAt || latest.at > hubSeenAt) ? latest.sha : null;
      const toSha = planned.at(-1)?.afterSha ?? unseen;
      if (!toSha) continue;
      changes.push({
        repoId: repository.id,
        repository: repository.name,
        fromSha: seen,
        toSha,
        commits: Math.max(0, shas.indexOf(toSha) - (seen ? shas.indexOf(seen) : -1)),
      });
    }

    return {
      skipped: false,
      reason: null,
      // Relationships only show once the hub has two repositories.
      hasChanges: repoIds.length > 1 && changes.length > 0,
      repositories: plans,
      changes,
    };
  }
}
