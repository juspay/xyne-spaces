import { randomUUID } from 'crypto';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { withWorkspaceScope } from '@/database/tenant/context';
import { DEFAULT_ONBOARDING_GRADER_SLUG, gradeDueReviews } from './onboardingGrading';
import { findPaperEligibleTickets, loadTicketContent } from './onboardingEmails';
import {
  ONBOARDING_MAX_SCORE_PER_ANSWER,
  ONBOARDING_MAX_TICKETS_PER_TOPIC,
  OnboardingRequestError,
  attemptCountKey,
  loadPreferenceRow,
  nowIso,
  parseOnboardingAttempts,
  parseOnboardingConfig,
  pruneAttempts,
  updateOnboardingAttempts,
  updateOnboardingConfig,
  type OnboardingAttempt,
  type OnboardingTopic,
} from './onboardingStore';

export interface OnboardingActor {
  userId: string;
  workspaceId: string;
  channelId: string;
  /** Desk owner or channel admin — the same rule as `canManage` in Desk Settings. */
  isAdmin: boolean;
}

function requireAdmin(actor: OnboardingActor): void {
  if (!actor.isAdmin) throw new OnboardingRequestError('Only desk admins can do this', 403);
}

function findLiveTopic(topics: OnboardingTopic[], topicId: string): OnboardingTopic {
  const topic = topics.find((t) => t.id === topicId && t.deletedAt === null);
  if (!topic) throw new OnboardingRequestError('Topic not found', 404);
  return topic;
}

/** Members never see reviews, per-answer scores, or which real ticket a paper ticket is. */
function projectAttemptForMember(attempt: OnboardingAttempt) {
  return {
    id: attempt.id,
    topicId: attempt.topicId,
    userId: attempt.userId,
    status: attempt.status,
    startedAt: attempt.startedAt,
    draftSavedAt: attempt.draftSavedAt,
    submittedAt: attempt.submittedAt,
    durationSeconds: attempt.durationSeconds,
    gradedAt: attempt.gradedAt,
    totalScore: attempt.totalScore,
    maxScore: attempt.maxScore,
    answers: attempt.answers.map((a) => ({
      paperTicketId: a.paperTicketId,
      replyText: a.replyText,
    })),
  };
}

/** The Onboarding tab's whole state, loaded from the desk's preference row and projected by role. */
export async function getOnboardingState(actor: OnboardingActor) {
  const row = await loadPreferenceRow(actor.channelId);
  const config = parseOnboardingConfig(row?.onboardingConfig);
  const state = parseOnboardingAttempts(row?.onboardingAttempts);
  const liveTopics = config.topics.filter((t) => t.deletedAt === null);

  if (!actor.isAdmin) {
    const mine = state.attempts.filter((a) => a.userId === actor.userId);
    return {
      isAdmin: false,
      topics: liveTopics.map((t) => ({ id: t.id, name: t.name, ticketCount: t.tickets.length })),
      // Topics deleted mid-exam still need a name for the open attempt.
      deletedTopics: config.topics
        .filter((t) => t.deletedAt !== null && mine.some((a) => a.topicId === t.id))
        .map((t) => ({ id: t.id, name: t.name })),
      attempts: mine.map(projectAttemptForMember),
      counts: Object.fromEntries(
        Object.entries(state.counts).filter(([key]) => key.endsWith(`:${actor.userId}`))
      ),
      users: [],
      tickets: [],
    };
  }

  const ticketIds = [
    ...new Set([
      ...config.topics.flatMap((t) => t.tickets.map((pt) => pt.ticketId)),
      ...state.attempts.flatMap((a) => a.answers.map((ans) => ans.ticketId)),
    ]),
  ];
  const userIds = [...new Set(state.attempts.map((a) => a.userId))];
  const [tickets, users] = await Promise.all([
    ticketIds.length
      ? db.ticket.findMany({
          where: { id: { in: ticketIds }, channelId: actor.channelId },
          select: { id: true, xyneId: true, title: true },
        })
      : [],
    userIds.length
      ? withWorkspaceScope(() =>
          db.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true },
          })
        )
      : [],
  ]);

  return {
    isAdmin: true,
    topics: liveTopics.map((t) => ({
      id: t.id,
      name: t.name,
      graderAgentSlug: t.graderAgentSlug,
      defaultGraderAgentSlug: DEFAULT_ONBOARDING_GRADER_SLUG,
      ticketCount: t.tickets.length,
      tickets: t.tickets.map((pt) => ({ id: pt.id, ticketId: pt.ticketId })),
      createdAt: t.createdAt,
    })),
    deletedTopics: config.topics
      .filter((t) => t.deletedAt !== null)
      .map((t) => ({ id: t.id, name: t.name })),
    attempts: state.attempts,
    counts: state.counts,
    users,
    tickets,
  };
}

