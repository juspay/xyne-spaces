import { z } from 'zod';
import {
  BaseActionStep,
  leafStepId,
  withOptions,
  type FieldOptionsContext,
  type FieldOptionsPage,
  type StepExecutionContext,
} from '@xyne/workflow-sdk';
import { db } from '@/database/client';
import { SDLC_STARTED_BY_KEY, TERMINAL_EXECUTION_STATUSES } from '@/workflowsV2/constants';
import { sdlcStarterOf } from '@/workflowsV2/agents/sdlc-dispatch';
import { SDLC_AGENT_STEP_TYPE } from '@/workflowsV2/agents/sdlc-agent-provider';
import type { XyneCtx, XyneResourceAttrs } from '@/workflowsV2/types';
import { repoIdsForChannel } from '../sdlcChannelMembership';
import { sdlcVcs } from '../vcs';
import { hubOptions, repositoryOptions } from '../workflowOptions';
import { commitWindows } from './wikiWindows';

export const SDLC_WIKI_PLAN_STEP_TYPE = 'SDLC_WIKI_PLAN';
export const HUB_GENERATOR_STEP_ID = 'hub_generate';
export const HUB_CORRECTOR_STEP_ID = 'hub_correct';
/** The last step of a window. Only its completion marks the window written, so a run that died midway is redone. */
export const WINDOW_DONE_STEP_ID = 'correct';
export const WINDOW_GENERATE_STEP_ID = 'generate';
export const PLAN_STEP_ID = 'plan';
// Window steps are recorded as "repositories:body#<repo>/windows:body#<window>/<step>" (SDK node-path.js).
const WINDOW_LOOP_FRAME = 'windows:body#';
const WINDOW_PATH = /^repositories:body#(\d+)\/windows:body#(\d+)\//;

// A LOOP stops at maxIterations (default 1000) without failing, so a run never plans past it.
const MAX_WINDOWS_PER_REPOSITORY = 1000;
export const COMMITS_PER_WINDOW = [1, 5, 10, 20] as const;
/** Failed runs of one window, since the last manual Run, before its repository is blocked. */
const MAX_WINDOW_ATTEMPTS = 3;

const commitsPerRunSchema = z.number().int()
  .refine((value) => (COMMITS_PER_WINDOW as readonly number[]).includes(value), {
    message: `Commits per window must be one of ${COMMITS_PER_WINDOW.join(', ')}`,
  });

/** Key order is form order: the builder renders properties as they are declared. */
const PlanConfigSchema = z.object({
  channelId: withOptions(z.string().min(1)).describe('SDLC hub whose repositories this plans'),
  repoIds: withOptions(z.array(z.string().min(1))).default([])
    .describe('Repositories to cover. Leave empty for every repository in the hub.'),
  startCommits: z.array(z.string()).default([])
    .describe(
      'One per repository: "repository, commit". The next run starts that repository from this commit, once; '
      + 'set a different commit to start again. Otherwise a repository continues from where its last run ended, '
      + 'or from its first commit.'
    ),
  commitsPerRun: commitsPerRunSchema.default(10)
    .describe(`Commits one Generator run covers: ${COMMITS_PER_WINDOW.join(', ')}`),
});

/** The Run dialog's input. It overrides the step config; `automatic` marks a restart by the sweeper. */
const RunInputSchema = z.object({
  repoIds: z.array(z.string().min(1)).optional(),
  commitsPerRun: commitsPerRunSchema.optional(),
  automatic: z.boolean().optional(),
});

type PlanConfig = z.infer<typeof PlanConfigSchema>;

const CommitWindowSchema = z.object({
  repoId: z.string(),
  repository: z.string(),
  repoUrl: z.string(),
  beforeSha: z.string().nullable(),
  afterSha: z.string(),
  commitCount: z.number(),
  /** Earlier failed runs of this window; its saved pages are kept. */
  attempt: z.number(),
});

const RepositoryPlanSchema = z.object({
  repoId: z.string(),
  name: z.string(),
  startedFrom: z.enum(['override', 'last-run', 'first-commit']),
  fromSha: z.string().nullable(),
  /** The start commit this run applied, so later runs apply it only once. */
  startCommit: z.string().nullable(),
  headSha: z.string(),
  windows: z.array(CommitWindowSchema),
  remainingWindows: z.number(),
  /** Set when a window failed MAX_WINDOW_ATTEMPTS times: nothing is planned until a manual Run. */
  error: z.string().nullable(),
});

