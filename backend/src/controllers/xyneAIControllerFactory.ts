import { Request, Response } from 'express';
import { config } from '@/config/env';
import { xyneAIController } from './xyneAIController';
import { xyneAIControllerV2 } from './xyneAIControllerV2';
import { logger } from '@/utils/logger';

/**
 * Factory that routes between v1 and v2 Ask AI controllers based on environment config
 * v1: Uses xyneAIStream (legacy)
 * v2: Uses xyne-claw API
 */
export class XyneAIControllerFactory {
  /**
   * Main query endpoint - routes to v1 or v2 based on ASK_AI_VERSION config
   * User can override via request body version parameter
   */
  query = async (req: Request, res: Response): Promise<void> => {
    const requestVersion = req.body?.version as 'v1' | 'v2' | undefined;
    const version = requestVersion || config.askAI.version;
    const agentSlug = req.body?.agentSlug || req.body?.agent_slug || 'ask-ai';
    logger.info(
      `[XyneAI] Routing query to version: ${version} (request override: ${requestVersion || 'none'}, agentSlug: ${agentSlug})`
    );

    // If v1 is selected but a non-ask-ai claw agent is chosen, route to v2 (unified claw)
    const useV2 = version === 'v2' || agentSlug !== 'ask-ai';

    if (useV2) {
      return xyneAIControllerV2.query(req, res);
    } else {
      return xyneAIController.query(req, res);
    }
  };

  /**
   * Feedback endpoint - works with both versions
   * Routes to the same controller version that handled the original request
   * User can override via request body version parameter
   */
  feedback = async (req: Request, res: Response): Promise<void> => {
    const requestVersion = req.body?.version as 'v1' | 'v2' | undefined;
    const version = requestVersion || config.askAI.version;
    logger.info(`[XyneAI] Routing feedback to version: ${version}`);

    if (version === 'v2') {
      return xyneAIControllerV2.feedback(req, res);
    } else {
      return xyneAIController.feedback(req, res);
    }
  };

  /**
   * Get memories - v2 uses different memory system (optional override)
   */
  getMemories = async (req: Request, res: Response): Promise<void> => {
    // For now, v2 doesn't support memories differently - use v1
    // Can be overridden later if needed
    return xyneAIController.getMemories(req, res);
  };

  /**
   * Delete memory - v2 uses different memory system (optional override)
   */
  deleteMemory = async (req: Request, res: Response): Promise<void> => {
    return xyneAIController.deleteMemory(req, res);
  };

  /**
   * Clear memories - v2 uses different memory system (optional override)
   */
  clearMemories = async (req: Request, res: Response): Promise<void> => {
    return xyneAIController.clearMemories(req, res);
  };

  /**
   * List products - v2 uses same research agent
   */
  listProducts = async (req: Request, res: Response): Promise<void> => {
    return xyneAIController.listProducts(req, res);
  };

  /**
   * List repositories - v2 uses same research agent
   */
  listRepositories = async (req: Request, res: Response): Promise<void> => {
    return xyneAIController.listRepositories(req, res);
  };

  /**
   * Get config - v2 might have different capabilities
   */
  getConfig = async (_req: Request, res: Response): Promise<void> => {
    const version = config.askAI.version;

    // Return base config with version info
    res.json({
      webSearchAccessible: config.xyneAiExtended.url ? true : false,
      deepResearchAccessible: config.xyneAiExtended.url ? true : false,
      version: version,
      v2Enabled: version === 'v2',
    });
  };

  /**
   * Get sessions - v2 uses xyne-claw session storage
   */
  getSessions = async (req: Request, res: Response): Promise<void> => {
    // For v2, we might use a different session store
    // For now, delegate to v1
    return xyneAIController.getSessions(req, res);
  };

  /**
   * Get session detail - v2 uses xyne-claw session storage
   */
  getSessionDetail = async (req: Request, res: Response): Promise<void> => {
    return xyneAIController.getSessionDetail(req, res);
  };

  /**
   * Resolve "the user's session for this mail" — replaces localStorage-based
   */
  getSessionByConversation = async (req: Request, res: Response): Promise<void> => {
    return xyneAIController.getSessionByConversation(req, res);
  };

  /**
   * Resolve "the autodraft session for this mail" — looks up the channel
   */
  getAutodraftSessionByConversation = async (req: Request, res: Response): Promise<void> => {
    return xyneAIController.getAutodraftSessionByConversation(req, res);
  };

  /**
   * Toggle star - v2 uses xyne-claw session storage
   */
  toggleStar = async (req: Request, res: Response): Promise<void> => {
    return xyneAIController.toggleStar(req, res);
  };

  /**
   * Rename session - v2 uses xyne-claw session storage
   */
  renameSession = async (req: Request, res: Response): Promise<void> => {
    return xyneAIController.renameSession(req, res);
  };

  /**
   * Delete session - v2 uses xyne-claw session storage
   */
  deleteSessionEndpoint = async (req: Request, res: Response): Promise<void> => {
    return xyneAIController.deleteSessionEndpoint(req, res);
  };

