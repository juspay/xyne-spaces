/**
 * SDK SSO Routes - Device flow endpoints for SDK authentication.
 *
 * On approval the SDK receives the user's session — the same
 * `xyne_ws_<workspaceId>_token` cookie the dashboard sets on login — which
 * `/api/sdk` then authenticates with the ordinary `authMiddleware`.
 *
 * Endpoints:
 * - POST /api/sdk/auth/sso/init     - Initiate device flow (no auth required)
 * - POST /api/sdk/auth/sso/poll     - Poll for authorization result (no auth required)
 * - GET  /api/sdk/auth/sso/consent  - Redirects to the dashboard consent page
 * - GET  /api/sdk/auth/sso/status   - Get device auth status by user_code (session auth)
 * - POST /api/sdk/auth/sso/approve  - Approve/deny authorization (session auth)
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sdkSsoService } from '@/services/sdkSsoService';
import { jwtService } from '@/services/jwtService';
import { authV2Middleware } from '@/middleware/authV2Middleware';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';

const router = Router();

const pollRequestSchema = z.object({
  deviceCode: z.string().min(1, 'deviceCode is required'),
});

const statusRequestSchema = z.object({
  userCode: z.string().min(1, 'userCode is required'),
});

const approveRequestSchema = z.object({
  userCode: z.string().min(1, 'userCode is required'),
  approved: z.boolean(),
  workspaceId: z.string().optional(), // Optional: user can select workspace
});

/** Name of the per-workspace session cookie `authMiddleware` reads. */
const sessionCookieName = (workspaceId: string): string => `xyne_ws_${workspaceId}_token`;

/**
 * GET /api/sdk/auth/sso/consent
 * Redirects to the dashboard consent page, which handles login and consent.
 */
router.get('/consent', (req: Request, res: Response) => {
  const userCode = req.query.user_code;

  if (typeof userCode !== 'string' || !userCode) {
    return res.status(400).json({
      error: 'invalid_request',
      message: 'user_code is required',
    });
  }

  return res.redirect(
    `${config.frontendUrl}/sdk-sso/authorize?user_code=${encodeURIComponent(userCode)}`
  );
});

/**
 * POST /api/sdk/auth/sso/init
 * Initiate the device authorization flow.
 * No authentication required - this is called by the SDK before user logs in.
 */
router.post('/init', async (_req: Request, res: Response) => {
  try {
    // The consent URL is served by the backend, so it is built on backendUrl
    const result = await sdkSsoService.initiateDeviceFlow(config.backendUrl);

    return res.status(200).json({
      device_code: result.deviceCode,
      user_code: result.userCode,
      verification_url: result.verificationUrl,
      verification_url_complete: result.verificationUrlComplete,
      expires_in: result.expiresIn,
      interval: result.interval,
    });
  } catch (error) {
    logger.error('[SDK-SSO] Error initiating device flow:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to initiate device flow',
    });
  }
});

/**
 * POST /api/sdk/auth/sso/poll
 * Poll for the authorization result.
 * No authentication required - SDK polls with the device_code.
 */
router.post('/poll', async (req: Request, res: Response) => {
  try {
    const { deviceCode } = pollRequestSchema.parse(req.body);

    const result = await sdkSsoService.pollForAuthorization(deviceCode);

    switch (result.status) {
      case 'pending':
        // RFC 8628: Return 400 with authorization_pending error
        return res.status(400).json({
          error: 'authorization_pending',
          message: 'The authorization request is still pending.',
        });

      case 'approved': {
        const session = result.session;
        if (!session) {
          logger.error('[SDK-SSO] Approved request has no session');
          return res.status(500).json({
            error: 'server_error',
            message: 'Failed to check authorization status',
          });
        }

        // Set the same session cookies login sets, so a browser client is
        // signed in without handling the token itself.
        const cookieOptions = {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax' as const,
          path: '/',
        };
        const cookieName = sessionCookieName(session.workspaceId);
        res.cookie(cookieName, session.token, {
          ...cookieOptions,
          expires: new Date(session.expiresAt),
        });
        res.cookie('xyne_last_workspace', session.workspaceId, {
          ...cookieOptions,
          maxAge: config.session.expiryDays * 24 * 60 * 60 * 1000,
        });

        return res.status(200).json({
          status: 'approved',
          cookie: { name: cookieName, value: session.token },
          expires_at: session.expiresAt,
          user_id: session.userId,
          workspace_id: session.workspaceId,
        });
      }

      case 'denied':
        return res.status(400).json({
          error: 'access_denied',
          message: 'The user denied the authorization request.',
        });

      case 'expired':
        return res.status(400).json({
          error: 'expired_token',
          message: 'The device code has expired. Please start a new authorization flow.',
        });

      default:
        return res.status(400).json({
          error: 'invalid_request',
          message: 'Unknown authorization status.',
        });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'invalid_request',
        message: error.errors[0].message,
      });
    }
    logger.error('[SDK-SSO] Error polling for authorization:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to check authorization status',
    });
  }
});

