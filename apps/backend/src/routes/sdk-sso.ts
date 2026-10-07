/**
 * SDK SSO Routes - Device flow endpoints for SDK authentication.
 *
 * On approval an SDK `auth_sessions` row is issued for the approving user's
 * account (no cookies are written) and a workspace JWT bound to it (`sid`) is
 * handed to the SDK under the access cookie name `xw_<workspaceId>`, which
 * `/api/sdk` accepts (Bearer, that cookie, or the legacy `xyne_ws_<ws>_token`
 * name for older SDK builds). The token is returned in the poll body only, so a
 * poll made from the Spaces origin never disturbs the dashboard's own cookies.
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
import { UserStatus } from '@xyne/shared';
import { sdkSsoService } from '@/services/sdkSsoService';
import { authV2Middleware } from '@/middleware/authV2Middleware';
import { sdkSsoInitLimiter, sdkSsoPollLimiter } from '@/middleware/rateLimiters';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { issueSession, mintWorkspaceJwt } from '@/auth/sessionIssuer';
import { accessCookieName } from '@/auth/constants';
import { recordTokenMinted } from '@/services/otel/authMetrics';

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
});

/** Per-workspace access cookie name (`xw_<workspaceId>`) the SDK presents the token under. */
const sessionCookieName = (workspaceId: string): string => accessCookieName(workspaceId);

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
router.post('/init', sdkSsoInitLimiter, async (req: Request, res: Response) => {
  try {
    // The consent URL is served by the backend, so it is built on backendUrl.
    // Where the request came from is shown on the consent page, so the person
    // approving can tell a request of their own from one sent to them.
    const result = await sdkSsoService.initiateDeviceFlow(config.backendUrl, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

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
router.post('/poll', sdkSsoPollLimiter, async (req: Request, res: Response) => {
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

        return res.status(200).json({
          status: 'approved',
          cookie: { name: sessionCookieName(session.workspaceId), value: session.token },
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
      requested_from: {
        ip: authRequest.origin?.ip ?? null,
        user_agent: authRequest.origin?.userAgent ?? null,
      },
      // How long an approved session lasts, so the consent page need not guess
      session_expires_in: config.sdkSso.tokenTtlSeconds,
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
    const { userCode, approved } = approveRequestSchema.parse(req.body);
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
      // The approving user's own row, in the workspace they are signed in
      // to. Re-read so a user who has left or been deactivated is refused
      // here, rather than issued a session `authMiddleware` would reject.
      const targetUser = await db.user.findFirst({
        where: { id: user.id, leftAt: null, status: UserStatus.ACTIVE },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          workspaceId: true,
          orgMemberId: true,
          orgMember: { select: { orgId: true, role: true, leftAt: true } },
        },
      });

      if (!targetUser?.workspaceId || !targetUser.orgMember || targetUser.orgMember.leftAt) {
        return res.status(403).json({
          error: 'access_denied',
          message: 'Your account is not active in this workspace.',
        });
      }

      // A dedicated SDK session row for the account (no cookies written: the SDK has no jar)
      // and a workspace JWT bound to it, both living SDK_SSO_TOKEN_TTL_SECONDS. Revoking the
      // row (logout-everywhere, password reset) invalidates the token immediately.
      const ttlSeconds = config.sdkSso.tokenTtlSeconds;
      const absoluteExpiry = new Date(Date.now() + ttlSeconds * 1000);
      const issued = await issueSession({
        accountId: targetUser.orgMemberId,
        orgId: targetUser.orgMember.orgId,
        platform: 'SDK',
        req,
        absoluteExpiry,
      });
      const token = mintWorkspaceJwt({
        user: targetUser,
        memberId: targetUser.orgMemberId,
        workspaceId: targetUser.workspaceId,
        sid: issued.session.id,
        orgId: targetUser.orgMember.orgId,
        orgRole: targetUser.orgMember.role,
        platform: 'SDK',
        expiresInSeconds: ttlSeconds,
      });
      recordTokenMinted({ audience: 'sdk' });

      session = {
        userId: targetUser.id,
        workspaceId: targetUser.workspaceId,
        token,
        expiresAt: absoluteExpiry.getTime(),
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