  /**
   * Update session metadata - v2 uses xyne-claw session storage
   */
  updateSessionMetadata = async (req: Request, res: Response): Promise<void> => {
    return xyneAIController.updateSessionMetadata(req, res);
  };

  // ===== v2 Specific Endpoints =====

  // Webhook handlers removed - now using SSE streaming via /run/stream endpoint
  // Progress and callback events are handled internally by claw-auth
  // and streamed to Spaces backend via SSE, not webhooks

  /**
   * POST /api/xyne-ai/v2/action
   * Approve or decline a pending write action (human-in-the-loop)
   */
  handleActionApproval = async (req: Request, res: Response): Promise<void> => {
    const agentSlug = (req.body?.agentSlug || req.body?.agent_slug) as string | undefined;
    if (config.askAI.version !== 'v2' && !agentSlug) {
      res.status(404).json({ error: 'v2 endpoints not enabled' });
      return;
    }
    return xyneAIControllerV2.handleActionApproval(req, res);
  };

  /**
   * GET /api/xyne-ai/v2/conversations
   * List user's AI conversations from claw (v2 only)
   */
  listConversations = async (req: Request, res: Response): Promise<void> => {
    const agentSlug = (req.query?.agentSlug || req.query?.agent_slug) as string | undefined;
    if (config.askAI.version !== 'v2' && !agentSlug) {
      res.status(404).json({ error: 'v2 endpoints not enabled' });
      return;
    }
    return xyneAIControllerV2.listConversations(req, res);
  };

  /**
   * GET /api/xyne-ai/v2/conversations/:convId/messages
   * Get conversation messages from claw (v2 only)
   */
  getConversationMessages = async (req: Request, res: Response): Promise<void> => {
    const agentSlug = (req.query?.agentSlug ||
      req.query?.agent_slug ||
      req.body?.agentSlug ||
      req.body?.agent_slug) as string | undefined;
    if (config.askAI.version !== 'v2' && !agentSlug) {
      res.status(404).json({ error: 'v2 endpoints not enabled' });
      return;
    }
    return xyneAIControllerV2.getConversationMessages(req, res);
  };

  getConversationDebug = async (req: Request, res: Response): Promise<void> => {
    const agentSlug = (req.query?.agentSlug || req.query?.agent_slug) as string | undefined;
    if (config.askAI.version !== 'v2' && !agentSlug) {
      res.status(404).json({ error: 'v2 endpoints not enabled' });
      return;
    }
    return xyneAIControllerV2.getConversationDebug(req, res);
  };

  streamConversationLive = async (req: Request, res: Response): Promise<void> => {
    const agentSlug = (req.query?.agentSlug || req.query?.agent_slug) as string | undefined;
    if (config.askAI.version !== 'v2' && !agentSlug) {
      res.status(404).json({ error: 'v2 endpoints not enabled' });
      return;
    }
    return xyneAIControllerV2.streamConversationLive(req, res);
  };

  /**
   * DELETE /api/xyne-ai/v2/conversations/:convId
   * Delete a conversation in claw (v2 only)
   */
  deleteConversation = async (req: Request, res: Response): Promise<void> => {
    const agentSlug = (req.query?.agentSlug || req.query?.agent_slug) as string | undefined;
    if (config.askAI.version !== 'v2' && !agentSlug) {
      res.status(404).json({ error: 'v2 endpoints not enabled' });
      return;
    }
    return xyneAIControllerV2.deleteConversation(req, res);
  };

  /**
   * Download attachment from claw - v2 only
   */
  downloadAttachment = async (req: Request, res: Response): Promise<void> => {
    const agentSlug = (req.query?.agentSlug ||
      req.query?.agent_slug ||
      req.body?.agentSlug ||
      req.body?.agent_slug) as string | undefined;
    if (config.askAI.version !== 'v2' && !agentSlug) {
      res.status(404).json({ error: 'v2 endpoints not enabled' });
      return;
    }
    return xyneAIControllerV2.downloadAttachment(req, res);
  };

  /**
   * GET /api/xyne-ai/agents
   * List all claw agents accessible to the current user.
   */
  listAccessibleAgents = async (req: Request, res: Response): Promise<void> => {
    return xyneAIControllerV2.listAccessibleAgents(req, res);
  };

  /**
   * POST /api/xyne-ai/v2/cancel/:sessionId
   * Cancel an in-flight v2 (claw) run; partial state is persisted via the
   * cancelled `done` frame on the upstream stream. Sessions are always claw
   * sessions (v1 ask-ai has no sessionId to cancel), so this just delegates.
   */
  cancelRun = async (req: Request, res: Response): Promise<void> => {
    return xyneAIControllerV2.cancelRun(req, res);
  };
}

export const xyneAIControllerFactory = new XyneAIControllerFactory();

/**
 * Middleware to inject version info into requests
 */
export function xyneAIVersionMiddleware(req: Request, _res: Response, next: () => void): void {
  (req as any).xyneAIVersion = config.askAI.version;
  next();
}
