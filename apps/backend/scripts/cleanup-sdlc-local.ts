import Bull from 'bull';
import Redis from 'ioredis';
import { writeFile } from 'node:fs/promises';
import { Prisma, PrismaClient } from '@prisma/client';
import { getBaseRedisOptions } from '../src/services/redisFactory';

const prisma = new PrismaClient();
const SDLC_WORKFLOW_TYPES = ['SDLC_SETUP', 'SDLC_ARTIFACT', 'SDLC_WORK', 'SDLC_WIKI'];
const PROTECTED_TABLES = new Set([
  'users',
  'workspaces',
  'projects',
  'external_sources',
  'organizations',
]);

type DbColumn = { table_schema: string; table_name: string; column_name: string };
type IdSet = { label: string; columns: string[]; ids: string[] };

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function requireLocalDatabase(rawUrl: string | undefined): void {
  if (!rawUrl) throw new Error('DATABASE_URL is missing');
  const url = new URL(rawUrl);
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (!localHosts.has(url.hostname)) {
    throw new Error(`Refusing cleanup: DATABASE_URL host ${url.hostname} is not local`);
  }
  if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
    throw new Error(`Refusing cleanup: NODE_ENV must be development or test`);
  }
}

function parseArgs(): { confirmed: boolean; repoSelector?: string; clawScopeFile?: string } {
  const args = process.argv.slice(2);
  let confirmed = false;
  let repoSelector: string | undefined;
  let clawScopeFile: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--yes') {
      confirmed = true;
    } else if (arg === '--repo' || arg.startsWith('--repo=')) {
      if (repoSelector) throw new Error('--repo may only be supplied once');
      repoSelector = arg === '--repo' ? args[++index] : arg.slice('--repo='.length);
      if (!repoSelector) throw new Error('--repo requires a repository ID, name, or URL');
    } else if (arg === '--claw-scope-file') {
      clawScopeFile = args[++index];
      if (!clawScopeFile) throw new Error('--claw-scope-file requires a path');
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return { confirmed, repoSelector, clawScopeFile };
}

type RepoRow = {
  id: string;
  name: string;
  url: string;
  canonicalUrl: string | null;
  channelId: string;
  projectId: string | null;
};

async function resolveRepos(repoSelector?: string): Promise<RepoRow[]> {
  const rows = await prisma.$queryRawUnsafe<RepoRow[]>(
    `SELECT r.id, r.name, r.url, r."canonicalUrl", r."channelId", r."projectId"
       FROM public.repos r
       JOIN public.channels c ON c.id = r."channelId"
      WHERE c.metadata->>'surface' = 'SDLC'
        AND ($1::text IS NULL OR $1 IN (r.id, r.name, r.url, r."canonicalUrl"))`,
    repoSelector ?? null
  );
  if (repoSelector && rows.length === 0) {
    throw new Error(`SDLC repository not found: ${repoSelector}`);
  }
  if (repoSelector && rows.length > 1) {
    throw new Error(`Repository selector is ambiguous; use repo ID: ${repoSelector}`);
  }
  return rows;
}

async function textIds(query: string, params: unknown[] = []): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(query, ...params);
  return rows.map((row) => row.id);
}

async function deleteByKnownColumns(tx: Prisma.TransactionClient, sets: IdSet[]): Promise<number> {
  const wantedColumns = [...new Set(sets.flatMap((set) => set.columns))];
  const columns = await tx.$queryRawUnsafe<DbColumn[]>(
    `SELECT table_schema, table_name, column_name
       FROM information_schema.columns
      WHERE table_schema IN ('public', 'workflow', 'non_zero')
        AND column_name = ANY($1::text[])`,
    wantedColumns
  );

  let deleted = 0;
  for (const set of sets) {
    if (set.ids.length === 0) continue;
    for (const column of columns.filter((item) => set.columns.includes(item.column_name))) {
      if (PROTECTED_TABLES.has(column.table_name)) continue;
      const table = `${quoteIdentifier(column.table_schema)}.${quoteIdentifier(column.table_name)}`;
      const field = quoteIdentifier(column.column_name);
      deleted += await tx.$executeRawUnsafe(
        `DELETE FROM ${table} WHERE ${field} = ANY($1::text[])`,
        set.ids
      );
    }
  }
  return deleted;
}

async function repoAdmissionPermitKeys(redis: Redis, repoId: string): Promise<string[]> {
  const keys = await redis.keys('sdlc:admission:permit:*');
  if (keys.length === 0) return [];
  const values = await redis.pipeline(keys.map((key) => ['hget', key, 'repoId'])).exec();
  return keys.filter((_, index) => values?.[index]?.[1] === repoId);
}

