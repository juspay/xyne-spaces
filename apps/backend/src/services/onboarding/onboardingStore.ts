import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

/**
 * Desk onboarding exams live in two JSON columns on the desk's `email_channel_preferences` row:
 * `onboardingConfig` (papers, written by admins) and `onboardingAttempts` (attempts, replies and
 * grades). Neither column is in the Zero schema — everything is read and written here, over REST.
 */

export const ONBOARDING_MAX_TICKETS_PER_TOPIC = 20;
export const ONBOARDING_MAX_SCORE_PER_ANSWER = 10;
/** One reply's limit, shared by the request body, the UI and the grading prompt. */
export const ONBOARDING_MAX_REPLY_CHARS = 20000;
/** The columns that must never leave this module's own endpoints (see getDeskConfig). */
export const ONBOARDING_COLUMNS = ['onboardingConfig', 'onboardingAttempts'] as const;

export const nowIso = (): string => new Date().toISOString();

// Stored as ISO strings by every writer here; not validated, so old rows can't be rejected.
const dateString = z.string();

/**
 * Every stored object passes unknown keys through: a write is a read-modify-write of the whole
 * column, so dropping them would let an older pod erase fields a newer shape added.
 */
const stored = <T extends z.ZodRawShape>(shape: T) => z.object(shape).passthrough();
const nullableDate = dateString.nullable();

const topicTicketSchema = stored({
  id: z.string(),
  ticketId: z.string(),
  addedBy: z.string(),
  addedAt: dateString,
});

const topicSchema = stored({
  id: z.string(),
  name: z.string(),
  graderAgentSlug: z.string().nullable(),
  createdBy: z.string(),
  createdAt: dateString,
  updatedAt: dateString,
  deletedAt: nullableDate,
  tickets: z.array(topicTicketSchema),
});

const configSchema = stored({ version: z.literal(1), topics: z.array(topicSchema) });

const reviewSchema = stored({
  status: z.enum(['PENDING', 'GRADED', 'FAILED', 'SKIPPED']),
  reasoning: z.string().nullable(),
  missedPoints: z.array(z.string()),
  agentSlug: z.string(),
  sessionId: z.string().nullable(),
  dispatchedAt: nullableDate,
  retryCount: z.number(),
  gradedAt: nullableDate,
  error: z.string().nullable(),
});

const answerSchema = stored({
  paperTicketId: z.string(),
  ticketId: z.string(),
  replyText: z.string(),
  score: z.number().nullable(),
  review: reviewSchema.nullable(),
});

const attemptSchema = stored({
  id: z.string(),
  topicId: z.string(),
  userId: z.string(),
  status: z.enum(['IN_PROGRESS', 'GRADING', 'GRADED', 'FAILED']),
  startedAt: dateString,
  draftSavedAt: nullableDate,
  submittedAt: nullableDate,
  durationSeconds: z.number().nullable(),
  gradedAt: nullableDate,
  totalScore: z.number().nullable(),
  maxScore: z.number().nullable(),
  answers: z.array(answerSchema),
});

const attemptsSchema = stored({
  version: z.literal(1),
  attempts: z.array(attemptSchema),
  /** "topicId:userId" → attempts ever submitted (kept after old attempts are pruned). */
  counts: z.record(z.number()).default({}),
});

export type OnboardingTopic = z.infer<typeof topicSchema>;
export type OnboardingConfig = z.infer<typeof configSchema>;
export type OnboardingAttempt = z.infer<typeof attemptSchema>;
export type OnboardingAttempts = z.infer<typeof attemptsSchema>;

export class OnboardingDataError extends Error {
  constructor(column: string) {
    super(`Onboarding data in ${column} is unreadable`);
    this.name = 'OnboardingDataError';
  }
}

/** Thrown for a request the caller can fix (bad input, wrong state); mapped to a 4xx. */
export class OnboardingRequestError extends Error {
  constructor(
    message: string,
    readonly status: number = 400
  ) {
    super(message);
    this.name = 'OnboardingRequestError';
  }
}

/**
 * Parse a stored value. Missing means empty. Malformed throws: writing an "empty" value back
 * over data we failed to read would silently erase every paper or attempt on the desk.
 */
function parseColumn<T>(
  column: OnboardingColumn,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  raw: unknown,
  empty: T
): T {
  if (raw === null || raw === undefined) return empty;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    logger.error(`[Onboarding] ${column} failed to parse`, { issues: parsed.error.issues });
    throw new OnboardingDataError(column);
  }
  return parsed.data;
}

export const parseOnboardingConfig = (raw: unknown): OnboardingConfig =>
  parseColumn('onboardingConfig', configSchema, raw, { version: 1, topics: [] });

export const parseOnboardingAttempts = (raw: unknown): OnboardingAttempts =>
  parseColumn('onboardingAttempts', attemptsSchema, raw, {
    version: 1,
    attempts: [],
    counts: {},
  });

export const attemptCountKey = (topicId: string, userId: string): string => `${topicId}:${userId}`;

/** The desk's onboarding columns, or null when the desk has no preference row yet. */
export async function loadPreferenceRow(channelId: string) {
  return db.emailChannelPreference.findUnique({
    where: { channelId },
    select: { ownerUserId: true, onboardingConfig: true, onboardingAttempts: true },
  });
}