const PlanOutputSchema = z.object({
  channelId: z.string(),
  /** What a restart of this run passes back in. */
  input: z.object({ repoIds: z.array(z.string()), commitsPerRun: z.number(), [SDLC_STARTED_BY_KEY]: z.string().optional() }),
  automatic: z.boolean(),
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

export interface WrittenCommit {
  sha: string;
  at: Date;
  executionId: string;
}

interface PastPlan {
  executionId: string;
  createdAt: Date;
  automatic: boolean;
  repositories: Array<{ repoId: string; startCommit: string | null; firstSha: string | null; windowShas: string[]; headSha: string | null }>;
}

export interface WikiHistory {
  written: WrittenCommit[];
  /** Generator or Corrector steps that failed, oldest first. */
  failed: Array<{ sha: string; executionId: string; error: string }>;
  plans: PastPlan[];
  hubSeenAt: Date | null;
  executionStarts: Map<string, Date>;
}

export async function wikiHistory(workflowId: string): Promise<WikiHistory> {
  // Execution ids, not the workflowExecution relation filter: that let Postgres scan every workflow's steps.
  const executions = await db.workflowExecution.findMany({ where: { workflowId }, select: { id: true, createdAt: true } });
  const executionStarts = new Map(executions.map((execution) => [execution.id, execution.createdAt]));
  const rows = await db.workflowStep.findMany({
    where: {
      workflowExecutionId: { in: executions.map((execution) => execution.id) },
      status: { in: ['COMPLETED', 'FAILED'] },
      // A window step that failed before its input was stored has no type in its data, only its path.
      OR: [
        { data: { contains: SDLC_AGENT_STEP_TYPE } },
        { stepName: PLAN_STEP_ID },
        { status: 'FAILED', stepName: { contains: WINDOW_LOOP_FRAME } },
      ],
    },
    orderBy: { updatedAt: 'asc' },
    select: { data: true, stepName: true, status: true, updatedAt: true, workflowExecutionId: true },
  });
  const history: WikiHistory = { written: [], failed: [], plans: [], hubSeenAt: null, executionStarts };
  const unaddressed: Array<{ executionId: string; repository: number; window: number; error: string }> = [];
  for (const row of rows) {
    if (!row.stepName) continue;
    const leaf = leafStepId(row.stepName);
    const completed = row.status === 'COMPLETED';
    if (leaf === HUB_CORRECTOR_STEP_ID) {
      if (completed) history.hubSeenAt = row.updatedAt;
      continue;
    }
    let data: { type?: unknown; input?: { generationCommit?: unknown }; output?: unknown; error?: unknown };
    try {
      data = JSON.parse(row.data ?? '{}');
    } catch {
      continue;
    }
    if (row.stepName === PLAN_STEP_ID) {
      const output = data.output as Partial<PlanOutput> | undefined;
      if (completed && output && !output.skipped) {
        history.plans.push({
          executionId: row.workflowExecutionId,
          createdAt: executionStarts.get(row.workflowExecutionId) ?? row.updatedAt,
          automatic: output.automatic === true,
          repositories: (output.repositories ?? []).map((repository) => ({
            repoId: repository.repoId,
            startCommit: repository.startCommit ?? null,
            firstSha: repository.windows[0]?.afterSha ?? null,
            windowShas: repository.windows.map((window) => window.afterSha.toLowerCase()),
            headSha: repository.headSha ?? null,
          })),
        });
      }
      continue;
    }
    // No repoId: a sha only ever matches its own repository's history.
    const commit = data.input?.generationCommit;
    const windowLeaf = leaf === WINDOW_DONE_STEP_ID || leaf === WINDOW_GENERATE_STEP_ID;
    if (!completed && windowLeaf && typeof commit !== 'string') {
      const at = WINDOW_PATH.exec(row.stepName);
      if (at) {
        unaddressed.push({
          executionId: row.workflowExecutionId,
          repository: Number(at[1]),
          window: Number(at[2]),
          error: String(data.error ?? 'unknown error'),
        });
      }
      continue;
    }
    if (data.type !== SDLC_AGENT_STEP_TYPE || typeof commit !== 'string' || !commit) continue;
    const sha = commit.toLowerCase();
    if (completed && leaf === WINDOW_DONE_STEP_ID) {
      history.written.push({ sha, at: row.updatedAt, executionId: row.workflowExecutionId });
    } else if (!completed && (leaf === WINDOW_DONE_STEP_ID || leaf === WINDOW_GENERATE_STEP_ID)) {
      history.failed.push({ sha, executionId: row.workflowExecutionId, error: String(data.error ?? 'unknown error') });
    }
  }
  for (const failure of unaddressed) {
    const plan = history.plans.find((candidate) => candidate.executionId === failure.executionId);
    const sha = plan?.repositories[failure.repository]?.windowShas[failure.window];
    if (sha) history.failed.push({ sha, executionId: failure.executionId, error: failure.error });
  }
  history.plans.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  return history;
}

function parseStartCommit(value: string): { repository: string; commit: string } {
  const match = /^(.+?)[\s,@]+([0-9a-f]{7,40})$/i.exec(value);
  if (!match) throw new Error(`Start commit "${value}" must look like: repository, commit`);
  return { repository: match[1]!.trim(), commit: match[2]!.toLowerCase() };
}

interface Repository {
  id: string;
  name: string;
  url: string;
}

/** The chosen repositories of a hub, in the given order (hub order when none), and the start commit of each that has one. */
export async function resolveSelection(
  channelId: string,
  repoIds: readonly string[],
  startCommits: readonly string[],
): Promise<{ repositories: Repository[]; starts: Map<string, string> }> {
  const hubRepoIds = await repoIdsForChannel(db, channelId);
  const missing = repoIds.filter((id) => !hubRepoIds.includes(id));
  if (missing.length > 0) throw new Error(`Repositories ${missing.join(', ')} are not in this hub`);
  // The order picked in the Run dialog is the order repositories run in.
  const chosen = repoIds.length > 0 ? [...new Set(repoIds)] : hubRepoIds;
  const found = await db.repo.findMany({ where: { id: { in: chosen } }, select: { id: true, name: true, url: true } });
  const repositories = chosen.flatMap((id) => found.filter((repository) => repository.id === id));

  const starts = new Map<string, string>();
  for (const line of startCommits.map((value) => value.trim()).filter(Boolean)) {
    const start = parseStartCommit(line);
    const matches = repositories.filter(
      (repository) => repository.id === start.repository || repository.name === start.repository
    );
    if (matches.length === 0) {
      throw new Error(`Start commit repository "${start.repository}" is not one of the chosen repositories`);
    }
    if (matches.length > 1) {
      throw new Error(`Start commit repository "${start.repository}" matches ${matches.length} repositories, use its id`);
    }
    if (starts.has(matches[0]!.id)) throw new Error(`Repository "${start.repository}" has two start commits`);
    starts.set(matches[0]!.id, start.commit);
  }
  return { repositories, starts };
}

export class SdlcWikiPlanStep extends BaseActionStep<typeof PlanConfigSchema, PlanOutput> {
  readonly type = SDLC_WIKI_PLAN_STEP_TYPE;
  readonly name = 'Plan wiki commit windows';
  readonly description = "Lists the hub's repositories and splits each one's new commits into Generator windows";
  readonly category = 'data';
  readonly configSchema = PlanConfigSchema;
  readonly outputSchema = PlanOutputSchema;

  async getOptions(ctx: FieldOptionsContext<PlanConfig>): Promise<FieldOptionsPage> {
    const caller = ctx.caller as XyneCtx;
    if (ctx.field === 'channelId') return hubOptions(caller, ctx);
    if (ctx.field === 'repoIds') return repositoryOptions(caller, ctx.literal['channelId'], ctx);
    return { items: [] };
  }

  /** Save-time check of what a run would reject: an unknown repository, or a start commit off the base branch. */
  async validateConfig(ctx: { known: Partial<PlanConfig>; caller: unknown }): Promise<{ path?: string; message: string }[]> {
    const { channelId, repoIds = [], startCommits = [] } = ctx.known;
    if (!channelId) return [];
    const caller = ctx.caller as XyneCtx;
    const hub = await hubOptions(caller, { values: [channelId] });
    if (hub.items.length === 0) return [{ path: 'channelId', message: 'This hub is not available to you' }];
    let selection: Awaited<ReturnType<typeof resolveSelection>>;
    try {
      selection = await resolveSelection(channelId, repoIds, startCommits);
    } catch (error) {
      return [{ path: repoIds.length > 0 && !startCommits.length ? 'repoIds' : 'startCommits', message: (error as Error).message }];
    }
    const issues: { path?: string; message: string }[] = [];
    for (const [repoId, commit] of selection.starts) {
      const history = await sdlcVcs.listBaseBranchFirstParentHistory(repoId);
      if (!history.commits.some((entry) => entry.sha.toLowerCase().startsWith(commit))) {
        const name = selection.repositories.find((repository) => repository.id === repoId)?.name ?? repoId;
        issues.push({ path: 'startCommits', message: `Start commit ${commit} is not on the base branch of ${name}` });
      }
    }
    return issues;
  }

  async execute(config: PlanConfig, ctx: StepExecutionContext): Promise<PlanOutput> {
    const { workspaceId } = ctx.runtime.attributes as XyneResourceAttrs;
    const hub = await db.channel.findFirst({
      where: { id: config.channelId, workspaceId, type: 'SDLC' },
      select: { id: true },
    });
    if (!hub) throw new Error(`SDLC hub ${config.channelId} is not in this workspace`);

    const runInput = RunInputSchema.safeParse(ctx.workflow.trigger ?? {});
    if (!runInput.success) {
      throw new Error(`Invalid run input: ${runInput.error.issues[0]?.message ?? 'unknown'}`);
    }
    const repoIds = runInput.data.repoIds ?? config.repoIds;
    const commitsPerRun = runInput.data.commitsPerRun ?? config.commitsPerRun;
    const automatic = runInput.data.automatic === true;
    const starter = sdlcStarterOf(ctx.workflow.trigger);
    const base = {
      channelId: config.channelId,
      input: { repoIds, commitsPerRun, ...(starter ? { [SDLC_STARTED_BY_KEY]: starter } : {}) },
      automatic,
    };

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
        ...base,
        skipped: true,
        reason: `Run ${active.id} is still active`,
        hasChanges: false,
        repositories: [],
        changes: [],
      };
    }

    const { repositories, starts } = await resolveSelection(config.channelId, repoIds, config.startCommits);
    const { written, failed, plans, hubSeenAt, executionStarts } = await wikiHistory(execution.workflowId);

    // A manual Run starts a fresh count of failed attempts; the sweeper's restarts continue it.
    const countFrom = automatic
      ? (plans.filter((plan) => !plan.automatic).at(-1)?.createdAt ?? new Date(0))
      : execution.createdAt;
    const failures = new Map<string, { executions: Set<string>; error: string }>();
    for (const failure of failed) {
      if ((executionStarts.get(failure.executionId) ?? new Date(0)) < countFrom) continue;
      const entry = failures.get(failure.sha) ?? { executions: new Set<string>(), error: failure.error };
      entry.executions.add(failure.executionId);
      entry.error = failure.error;
      failures.set(failure.sha, entry);
    }
    const attempts = (sha: string): number => failures.get(sha)?.executions.size ?? 0;
    // The prompt's attempt counts every earlier failure: a manual Run resets the block, not the saved pages.
    const everFailed = new Set(failed.map((failure) => failure.sha));

    const repositoryPlans: RepositoryPlan[] = [];
    const changes: PlanOutput['changes'] = [];
    for (const repository of repositories) {
      const history = await sdlcVcs.listBaseBranchFirstParentHistory(repository.id);
      const shas = history.commits.map((commit) => commit.sha);
      const onBranch = new Set(shas);
      const commits = written.filter((commit) => onBranch.has(commit.sha));
      // A start commit applies once: after a run documented its first window, runs resume as usual.
      const requested = starts.get(repository.id);
      const applied = requested !== undefined && plans.some((plan) =>
        plan.repositories.some((past) =>
          past.repoId === repository.id
          && past.startCommit === requested
          && written.some((commit) => commit.executionId === plan.executionId && commit.sha === past.firstSha)
        )
      );
      const startCommit = applied ? undefined : requested;
      const { startedFrom, fromSha, windows } = commitWindows({
        repoId: repository.id,
        repository: repository.name,
        shas,
        commitsPerRun,
        written: commits.map((commit) => commit.sha),
        ...(startCommit ? { overrideCommit: startCommit } : {}),
      });
      const next = windows[0];
      const blocked = next !== undefined && attempts(next.afterSha) >= MAX_WINDOW_ATTEMPTS;
      const planned = blocked
        ? []
        : windows.slice(0, MAX_WINDOWS_PER_REPOSITORY).map((window) => ({
            ...window,
            repoUrl: repository.url,
            attempt: Math.max(attempts(window.afterSha), everFailed.has(window.afterSha) ? 1 : 0),
          }));

      repositoryPlans.push({
        repoId: repository.id,
        name: repository.name,
        startedFrom,
        fromSha,
        startCommit: startCommit ?? null,
        headSha: history.targetHeadSha,
        windows: planned,
        remainingWindows: blocked ? 0 : Math.max(0, windows.length - MAX_WINDOWS_PER_REPOSITORY),
        error: blocked
          ? `Commits ${next.beforeSha?.slice(0, 9) ?? 'start'}..${next.afterSha.slice(0, 9)} failed `
            + `${attempts(next.afterSha)} times, last: ${failures.get(next.afterSha)!.error}. Run again to retry.`
          : null,
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
      ...base,
      skipped: false,
      reason: null,
      // Relationships only show once the hub has two repositories.
      hasChanges: repositories.length > 1 && changes.length > 0,
      repositories: repositoryPlans,
      changes,
    };
  }
}