/**
 * GET /api/sdk/auth/sso/status
 * Get the status of a device authorization request.
 * Requires user session - used by the consent page to display request info.
 */
router.get('/status', authV2Middleware.authenticate, async (req: Request, res: Response) => {
  try {
    const { userCode } = statusRequestSchema.parse(req.query);

    const authRequest = await sdkSsoService.getDeviceAuthByUserCode(userCode);

    if (!authRequest) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Authorization request not found or expired.',
      });
    }

    return res.status(200).json({
      status: authRequest.status,
      user_code: authRequest.userCode,
      created_at: authRequest.createdAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'invalid_request',
        message: error.errors[0].message,
      });
    }
    logger.error('[SDK-SSO] Error getting authorization status:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to get authorization status',
    });
  }
});

/**
 * POST /api/sdk/auth/sso/approve
 * Approve or deny the authorization request.
 * Requires user session - called by the consent page after user decision.
 */
router.post('/approve', authV2Middleware.authenticate, async (req: Request, res: Response) => {
  try {
    const { userCode, approved, workspaceId } = approveRequestSchema.parse(req.body);
    const user = req.user!;

    const authRequest = await sdkSsoService.getDeviceAuthByUserCode(userCode);
    if (!authRequest) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Authorization request not found or expired.',
      });
    }

    if (authRequest.status !== 'pending') {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'Authorization request has already been processed.',
      });
    }

    let session = null;

    if (approved) {
      // A User row is scoped to one workspace. The session's own row by
      // default; for another workspace, the caller's row in that workspace.
      const targetUser = await db.user.findFirst({
        where:
          workspaceId && workspaceId !== user.workspaceId
            ? { orgMemberId: user.memberId, workspaceId }
            : { id: user.id },
        select: {
          id: true,
          email: true,
          name: true,
          picture: true,
          workspaceId: true,
          orgMemberId: true,
        },
      });

      if (!targetUser?.workspaceId) {
        return res.status(403).json({
          error: 'access_denied',
          message: 'You do not have access to the selected workspace.',
        });
      }

      // The same session JWT login issues, so `authMiddleware` accepts it
      const token = jwtService.generateToken({
        sub: targetUser.id,
        email: targetUser.email,
        name: targetUser.name,
        picture: targetUser.picture || undefined,
        workspaceId: targetUser.workspaceId,
        memberId: targetUser.orgMemberId,
      });
      const exp = jwtService.decodeToken(token)?.exp;

      session = {
        userId: targetUser.id,
        workspaceId: targetUser.workspaceId,
        token,
        expiresAt: exp ? exp * 1000 : Date.now() + config.jwt.expirationSeconds * 1000,
      };
    }

    const success = await sdkSsoService.approveOrDeny(userCode, session);

    if (!success) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'Failed to process authorization request.',
      });
    }

    return res.status(200).json({
      success: true,
      status: approved ? 'approved' : 'denied',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'invalid_request',
        message: error.errors[0].message,
      });
    }
    logger.error('[SDK-SSO] Error processing authorization:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to process authorization',
    });
  }
});

export default router;
