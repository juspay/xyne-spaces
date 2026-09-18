import { z } from 'zod';
import { compile } from 'html-to-text';
import { Prisma } from '@prisma/client';
import { EmailType } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

/**
 * Desk onboarding exams live in two JSON columns on the desk's `email_channel_preferences` row:
 * `onboardingConfig` (papers, written by admins) and `onboardingAttempts` (attempts, replies and
 * grades). Neither column is in the Zero schema — everything is read and written here, over REST.
 */

export const MAX_TICKETS_PER_TOPIC = 20;
export const MAX_SCORE_PER_ANSWER = 10;
export const MAX_REPLY_CHARS = 20000;

export const nowIso = (): string => new Date().toISOString();

/** Unknown keys pass through: a write rewrites the whole column, so dropping them loses data. */
const stored = <T extends z.ZodRawShape>(shape: T) => z.object(shape).passthrough();
const str = z.string();
// Everything a row can legitimately be missing gets a default, so a topic or attempt written by
// an older shape still reads instead of 500ing the whole desk. Identity fields stay required.
const nstr = str.nullable().default(null);
const nnum = z.number().nullable().default(null);
const version = z.number().default(1);

const topicSchema = stored({
  id: str,
  name: str,
  graderAgentSlug: nstr,
  ticketIds: z.array(str).default([]),
});

const attemptSchema = stored({
  id: str,
  topicId: str,
  userId: str,
  status: z.enum(['IN_PROGRESS', 'GRADING', 'GRADED', 'FAILED']),
  startedAt: str,
  submittedAt: nstr,
  durationSeconds: nnum,
  totalScore: nnum,
  maxScore: nnum,
  answers: z
    .array(stored({ ticketId: str, replyText: str, score: nnum, reasoning: nstr, error: nstr }))
    .default([]),
});

const configSchema = stored({ version, topics: z.array(topicSchema).default([]) });
const attemptsSchema = stored({ version, attempts: z.array(attemptSchema).default([]) });

export type OnboardingConfig = z.infer<typeof configSchema>;
export type OnboardingAttempt = z.infer<typeof attemptSchema>;
export type OnboardingAttempts = z.infer<typeof attemptsSchema>;

/** Thrown for a request the caller can fix (bad input, wrong state); mapped to a 4xx. */
export class OnboardingRequestError extends Error {
  constructor(
    message: string,
    readonly status: number = 400
  ) {
    super(message);
  }
}

/** Missing means empty. Malformed throws: writing "empty" back would erase the desk's papers. */
function parse<T>(
  col: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  raw: unknown,
  empty: T
): T {
  if (raw === null || raw === undefined) return empty;
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  logger.error(`[Onboarding] ${col} failed to parse`, { issues: parsed.error.issues });
  throw new OnboardingRequestError('This desk’s onboarding data couldn’t be read', 500);
}

export const parseConfig = (raw: unknown): OnboardingConfig =>
  parse('onboardingConfig', configSchema, raw, { version: 1, topics: [] });

export const parseAttempts = (raw: unknown): OnboardingAttempts =>
  parse('onboardingAttempts', attemptsSchema, raw, { version: 1, attempts: [] });

/** The desk's onboarding columns plus its owner, or null when the desk has no preference row. */
export const loadPreferenceRow = (channelId: string) =>
  db.emailChannelPreference.findUnique({
    where: { channelId },
    select: { ownerUserId: true, onboardingConfig: true, onboardingAttempts: true },
  });

interface LockedRow {
  onboardingConfig: unknown;
  onboardingAttempts: unknown;
}

type Change<V, R> = (value: V, row: LockedRow) => { next: V | null; result: R } | null;

/**
 * Read-modify-write one column under a row lock, so a submit, a grade callback and an admin edit
 * never overwrite each other. `change` must not do I/O — the lock is held while it runs; it
 * returns null to skip the write, or `next: null` to answer without writing.
 */
function locked<V, R>(
  channelId: string,
  workspaceId: string,
  column: 'onboardingConfig' | 'onboardingAttempts',
  parseValue: (raw: unknown) => V,
  change: Change<V, R>
): Promise<R | null> {
  const where = Prisma.sql`WHERE "channelId" = ${channelId} AND "workspaceId" = ${workspaceId}`;
  return db.$transaction(
    async (tx) => {
      const [row] = await tx.$queryRaw<LockedRow[]>`
        SELECT "onboardingConfig", "onboardingAttempts"
        FROM "public"."email_channel_preferences" ${where} FOR UPDATE`;
      if (!row) throw new OnboardingRequestError('Desk settings not found for this channel', 404);
      const outcome = change(parseValue(row[column]), row);
      if (!outcome) return null;
      if (outcome.next !== null) {
        await tx.$executeRaw`
          UPDATE "public"."email_channel_preferences"
          SET ${Prisma.raw(`"${column}"`)} = ${JSON.stringify(outcome.next)}::jsonb ${where}`;
      }
      return outcome.result;
    },
    // Zero's writes to other columns of this row take the same lock, so allow a longer wait.
    { maxWait: 10_000, timeout: 20_000 }
  );
}