/** Title search is an unanchored ILIKE, so the term is capped to keep the scan bounded. */
const MAX_TICKET_SEARCH_CHARS = 200;

export async function searchDeskTickets(actor: OnboardingActor, q: string) {
  requireAdmin(actor);
  if (!q) return [];
  const term = q.slice(0, MAX_TICKET_SEARCH_CHARS);
  return db.ticket.findMany({
    where: {
      channelId: actor.channelId,
      isArchived: false,
      OR: [
        { xyneId: { contains: term, mode: 'insensitive' } },
        { title: { contains: term, mode: 'insensitive' } },
      ],
    },
    select: { id: true, title: true, xyneId: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
}

export async function createTopic(
  actor: OnboardingActor,
  name: string,
  graderAgentSlug: string | null
) {
  requireAdmin(actor);
  const trimmed = name.trim();
  if (!trimmed) throw new OnboardingRequestError('Topic name is required');

  return updateOnboardingConfig(actor.channelId, actor.workspaceId, (config) => {
    const now = nowIso();
    const topic: OnboardingTopic = {
      id: randomUUID(),
      name: trimmed,
      graderAgentSlug: graderAgentSlug?.trim() || null,
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      tickets: [],
    };
    return { next: { ...config, topics: [...config.topics, topic] }, result: { id: topic.id } };
  });
}

export async function updateTopic(
  actor: OnboardingActor,
  topicId: string,
  patch: { name?: string; graderAgentSlug?: string | null; deleted?: boolean }
) {
  requireAdmin(actor);
  if (patch.name !== undefined && !patch.name.trim()) {
    throw new OnboardingRequestError('Topic name is required');
  }
  return updateOnboardingConfig(actor.channelId, actor.workspaceId, (config, row) => {
    // Read from the locked row, so an attempt started concurrently can't point at a purged topic.
    const referencedTopicIds = new Set(
      parseOnboardingAttempts(row.onboardingAttempts).attempts.map((a) => a.topicId)
    );
    const topic = findLiveTopic(config.topics, topicId);
    const now = nowIso();
    if (patch.name !== undefined) topic.name = patch.name.trim();
    if (patch.graderAgentSlug !== undefined)
      topic.graderAgentSlug = patch.graderAgentSlug?.trim() || null;
    if (patch.deleted) topic.deletedAt = now;
    topic.updatedAt = now;

    // Deleted topics are kept only while some stored attempt still points at them.
    const topics = config.topics.filter(
      (t) => t.deletedAt === null || referencedTopicIds.has(t.id)
    );
    return { next: { ...config, topics }, result: true };
  });
}

/** Replace a paper's ticket list (add, remove and reorder in one call). Order = paper order. */
export async function setTopicTickets(
  actor: OnboardingActor,
  topicId: string,
  ticketIds: string[]
) {
  requireAdmin(actor);
  const unique = [...new Set(ticketIds)];
  if (unique.length !== ticketIds.length)
    throw new OnboardingRequestError('A ticket can only be on a paper once');
  if (unique.length > ONBOARDING_MAX_TICKETS_PER_TOPIC) {
    throw new OnboardingRequestError(
      `A topic can hold at most ${ONBOARDING_MAX_TICKETS_PER_TOPIC} tickets`
    );
  }

  // Only newly added tickets are checked, so a ticket that later moved desks can still be removed or reordered.
  const current = parseOnboardingConfig(
    (await loadPreferenceRow(actor.channelId))?.onboardingConfig
  );
  const alreadyOnPaper = new Set(
    current.topics.find((t) => t.id === topicId)?.tickets.map((pt) => pt.ticketId) ?? []
  );
  const added = unique.filter((id) => !alreadyOnPaper.has(id));
  const eligible = new Set(
    (await findPaperEligibleTickets(actor.channelId, added)).map((t) => t.id)
  );
  if (added.some((id) => !eligible.has(id))) {
    throw new OnboardingRequestError('Some tickets are not on this desk or have no emails');
  }

  return updateOnboardingConfig(actor.channelId, actor.workspaceId, (config) => {
    const topic = findLiveTopic(config.topics, topicId);
    const existing = new Map(topic.tickets.map((pt) => [pt.ticketId, pt]));
    const now = nowIso();
    topic.tickets = unique.map(
      (ticketId) =>
        existing.get(ticketId) ?? {
          id: randomUUID(),
          ticketId,
          addedBy: actor.userId,
          addedAt: now,
        }
    );
    topic.updatedAt = now;
    return { next: config, result: true };
  });
}

/** Resume the caller's open attempt on this paper, or start one fixed to the paper as it is now. */
export async function startOrResumeAttempt(actor: OnboardingActor, topicId: string) {
  const attempt = await updateOnboardingAttempts(
    actor.channelId,
    actor.workspaceId,
    (state, row) => {
      // The paper is read from the locked row, so a topic deleted at the same moment can't be started.
      const config = parseOnboardingConfig(row.onboardingConfig);
      const open = state.attempts.find(
        (a) => a.topicId === topicId && a.userId === actor.userId && a.status === 'IN_PROGRESS'
      );
      // Resuming changes nothing, so skip the write: it would re-serialise the whole column.
      if (open) return { next: null, result: open };
      // The UI hides Start while an attempt is grading; enforce it here too, or a stuck grading
      // run would let one person pile up unbounded attempts in the row.
      if (
        state.attempts.some(
          (a) => a.topicId === topicId && a.userId === actor.userId && a.status === 'GRADING'
        )
      ) {
        throw new OnboardingRequestError('Your last attempt is still being graded', 409);
      }

      const topic = findLiveTopic(config.topics, topicId);
      if (topic.tickets.length === 0)
        throw new OnboardingRequestError('This topic has no tickets yet');
      const created: OnboardingAttempt = {
        id: randomUUID(),
        topicId,
        userId: actor.userId,
        status: 'IN_PROGRESS',
        startedAt: nowIso(),
        draftSavedAt: null,
        submittedAt: null,
        durationSeconds: null,
        gradedAt: null,
        totalScore: null,
        maxScore: null,
        answers: topic.tickets.map((pt) => ({
          paperTicketId: pt.id,
          ticketId: pt.ticketId,
          replyText: '',
          score: null,
          review: null,
        })),
      };
      return { next: { ...state, attempts: [...state.attempts, created] }, result: created };
    }
  );
  if (!attempt) throw new OnboardingRequestError('Could not start the exam', 500);
  return projectAttemptForMember(attempt);
}

function findOwnAttempt(
  attempts: OnboardingAttempt[],
  actor: OnboardingActor,
  attemptId: string
): OnboardingAttempt {
  const attempt = attempts.find((a) => a.id === attemptId);
  if (!attempt || attempt.userId !== actor.userId)
    throw new OnboardingRequestError('Attempt not found', 404);
  return attempt;
}

/** One stored attempt from a freshly loaded row (not under a lock). */
async function loadAttempt(actor: OnboardingActor, attemptId: string) {
  const row = await loadPreferenceRow(actor.channelId);
  return parseOnboardingAttempts(row?.onboardingAttempts).attempts.find((a) => a.id === attemptId);
}

/** The first email of one ticket on an attempt, read live. Owner or admin. Never the rest of the thread. */
export async function getAttemptTicketEmail(
  actor: OnboardingActor,
  attemptId: string,
  paperTicketId: string
) {
  const attempt = await loadAttempt(actor, attemptId);
  if (!attempt || (attempt.userId !== actor.userId && !actor.isAdmin)) {
    throw new OnboardingRequestError('Attempt not found', 404);
  }
  const answer = attempt.answers.find((a) => a.paperTicketId === paperTicketId);
  if (!answer) throw new OnboardingRequestError('Ticket not found on this attempt', 404);

  const content = await loadTicketContent(actor.channelId, answer.ticketId, false);
  if (!content) return { available: false as const };
  const { subject, from, sentAt, text, attachments } = content.firstEmail;
  return { available: true as const, firstEmail: { subject, from, sentAt, text, attachments } };
}

interface ReplyInput {
  paperTicketId: string;
  replyText: string;
}

function applyReplies(attempt: OnboardingAttempt, replies: ReplyInput[]): void {
  const byTicket = new Map(replies.map((r) => [r.paperTicketId, r.replyText]));
  for (const answer of attempt.answers) {
    const reply = byTicket.get(answer.paperTicketId);
    if (reply !== undefined) answer.replyText = reply;
  }
}

export async function saveDraft(actor: OnboardingActor, attemptId: string, replies: ReplyInput[]) {
  const saved = await updateOnboardingAttempts(actor.channelId, actor.workspaceId, (state) => {
    const attempt = findOwnAttempt(state.attempts, actor, attemptId);
    if (attempt.status !== 'IN_PROGRESS')
      throw new OnboardingRequestError('This exam was already submitted', 409);
    applyReplies(attempt, replies);
    attempt.draftSavedAt = nowIso();
    return { next: state, result: attempt.draftSavedAt };
  });
  return { draftSavedAt: saved };
}

/** Store the final replies, move to grading, and send non-blank answers to the grading agent. */
export async function submitAttempt(
  actor: OnboardingActor,
  attemptId: string,
  replies: ReplyInput[]
) {
  const submitted = await updateOnboardingAttempts(
    actor.channelId,
    actor.workspaceId,
    (state, row) => {
      const attempt = findOwnAttempt(state.attempts, actor, attemptId);
      if (attempt.status !== 'IN_PROGRESS')
        throw new OnboardingRequestError('This exam was already submitted', 409);
      applyReplies(attempt, replies);

      // A topic deleted mid-exam still grades, with the agent it had.
      const config = parseOnboardingConfig(row.onboardingConfig);
      const topic = config.topics.find((t) => t.id === attempt.topicId);
      const agentSlug = topic?.graderAgentSlug || DEFAULT_ONBOARDING_GRADER_SLUG;
      const now = new Date();
      attempt.status = 'GRADING';
      attempt.submittedAt = now.toISOString();
      attempt.durationSeconds = Math.max(
        0,
        Math.round((now.getTime() - Date.parse(attempt.startedAt)) / 1000)
      );
      for (const answer of attempt.answers) {
        const blank = answer.replyText.trim() === '';
        answer.score = blank ? 0 : null;
        answer.review = {
          status: blank ? 'SKIPPED' : 'PENDING',
          reasoning: null,
          missedPoints: [],
          agentSlug,
          sessionId: null,
          dispatchedAt: null,
          retryCount: 0,
          gradedAt: blank ? attempt.submittedAt : null,
          error: null,
        };
      }

      const key = attemptCountKey(attempt.topicId, attempt.userId);
      const counts = { ...state.counts, [key]: (state.counts[key] ?? 0) + 1 };

      // Blank skips carry no error, so every answer still counts toward maxScore — the same rule
      // finalizeIfDone applies when it excludes answers skipped because a ticket was unavailable.
      if (attempt.answers.every((a) => a.review?.status === 'SKIPPED')) {
        attempt.status = 'GRADED';
        attempt.gradedAt = attempt.submittedAt;
        attempt.totalScore = 0;
        attempt.maxScore = attempt.answers.length * ONBOARDING_MAX_SCORE_PER_ANSWER;
        const attempts = pruneAttempts(state.attempts, attempt.topicId, attempt.userId);
        return { next: { ...state, attempts, counts }, result: attempt };
      }
      return { next: { ...state, counts }, result: attempt };
    }
  );
  if (!submitted) throw new OnboardingRequestError('Could not submit the exam', 500);

  if (submitted.status === 'GRADING') {
    void withWorkspaceScope(() => gradeDueReviews(actor.channelId, actor.workspaceId)).catch(
      (err) =>
        logger.error('[Onboarding] grading dispatch after submit failed', {
          channelId: actor.channelId,
          attemptId,
          error: err,
        })
    );
  }
  return projectAttemptForMember(submitted);
}

/** One attempt with, per ticket, the first email and the rest of the thread read live. */
export async function getAttemptReview(actor: OnboardingActor, attemptId: string) {
  requireAdmin(actor);
  const attempt = await loadAttempt(actor, attemptId);
  if (!attempt) throw new OnboardingRequestError('Attempt not found', 404);

  // Read the threads a few at a time: a 20-ticket paper would otherwise load and convert every
  // email on 20 conversations at once.
  const answers: (OnboardingAttempt['answers'][number] & {
    content: Awaited<ReturnType<typeof loadTicketContent>>;
  })[] = [];
  for (const answer of attempt.answers) {
    answers.push({
      ...answer,
      content: await loadTicketContent(actor.channelId, answer.ticketId, true),
    });
  }
  return { ...attempt, answers };
}
