import type { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { assertChannelMembership, isDeskOwnerOrChannelAdmin } from '@/utils/channelMembership';
import {
  ONBOARDING_MAX_REPLY_CHARS,
  OnboardingDataError,
  OnboardingRequestError,
  loadDeskOwnerUserId,
} from '@/services/onboarding/onboardingStore';
import { recordGradeCallback } from '@/services/onboarding/onboardingGrading';
import {
  createTopic,
  getAttemptReview,
  getAttemptTicketEmail,
  getOnboardingState,
  saveDraft,
  searchDeskTickets,
  setTopicTickets,
  startOrResumeAttempt,
  submitAttempt,
  updateTopic,
  type OnboardingActor,
} from '@/services/onboarding/onboardingService';

const createTopicBody = z.object({
  name: z.string().min(1).max(200),
  graderAgentSlug: z.string().nullable().optional(),
});

const updateTopicBody = z.object({
  name: z.string().min(1).max(200).optional(),
  graderAgentSlug: z.string().nullable().optional(),
  deleted: z.literal(true).optional(),
});

const setTicketsBody = z.object({ ticketIds: z.array(z.string().min(1)) });

const repliesBody = z.object({
  replies: z.array(
    z.object({
      paperTicketId: z.string(),
      replyText: z.string().max(ONBOARDING_MAX_REPLY_CHARS),
    })
  ),
});

type Handler = (req: Request, res: Response, actor: OnboardingActor) => Promise<unknown>;

/** Membership check, admin resolution, and one error mapping for every onboarding route. */
function withActor(label: string, handler: Handler) {
  return async (req: Request, res: Response): Promise<void> => {
    const channelId = req.params['channelId'];
    if (!channelId) {
      res.status(400).json({ success: false, error: 'channelId is required' });
      return;
    }
    try {
      const access = await assertChannelMembership(req, channelId);
      if (!access.ok) {
        res.status(access.status).json({ success: false, error: access.error });
        return;
      }
      const actor: OnboardingActor = {
        userId: access.userId,
        workspaceId: access.workspaceId,
        channelId,
        isAdmin: await isDeskOwnerOrChannelAdmin(
          channelId,
          access.userId,
          await loadDeskOwnerUserId(channelId)
        ),
      };
      const data = await handler(req, res, actor);
      if (!res.headersSent) res.json({ success: true, data });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Invalid request', details: err.issues });
        return;
      }
      if (err instanceof OnboardingRequestError) {
        res.status(err.status).json({ success: false, error: err.message });
        return;
      }
      if (err instanceof OnboardingDataError) {
        logger.error(`[Onboarding] ${label} read unreadable data`, { channelId, error: err });
        res.status(500).json({
          success: false,
          error: 'This desk’s onboarding data couldn’t be read. Contact an admin.',
        });
        return;
      }
      // The row lock is shared with Zero's own writes, so a busy desk can time out; retrying works.
      if (err instanceof Error && 'code' in err && err.code === 'P2028') {
        res.status(409).json({ success: false, error: 'The desk was busy. Try again.' });
        return;
      }
      logger.error(`[Onboarding] ${label} failed`, { channelId, error: err });
      res.status(500).json({ success: false, error: 'Something went wrong. Try again.' });
    }
  };
}

const param = (req: Request, name: string): string => {
  const value = req.params[name];
  if (!value) throw new OnboardingRequestError(`${name} is required`);
  return value;
};

export const onboardingController = {
  getState: withActor('getState', (_req, _res, actor) => getOnboardingState(actor)),

  searchTickets: withActor('searchTickets', (req, _res, actor) =>
    searchDeskTickets(actor, typeof req.query['q'] === 'string' ? req.query['q'].trim() : '')
  ),

  createTopic: withActor('createTopic', (req, _res, actor) => {
    const body = createTopicBody.parse(req.body);
    return createTopic(actor, body.name, body.graderAgentSlug ?? null);
  }),

  updateTopic: withActor('updateTopic', (req, _res, actor) =>
    updateTopic(actor, param(req, 'topicId'), updateTopicBody.parse(req.body))
  ),

  setTopicTickets: withActor('setTopicTickets', (req, _res, actor) =>
    setTopicTickets(actor, param(req, 'topicId'), setTicketsBody.parse(req.body).ticketIds)
  ),

  startAttempt: withActor('startAttempt', (req, _res, actor) =>
    startOrResumeAttempt(actor, param(req, 'topicId'))
  ),

  getTicketEmail: withActor('getTicketEmail', (req, _res, actor) =>
    getAttemptTicketEmail(actor, param(req, 'attemptId'), param(req, 'paperTicketId'))
  ),

  saveDraft: withActor('saveDraft', (req, _res, actor) =>
    saveDraft(actor, param(req, 'attemptId'), repliesBody.parse(req.body).replies)
  ),

  submit: withActor('submit', (req, _res, actor) =>
    submitAttempt(actor, param(req, 'attemptId'), repliesBody.parse(req.body).replies)
  ),

  getReview: withActor('getReview', (req, _res, actor) =>
    getAttemptReview(actor, param(req, 'attemptId'))
  ),
};

/** POST /api/internal/onboarding/grade-callback/:channelId/:attemptId/:paperTicketId/:sessionId — S2S agent result. */
export async function handleOnboardingGradeCallback(
  req: Request<{ channelId: string; attemptId: string; paperTicketId: string; sessionId: string }>,
  res: Response
): Promise<void> {
  const { channelId, attemptId, paperTicketId, sessionId } = req.params;
  const payload = (req.body ?? {}) as Record<string, unknown>;
  logger.info('[Onboarding] grade callback received', {
    channelId,
    attemptId,
    paperTicketId,
    sessionId,
    status: payload['status'],
  });
  try {
    const persisted = await recordGradeCallback(
      channelId,
      attemptId,
      paperTicketId,
      sessionId,
      payload
    );
    res.json({ success: true, persisted });
  } catch (err) {
    logger.error('[Onboarding] grade callback failed', {
      channelId,
      attemptId,
      paperTicketId,
      sessionId,
      error: err,
    });
    res.status(500).json({ success: false, error: 'failed to record grade' });
  }
}