/** Just the desk owner — every request resolves admin access, so this must stay cheap. */
export async function loadDeskOwnerUserId(channelId: string): Promise<string | null> {
  const row = await db.emailChannelPreference.findUnique({
    where: { channelId },
    select: { ownerUserId: true },
  });
  return row?.ownerUserId ?? null;
}

type OnboardingColumn = 'onboardingConfig' | 'onboardingAttempts';

interface LockedRow {
  onboardingConfig: unknown;
  onboardingAttempts: unknown;
}

/** Return null to do nothing, or `{ next: null, result }` to answer without writing. */
type Change<TValue, TResult> = (
  value: TValue,
  row: LockedRow
) => { next: TValue | null; result: TResult } | null;

/**
 * Read-modify-write one onboarding column under a row lock, so concurrent draft saves, grade
 * callbacks and sweeper claims never overwrite each other. `change` must not do network I/O —
 * the lock is held while it runs. Return `null` to do nothing at all, or `{ next: null, result }`
 * to return a value without writing.
 */
async function withLockedColumn<TValue, TResult>(
  channelId: string,
  workspaceId: string,
  column: OnboardingColumn,
  parse: (raw: unknown) => TValue,
  change: Change<TValue, TResult>
): Promise<TResult | null> {
  return db.$transaction(
    async (tx) => {
      const [row] = await tx.$queryRaw<LockedRow[]>`
        SELECT "onboardingConfig", "onboardingAttempts"
        FROM "public"."email_channel_preferences"
        WHERE "channelId" = ${channelId} AND "workspaceId" = ${workspaceId}
        FOR UPDATE
      `;
      // Every email desk gets its preference row when it's created, and the tab only shows there.
      if (!row) throw new OnboardingRequestError('Desk settings not found for this channel', 404);

      const outcome = change(parse(row[column]), row);
      if (!outcome) return null;
      // `next: null` means "nothing changed": skip the write so the row isn't re-serialised and
      // pushed through replication for a read.
      if (outcome.next === null) return outcome.result;

      const json = JSON.stringify(outcome.next);
      await tx.$executeRaw`
        UPDATE "public"."email_channel_preferences"
        SET ${Prisma.raw(`"${column}"`)} = ${json}::jsonb
        WHERE "channelId" = ${channelId} AND "workspaceId" = ${workspaceId}
      `;
      return outcome.result;
    },
    // Zero's writes to other columns of this row hold the same row lock, so allow a longer wait
    // than Prisma's 5s default before giving up.
    { maxWait: 10_000, timeout: 20_000 }
  );
}

export function updateOnboardingConfig<TResult>(
  channelId: string,
  workspaceId: string,
  change: Change<OnboardingConfig, TResult>
): Promise<TResult | null> {
  return withLockedColumn(
    channelId,
    workspaceId,
    'onboardingConfig',
    parseOnboardingConfig,
    change
  );
}

export function updateOnboardingAttempts<TResult>(
  channelId: string,
  workspaceId: string,
  change: Change<OnboardingAttempts, TResult>
): Promise<TResult | null> {
  return withLockedColumn(
    channelId,
    workspaceId,
    'onboardingAttempts',
    parseOnboardingAttempts,
    change
  );
}

/**
 * Drop soft-deleted topics that no stored attempt still references. Runs after an attempt
 * finishes (retention), on the config column's own lock.
 */
export async function pruneOnboardingConfig(channelId: string, workspaceId: string): Promise<void> {
  await updateOnboardingConfig(channelId, workspaceId, (config, row) => {
    const attempts = parseOnboardingAttempts(row.onboardingAttempts).attempts;
    const liveTopicIds = new Set(attempts.map((a) => a.topicId));
    const topics = config.topics.filter((t) => t.deletedAt === null || liveTopicIds.has(t.id));
    if (topics.length === config.topics.length) return { next: null, result: false };
    return { next: { ...config, topics }, result: true };
  });
}

/** Desks with at least one attempt being graded — the sweeper's work list. */
export async function findChannelsWithGradingAttempts() {
  return db.emailChannelPreference.findMany({
    where: {
      onboardingAttempts: {
        path: ['attempts'],
        array_contains: [{ status: 'GRADING' }],
      },
    },
    select: { channelId: true, workspaceId: true },
  });
}

/**
 * Keep, per person per paper: any open or grading attempt, the latest finished attempt, and the
 * best graded attempt. Everything else is dropped; `counts` still remembers how many there were.
 */
export function pruneAttempts(
  attempts: OnboardingAttempt[],
  topicId: string,
  userId: string
): OnboardingAttempt[] {
  const mine = attempts.filter((a) => a.topicId === topicId && a.userId === userId);
  const finished = mine
    .filter((a) => a.status === 'GRADED' || a.status === 'FAILED')
    .sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));
  const latest = finished[0];
  const best = finished
    .filter((a) => a.status === 'GRADED' && a.maxScore)
    .sort(
      (a, b) => (b.totalScore ?? 0) / (b.maxScore ?? 1) - (a.totalScore ?? 0) / (a.maxScore ?? 1)
    )[0];

  const keep = new Set<string>(
    mine.filter((a) => a.status === 'IN_PROGRESS' || a.status === 'GRADING').map((a) => a.id)
  );
  if (latest) keep.add(latest.id);
  if (best) keep.add(best.id);

  return attempts.filter((a) => !(a.topicId === topicId && a.userId === userId) || keep.has(a.id));
}