async function inspectQueue(repoId?: string): Promise<{
  queueJobs: number;
  activeJobs: number;
  admissionKeys: number;
}> {
  const redisOptions = getBaseRedisOptions();
  const queue = new Bull('sdlc', { redis: { ...redisOptions, lazyConnect: false } });
  const redis = new Redis(redisOptions);
  try {
    if (repoId) {
      const jobs = await queue.getJobs(
        ['waiting', 'active', 'delayed', 'failed', 'completed', 'paused'],
        0,
        -1
      );
      const selected = jobs.filter((job) => job.data.repoId === repoId);
      const states = await Promise.all(selected.map((job) => job.getState()));
      const permitKeys = await repoAdmissionPermitKeys(redis, repoId);
      const repoKeys = await redis.keys(`sdlc:admission:repo:${repoId}:*`);
      return {
        queueJobs: selected.length,
        activeJobs: states.filter((state) => state === 'active').length,
        admissionKeys: permitKeys.length + repoKeys.length,
      };
    }
    const counts = await queue.getJobCounts(
      'wait',
      'active',
      'delayed',
      'failed',
      'completed',
      'paused'
    );
    const keys = await redis.keys('sdlc:admission:*');
    return {
      queueJobs: Object.values(counts).reduce((sum, count) => sum + count, 0),
      activeJobs: counts.active ?? 0,
      admissionKeys: keys.length,
    };
  } finally {
    await queue.close();
    redis.disconnect();
  }
}

async function clearQueue(repoId?: string): Promise<void> {
  const redisOptions = getBaseRedisOptions();
  const queue = new Bull('sdlc', { redis: { ...redisOptions, lazyConnect: false } });
  const redis = new Redis(redisOptions);
  try {
    if (!repoId) {
      await queue.pause(false, true);
      await queue.obliterate({ force: true });
      const keys = await redis.keys('sdlc:admission:*');
      if (keys.length > 0) await redis.del(...keys);
      return;
    }

    const jobs = await queue.getJobs(
      ['waiting', 'delayed', 'failed', 'completed', 'paused'],
      0,
      -1
    );
    await Promise.all(jobs.filter((job) => job.data.repoId === repoId).map((job) => job.remove()));

    const permitKeys = await repoAdmissionPermitKeys(redis, repoId);
    const permitIds = permitKeys.map((key) => key.slice('sdlc:admission:permit:'.length));
    const pipeline = redis.pipeline();
    pipeline.del(`sdlc:admission:repo:${repoId}:active`);
    pipeline.del(`sdlc:admission:repo:${repoId}:pending`);
    pipeline.zrem('sdlc:admission:pending:repos', repoId);
    if (permitIds.length > 0) pipeline.zrem('sdlc:admission:global:active', ...permitIds);
    if (permitKeys.length > 0) pipeline.del(...permitKeys);
    await pipeline.exec();
  } finally {
    await queue.close();
    redis.disconnect();
  }
}