export const updateConfig = <R>(
  channelId: string,
  workspaceId: string,
  change: Change<OnboardingConfig, R>
) => locked(channelId, workspaceId, 'onboardingConfig', parseConfig, change);

export const updateAttempts = <R>(
  channelId: string,
  workspaceId: string,
  change: Change<OnboardingAttempts, R>
) => locked(channelId, workspaceId, 'onboardingAttempts', parseAttempts, change);

// Papers store ticket ids only: the first email (what the trainee answers) and the rest of the
// thread (what the grader compares against) are read live. Internal notes are chat, not emails.
const toText = compile({
  wordwrap: false,
  selectors: [
    { selector: 'img', format: 'skip' },
    // Keep real URLs (a payment link is often the answer); drop in-page anchors only.
    { selector: 'a', options: { noAnchorUrl: true } },
    // Quoted history from earlier messages in the thread.
    { selector: 'blockquote', format: 'skip' },
    { selector: 'div.gmail_quote', format: 'skip' },
    { selector: '#appendonsend', format: 'skip' },
  ],
});

/** `sentAt` is the provider's received time where we have it, else when the row was written. */
export interface OnboardingEmail {
  subject: string;
  from: string;
  sentAt: string;
  inbound: boolean;
  text: string;
}

/** A long merged thread would otherwise send hundreds of kilobytes to the grader per answer. */
const MAX_THREAD_EMAILS = 10;
const SELECT = { type: true, subject: true, from: true, body: true, createdAt: true } as const;

type EmailRow = { type: string; subject: string; from: string; body: string; createdAt: Date };

const toEmail = (e: EmailRow): OnboardingEmail => ({
  subject: e.subject,
  from: e.from,
  sentAt: e.createdAt.toISOString(),
  inbound: e.type === EmailType.DEFAULT,
  text: toText(e.body)
    .replace(/\n{3,}/g, '\n\n')
    .trim(),
});

/** Tickets on this desk that can go on a paper: they must exist and have at least one email. */
export async function findPaperEligibleTickets(
  channelId: string,
  ticketIds: string[]
): Promise<string[]> {
  if (ticketIds.length === 0) return [];
  const tickets = await db.ticket.findMany({
    where: { id: { in: ticketIds }, channelId, isArchived: false },
    select: { id: true, emailCount: true },
  });
  // emailCount is null until backfilled, so only a known-zero count rules a ticket out; one that
  // turns out to have no emails just reads as unavailable when the paper is taken.
  return tickets.filter((t) => t.emailCount !== 0).map((t) => t.id);
}

type TicketContent = { firstEmail: OnboardingEmail; thread: OnboardingEmail[] } | null;

/**
 * Read a paper ticket's content live. `includeThread` is false for the trainee, so the answer key
 * never enters that response. Null when the ticket is gone or has no emails. `createdAt` carries
 * the provider's received time, so ordering here is mail order, not ingest order.
 */
export async function loadTicketContent(
  channelId: string,
  ticketId: string,
  includeThread: boolean
): Promise<TicketContent> {
  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, channelId },
    select: { conversationId: true },
  });
  if (!ticket) return null;
  const conversationId = ticket.conversationId;
  const oldest = { orderBy: { createdAt: 'asc' }, select: { id: true, ...SELECT } } as const;

  // The customer's first message; a ticket opened by an outbound compose falls back to its oldest.
  const first =
    (await db.email.findFirst({ where: { conversationId, type: EmailType.DEFAULT }, ...oldest })) ??
    (await db.email.findFirst({ where: { conversationId }, ...oldest }));
  if (!first) return null;

  // Newest first, since that is where the desk's resolution is, then oldest-first for reading.
  const later = includeThread
    ? await db.email.findMany({
        where: { conversationId, id: { not: first.id } },
        orderBy: { createdAt: 'desc' },
        select: SELECT,
        take: MAX_THREAD_EMAILS,
      })
    : [];

  return { firstEmail: toEmail(first), thread: later.reverse().map(toEmail) };
}
