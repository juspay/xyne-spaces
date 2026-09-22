import type { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { assertChannelMembership, isDeskOwnerOrChannelAdmin } from '@/utils/channelMembership';
import {
  MAX_REPLY_CHARS,
  OnboardingRequestError,
  loadPreferenceRow,
} from '@/services/onboarding/onboardingStore';
import {
  createTopic,
  getOnboardingState,
  recordGradeCallback,
  retryGrading,
  startOrResumeAttempt,
  submitAttempt,
  updateTopic,
  type OnboardingActor,
} from '@/services/onboarding/onboardingService';

const topicName = z.string().trim().min(1).max(200);

const patchBody = z.object({
  name: topicName.optional(),
  graderAgentSlug: z.string().nullable().optional(),
  ticketIds: z.array(z.string().min(1)).optional(),
  deleted: z.literal(true).optional(),
});

const p = (req: Request, name: string): string => req.params[name] ?? '';

/** Membership check, admin resolution, and one error mapping for every onboarding route. */
function withActor(handler: (req: Request, actor: OnboardingActor) => Promise<unknown>) {
  return async (req: Request, res: Response): Promise<void> => {
    const channelId = p(req, 'channelId');
    try {
      const access = await assertChannelMembership(req, channelId);
      if (!access.ok) {
        res.status(access.status).json({ success: false, error: access.error });
        return;
      }
      const preference = await loadPreferenceRow(channelId);
      const data = await handler(req, {
        userId: access.userId,
        workspaceId: access.workspaceId,
        channelId,
        isAdmin: await isDeskOwnerOrChannelAdmin(
          channelId,
          access.userId,
          preference?.ownerUserId ?? null
        ),
      });
      res.json({ success: true, data });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Invalid request', details: err.issues });
      } else if (err instanceof OnboardingRequestError) {
        res.status(err.status).json({ success: false, error: err.message });
      } else if (err instanceof Error && 'code' in err && err.code === 'P2028') {
        // The row lock is shared with Zero's writes, so a busy desk times out; retrying works.
        res.status(409).json({ success: false, error: 'The desk was busy. Try again.' });
      } else {
        logger.error('[Onboarding] request failed', { channelId, path: req.path, error: err });
        res.status(500).json({ success: false, error: 'Something went wrong. Try again.' });
      }
    }
  };
}

export const onboardingController = {
  getState: withActor((_req, actor) => getOnboardingState(actor)),

  createTopic: withActor((req, actor) =>
    createTopic(actor, z.object({ name: topicName }).parse(req.body).name)
  ),

  updateTopic: withActor((req, actor) =>
    updateTopic(actor, p(req, 'topicId'), patchBody.parse(req.body))
  ),

  startAttempt: withActor((req, actor) => startOrResumeAttempt(actor, p(req, 'topicId'))),

  submit: withActor((req, actor) =>
    submitAttempt(
      actor,
      p(req, 'attemptId'),
      z.object({ replies: z.array(z.string().max(MAX_REPLY_CHARS)) }).parse(req.body).replies
    )
  ),

  retry: withActor((req, actor) => retryGrading(actor, p(req, 'attemptId'))),
};

/** POST /api/internal/onboarding/grade-callback/:channelId/:attemptId/:index — S2S agent result. */
export async function handleOnboardingGradeCallback(req: Request, res: Response): Promise<void> {
  const { channelId = '', attemptId = '', index = '' } = req.params;
  try {
    const persisted = await recordGradeCallback(
      channelId,
      attemptId,
      Number(index),
      (req.body ?? {}) as Record<string, unknown>
    );
    res.json({ success: true, persisted });
  } catch (err) {
    logger.error('[Onboarding] grade callback failed', { channelId, attemptId, index, error: err });
    res.status(500).json({ success: false, error: 'failed to record grade' });
  }
}
