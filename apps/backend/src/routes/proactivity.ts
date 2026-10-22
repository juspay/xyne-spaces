import { Router, type Request, type Response } from 'express';
import { AccessType } from '@xyne/shared';
import { authorize } from '@/middleware/authorize';
import { authMiddleware } from '@/middleware/auth';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import {
  proactiveChannels,
  whyForMessage,
  workspaceDecisions,
  messageTrace,
} from '@/services/proactivity/insights';
import { fetchDrafts } from '@/services/proactivity/dispatch';
import { loadProactivityConfig } from '@/services/proactivity/config';
import { askDecision } from '@/services/decision/ask';
import { decisionEngineModel } from '@/services/decision/targets';
import type { YesNoQuestion } from '@/services/decision/types';

/** Agents answering without a mention: what it decided, for the channel's members. */
const router = Router();
router.use(authMiddleware.authenticate);

/** Why it did or didn't answer a message. The ACL keeps it to the channel's members. */
router.get('/why/:messageId', async (req: Request, res: Response) => {
  try {
    res.json({ success: true, decisions: await whyForMessage(String(req.params.messageId)) });
  } catch (error) {
    logger.error('[Proactivity] why lookup failed', { error });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * What each agent wrote for a question, for a held or Shadow one. The row is read through
 * the ACL, so only the channel's members get past it; the text comes from claw-auth.
 */
router.get('/decisions/:id/drafts', async (req: Request, res: Response) => {
  try {
    const episode = await db.agentProactivityDecision.findFirst({
      where: { id: String(req.params.id) },
      select: { id: true, channelId: true },
    });
    if (!episode) return void res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, drafts: await fetchDrafts(episode.id, episode.channelId) });
  } catch (error) {
    logger.error('[Proactivity] drafts lookup failed', { error });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const OUTCOMES = new Set(['posted', 'reacted', 'held', 'shadow', 'quiet', 'drafting']);

/** Administration → Agent activity: workspace admins, across the channels they can access. */
router.get(
  '/workspace/decisions',
  authorize('WORKSPACE', AccessType.ADMIN),
  async (req: Request, res: Response) => {
    try {
      const before = typeof req.query.before === 'string' ? new Date(req.query.before) : null;
      const outcome = typeof req.query.outcome === 'string' ? req.query.outcome : '';
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
      const [decisions, channels] = await Promise.all([
        workspaceDecisions({
          ...(typeof req.query.channelId === 'string' && req.query.channelId
            ? { channelId: req.query.channelId }
            : {}),
          ...(OUTCOMES.has(outcome) ? { outcome } : {}),
          ...(before && !Number.isNaN(before.getTime()) ? { before } : {}),
          limit,
        }),
        proactiveChannels(),
      ]);
      res.json({
        success: true,
        decisions,
        channels,
        nextBefore: decisions.length === limit ? decisions[decisions.length - 1].createdAt : null,
      });
    } catch (error) {
      logger.error('[Proactivity] workspace decisions failed', { error });
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

/**
 * A message's whole journey: its decisions, every XOR request with each question and
 * probability, and each agent's run (task, tool calls, draft). Workspace admins, across
 * the channels they can access.
 */
router.get(
  '/trace/:messageId',
  authorize('WORKSPACE', AccessType.ADMIN),
  async (req: Request, res: Response) => {
    try {
      const trace = await messageTrace(String(req.params.messageId));
      const decisions = await Promise.all(
        trace.decisions.map(async (decision) => ({
          ...decision,
          runs: await fetchDrafts(decision.id, decision.channelId).catch(() => []),
        }))
      );
      // Today's thresholds, so the trace can show which side of the line each answer fell.
      const config = decisions[0] ? await loadProactivityConfig(decisions[0].workspaceId) : null;
      res.json({
        success: true,
        message: trace.message,
        decisions,
        // The model every XOR request went to, so the trace shows the request in full.
        xorModel: decisionEngineModel(),
        thresholds: config && {
          gate: config.gate,
          route: config.route,
          beforePosting: config.beforePosting,
          followUp: config.followUps,
        },
      });
    } catch (error) {
      logger.error('[Proactivity] trace failed', { error });
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

/**
 * Try an XOR request again, edited: the trace's state and yes/no questions, sent as they
 * are, with each question's probability back. For tuning a question's wording against a
 * real case. Workspace admins; nothing is stored.
 */
router.post(
  '/xor/try',
  authorize('WORKSPACE', AccessType.ADMIN),
  async (req: Request, res: Response) => {
    const { state, questions } = (req.body ?? {}) as {
      state?: unknown;
      questions?: Record<string, unknown>;
    };
    const entries = questions && typeof questions === 'object' ? Object.entries(questions) : [];
    const valid =
      typeof state === 'string' &&
      entries.length > 0 &&
      entries.length <= 100 &&
      entries.every(
        ([, q]) =>
          !!q &&
          typeof q === 'object' &&
          (q as YesNoQuestion).type === 'noul' &&
          typeof (q as YesNoQuestion).instructions === 'string'
      );
    if (!valid) {
      res.status(400).json({
        success: false,
        error: 'state must be text and questions 1 to 100 yes/no questions with instructions',
      });
      return;
    }
    try {
      const answers = await askDecision(
        'agent_proactivity',
        state,
        questions as Record<string, YesNoQuestion>,
        10_000
      );
      if (!answers) {
        res.status(502).json({ success: false, error: 'XOR did not answer' });
        return;
      }
      const probabilities: Record<string, number | null> = {};
      for (const [key] of entries) {
        const answer = answers[key];
        probabilities[key] = answer?.type === 'noul' ? answer.noul : null;
      }
      res.json({ success: true, probabilities });
    } catch (error) {
      logger.error('[Proactivity] XOR try failed', { error });
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

export default router;
