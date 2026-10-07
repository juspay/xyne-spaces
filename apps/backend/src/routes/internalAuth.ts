import { Router } from 'express';
import { AuthTokenController } from '@/controllers/authTokenController';

const router = Router();

/**
 * @route POST /api/internal/auth/token
 * @desc  S2S (x-s2s-key): mint a short-lived workspace JWT for a user/account that has an ACTIVE
 *        session. Used by claw-auth instead of reading workflow.user_sessions.
 *        Body { userId?: string; accountId?: string; workspaceId: string }
 *        404 unknown user · 409 no_active_session · 403 workspace_forbidden
 */
router.post('/token', AuthTokenController.issueInternalToken);

export default router;
