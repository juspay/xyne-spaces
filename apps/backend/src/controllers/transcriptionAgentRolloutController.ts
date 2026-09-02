import { Request, Response } from 'express';
import { repositories } from '@/database/repositories';
import { livekitService } from '@/services/liveKitService';
import { logger } from '@/utils/logger';

export class TranscriptionAgentRolloutController {
  /**
   * GET /internal/transcription-agent/agents
   * Lists every row (every role's current active holder plus inactive history), so an
   * operator can see what's currently assigned before attempting a rollout.
   */
  listAgents = async (_req: Request, res: Response): Promise<void> => {
    try {
      const agents = await repositories.transcriptionAgents.list();
      res.status(200).json({ agents });
    } catch (error) {
      logger.error('transcription_agent_list_failed', { error });
      res.status(503).json({ error: 'Service Unavailable' });
    }
  };

  /**
   * POST /internal/transcription-agent/rollout
   * Body: { agentName, role, actor }
   *
   * Human-triggered path — kept as a fallback for when a pod's own self-report never
   * lands (persistent misconfig, etc.). Goes through the exact same verify-then-commit
   * function as the pod self-report endpoint (transcriptionAgentController.registerAgent):
   * live-verifies agentName against LiveKit before ever writing to the DB, so a typo'd
   * name is rejected outright rather than silently accepted. `actor` is logged only (no
   * DB audit table by design — audit trail is backend logs) since this endpoint's auth
   * is a shared secret with no per-caller identity of its own.
   */
  rollout = async (req: Request, res: Response): Promise<void> => {
    const { agentName, role, actor, reason } = (req.body ?? {}) as {
      agentName?: unknown;
      role?: unknown;
      actor?: unknown;
      reason?: unknown;
    };

    if (typeof agentName !== 'string' || !agentName.trim()) {
      res.status(400).json({ error: 'Bad Request', message: 'agentName is required' });
      return;
    }
    if (typeof role !== 'string' || !role.trim()) {
      res.status(400).json({ error: 'Bad Request', message: 'role is required' });
      return;
    }
    if (typeof actor !== 'string' || !actor.trim()) {
      res.status(400).json({ error: 'Bad Request', message: 'actor is required' });
      return;
    }

    try {
      const result = await livekitService.attemptTranscriptionAgentRollout(agentName.trim(), role.trim());
      if (!result.success) {
        res.status(400).json({
          error: 'agent_not_claimed',
          message: `"${agentName}" was dispatched into a verification room but no worker claimed it within the check window — nothing was registered under this name, or it's not currently reachable.`,
        });
        return;
      }

      logger.warn('transcription_agent_rollout_completed', {
        agentName: agentName.trim(),
        role,
        actor: actor.trim(),
        reason: typeof reason === 'string' ? reason : undefined,
      });
      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('transcription_agent_rollout_failed', { agentName, role, actor, error });
      res.status(503).json({ error: 'Service Unavailable' });
    }
  };
}

export const transcriptionAgentRolloutController = new TranscriptionAgentRolloutController();
