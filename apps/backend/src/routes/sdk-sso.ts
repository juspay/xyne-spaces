/**
 * SDK SSO Routes - Device flow endpoints for SDK authentication.
 *
 * Endpoints:
 * - POST /api/sdk/auth/sso/init     - Initiate device flow (no auth required)
 * - POST /api/sdk/auth/sso/poll     - Poll for authorization result (no auth required)
 * - GET  /api/sdk/auth/sso/consent  - Consent page (redirects to login if needed)
 * - GET  /api/sdk/auth/sso/status   - Get device auth status by user_code (session auth)
 * - POST /api/sdk/auth/sso/approve  - Approve/deny authorization (session auth)
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sdkSsoService } from '@/services/sdkSsoService';
import { sdkJwtService, SDK_TOKEN_TTL_CHOICES, type SdkTokenTtlDays } from '@/services/sdkJwtService';
import { authV2Middleware } from '@/middleware/authV2Middleware';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';

const router = Router();

// Request validation schemas
const initRequestSchema = z.object({
  ttlDays: z.enum(['1']).optional().default('1'),
});

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

/**
 * GET /api/sdk/auth/sso/consent
 * Redirects to frontend consent page.
 * The frontend handles authentication and displays the consent UI.
 */
router.get('/consent', async (req: Request, res: Response) => {
  const userCode = req.query.user_code as string | undefined;

  if (!userCode) {
    return res.status(400).json({
      error: 'invalid_request',
      message: 'user_code is required',
    });
  }

  // Redirect to frontend consent page with the user_code
  const frontendConsentUrl = `${config.frontendUrl}/sdk-sso/authorize?user_code=${userCode}`;
  return res.redirect(frontendConsentUrl);
});

/**
 * POST /api/sdk/auth/sso/init
 * Initiate the device authorization flow.
 * No authentication required - this is called by the SDK before user logs in.
 */
router.post('/init', async (req: Request, res: Response) => {
  try {
    const { ttlDays } = initRequestSchema.parse(req.body);
    const ttlDaysNum = parseInt(ttlDays, 10) as SdkTokenTtlDays;

    if (!SDK_TOKEN_TTL_CHOICES.includes(ttlDaysNum)) {
      return res.status(400).json({
        error: 'invalid_request',
        message: `ttlDays must be one of: ${SDK_TOKEN_TTL_CHOICES.join(', ')}`,
      });
    }

    // Use backendUrl since the consent page is served by the backend
    const result = await sdkSsoService.initiateDeviceFlow(
      config.backendUrl,
      ttlDaysNum
    );

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

      case 'approved':
        // Set JWT as a cookie for browser-based clients
        if (result.jwt && result.expiresAt) {
          res.cookie('xyne_sdk_token', result.jwt, {
            httpOnly: true,
            secure: config.env === 'production',
            sameSite: 'lax',
            expires: new Date(result.expiresAt),
            path: '/',
          });
        }
        return res.status(200).json({
          status: 'approved',
          access_token: result.jwt,
          token_type: 'Bearer',
          expires_at: result.expiresAt,
        });

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
      ttl_days: authRequest.ttlDays,
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

    // If a specific workspace is requested, verify the user has access
    let targetWorkspaceId = workspaceId || user.workspaceId;
    let targetUserId = user.id;
    let targetMemberId = user.memberId;

    if (workspaceId && workspaceId !== user.workspaceId) {
      // User selected a different workspace - need to look up their User record for that workspace
      const targetUser = await db.user.findFirst({
        where: {
          orgMemberId: user.memberId,
          workspaceId: workspaceId,
        },
        select: {
          id: true,
          workspaceId: true,
          orgMemberId: true,
        },
      });

      if (!targetUser) {
        return res.status(403).json({
          error: 'access_denied',
          message: 'You do not have access to the selected workspace.',
        });
      }

      targetWorkspaceId = targetUser.workspaceId;
      targetUserId = targetUser.id;
      targetMemberId = targetUser.orgMemberId;
    }

    // Get the auth request to retrieve ttlDays
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

    let jwt: string | undefined;
    let jwtExpiresAt: number | undefined;
    let orgId: string | undefined;

    if (approved) {
      // Fetch orgId from orgMember (not on session principal)
      const orgMember = await db.orgMember.findUnique({
        where: { memberId: targetMemberId },
        select: { orgId: true },
      });

      if (!orgMember) {
        logger.error('[SDK-SSO] No org membership for caller', {
          memberId: targetMemberId,
          userId: targetUserId,
        });
        return res.status(400).json({
          error: 'invalid_request',
          message: 'Could not find organization membership.',
        });
      }

      orgId = orgMember.orgId;

      // Generate SDK JWT
      const { token, expiresAt } = sdkJwtService.generateToken(
        {
          userId: targetUserId,
          email: user.email,
          name: user.name,
          displayName: user.displayName ?? undefined,
          workspaceId: targetWorkspaceId,
          orgId,
          memberId: targetMemberId,
        },
        authRequest.ttlDays
      );
      jwt = token;
      jwtExpiresAt = expiresAt;
    }

    const success = await sdkSsoService.approveOrDeny(
      userCode,
      approved,
      approved && orgId ? {
        userId: targetUserId,
        email: user.email,
        name: user.name,
        displayName: user.displayName ?? undefined,
        workspaceId: targetWorkspaceId,
        orgId,
        memberId: targetMemberId,
      } : undefined,
      jwt,
      jwtExpiresAt
    );

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