async function main(): Promise<void> {
  requireLocalDatabase(process.env.DATABASE_URL);
  const { confirmed, repoSelector, clawScopeFile } = parseArgs();

  const repos = await resolveRepos(repoSelector);
  const repoIds = repos.map((repo) => repo.id);
  const channelIds = repos.map((repo) => repo.channelId);
  const projectIds = repos.flatMap((repo) => (repo.projectId ? [repo.projectId] : []));
  const boardIds = repoSelector
    ? projectIds.length === 0
      ? []
      : await textIds(
          `SELECT DISTINCT p."sdlcBoardId" AS id
             FROM public.projects p
            WHERE p.id = ANY($1::text[])
              AND p."sdlcBoardId" IS NOT NULL
              AND NOT EXISTS (
                SELECT 1
                  FROM public.repos other
                  JOIN public.channels c ON c.id = other."channelId"
                 WHERE other."projectId" = p.id
                   AND other.id <> ALL($2::text[])
                   AND c.metadata->>'surface' = 'SDLC'
              )`,
          [projectIds, repoIds]
        )
    : await textIds(
        `SELECT DISTINCT p."sdlcBoardId" AS id
           FROM public.projects p
          WHERE p."sdlcBoardId" IS NOT NULL`
      );
  const workflowIds = await textIds(
    `SELECT id FROM public.workflows
      WHERE "workflowType" = ANY($1::text[])
        AND ($2::text IS NULL OR metadata::jsonb->>'repoId' = $2)`,
    [SDLC_WORKFLOW_TYPES, repoSelector ? repoIds[0] : null]
  );
  const executionIds = await textIds(
    `SELECT id FROM public.workflow_executions
      WHERE "workflowType" = ANY($1::text[])
        AND ($2::text IS NULL OR "workflowId" = ANY($3::text[])
          OR context::jsonb->>'repoId' = $2)`,
    [SDLC_WORKFLOW_TYPES, repoSelector ? repoIds[0] : null, workflowIds]
  );
  const clawConversationIds = executionIds.length
    ? await textIds(
        `SELECT DISTINCT context::jsonb->>'conversationId' AS id
           FROM public.workflow_executions
          WHERE id = ANY($1::text[])
            AND context::jsonb->>'conversationId' IS NOT NULL`,
        [executionIds]
      )
    : [];
  if (clawScopeFile) {
    await writeFile(
      clawScopeFile,
      JSON.stringify({ executionIds, conversationIds: clawConversationIds })
    );
  }
  const canvases = channelIds.length
    ? await textIds('SELECT id FROM public.canvases WHERE "channelId" = ANY($1::text[])', [
        channelIds,
      ])
    : [];
  const folders = channelIds.length
    ? await textIds('SELECT id FROM public.canvas_folders WHERE "channelId" = ANY($1::text[])', [
        channelIds,
      ])
    : [];
  const tickets =
    channelIds.length || boardIds.length
      ? await textIds(
          'SELECT id FROM public.tickets WHERE "channelId" = ANY($1::text[]) OR "boardId" = ANY($2::text[])',
          [channelIds, boardIds]
        )
      : [];
  const conversations = channelIds.length
    ? await textIds(
        'SELECT "conversationId" AS id FROM public.conversations WHERE "channelId" = ANY($1::text[])',
        [channelIds]
      )
    : [];
  const messages = conversations.length
    ? await textIds(
        'SELECT "messageId" AS id FROM public.messages WHERE "conversationId" = ANY($1::text[])',
        [conversations]
      )
    : [];
  const stages = boardIds.length
    ? await textIds('SELECT id FROM public.stages WHERE "boardId" = ANY($1::text[])', [boardIds])
    : [];
  const queue = await inspectQueue(repoSelector ? repoIds[0] : undefined);

  const summary = {
    repos: repoIds.length,
    channels: channelIds.length,
    boards: boardIds.length,
    tickets: tickets.length,
    canvases: canvases.length,
    conversations: conversations.length,
    workflows: workflowIds.length,
    executions: executionIds.length,
    ...queue,
  };
  if (repoSelector) {
    console.log(`Repository: ${repos[0].name} (${repos[0].id})`);
  }
  console.table(summary);

  if (!confirmed) {
    console.log('Preview only. Re-run with --yes to delete.');
    return;
  }

  if (queue.activeJobs > 0) {
    throw new Error(
      'Refusing cleanup while SDLC jobs are active. Stop local API/worker/Claw services, then retry.'
    );
  }

  await clearQueue(repoSelector ? repoIds[0] : undefined);
  const sets: IdSet[] = [
    { label: 'repo', columns: ['repoId'], ids: repoIds },
    { label: 'channel', columns: ['channelId'], ids: channelIds },
    { label: 'canvas', columns: ['canvasId', 'parentCanvasId'], ids: canvases },
    { label: 'folder', columns: ['folderId'], ids: folders },
    {
      label: 'ticket',
      columns: ['ticketId', 'sourceTicketId', 'targetTicketId', 'mappedTicketId', 'rootId'],
      ids: tickets,
    },
    {
      label: 'conversation',
      columns: ['conversationId', 'childConversationId', 'parentConversationId'],
      ids: conversations,
    },
    {
      label: 'message',
      columns: ['messageId', 'initialMessageId', 'parentMessageId'],
      ids: messages,
    },
    {
      label: 'workflow execution',
      columns: ['workflowExecutionId', 'parentWorkflowExecutionId'],
      ids: executionIds,
    },
    { label: 'workflow', columns: ['workflowId'], ids: workflowIds },
    { label: 'board', columns: ['boardId'], ids: boardIds },
    { label: 'stage', columns: ['stageId', 'fromStageId', 'toStageId'], ids: stages },
  ];

  const deleted = await prisma.$transaction(async (tx) => {
    if (boardIds.length > 0) {
      await tx.$executeRawUnsafe(
        'UPDATE public.projects SET "sdlcBoardId" = NULL WHERE "sdlcBoardId" = ANY($1::text[])',
        boardIds
      );
    }
    if (repoIds.length > 0) {
      await tx.$executeRawUnsafe(
        'UPDATE public.repos SET "sdlcSetupExecutionId" = NULL WHERE id = ANY($1::text[])',
        repoIds
      );
    }
    const related = await deleteByKnownColumns(tx, sets);
    const targets: Array<[string, string, string, string[]]> = [
      ['public', 'messages', 'messageId', messages],
      ['public', 'conversations', 'conversationId', conversations],
      ['public', 'tickets', 'id', tickets],
      ['public', 'canvases', 'id', canvases],
      ['public', 'canvas_folders', 'id', folders],
      ['public', 'repos', 'id', repoIds],
      ['public', 'workflow_executions', 'id', executionIds],
      ['public', 'workflows', 'id', workflowIds],
      ['public', 'stages', 'id', stages],
      ['public', 'boards', 'id', boardIds],
      ['public', 'channels', 'id', channelIds],
    ];
    let core = 0;
    for (const [schema, table, key, ids] of targets) {
      if (ids.length === 0) continue;
      core += await tx.$executeRawUnsafe(
        `DELETE FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)} WHERE ${quoteIdentifier(key)} = ANY($1::text[])`,
        ids
      );
    }
    return related + core;
  });

  console.log(`SDLC cleanup complete. Deleted ${deleted} database rows plus Redis queue state.`);
  console.log('Kept workspaces, users, projects, agents, and workspace GitHub credentials.');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
