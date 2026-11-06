import crypto from 'crypto';
import { AuthProvider } from '@xyne/shared';
import { signPendingAuthToken } from '@/utils/pendingAuthToken';
import { Request, Response } from 'express';
import { authSessionService, AuthSessionRevokeReason } from '../services/authSessionService';
import { completeLogin, respondDeviceKeyRequired } from '../services/loginCompletionService';
import { UserService } from '../services/userService';
import {
  hashPassword,
  validatePasswordComplexity,
  generateSixDigitCode,
  verifyEmailPassword,
  DUMMY_PASSWORD_HASH,
} from '../utils/passwordUtils';
import { DatabaseClient } from '@/database/client';
import { config } from '@/config/env';
import { emailService } from '@/services/email/factory';
import { redisService } from '@/services/redisService';
import { setPasswordHash, getPasswordHash } from '@/services/orgMemberCredentialService';
import '../types/express';
import { migrateLegacyIdentity } from '@/services/legacyIdentityMigrationHelper';
import { logger } from '@/utils/logger';
import { PENDING_AUTH_COOKIE } from '@/services/accessTokenService';

const authTag = (flowId: string): string => `[AUTH][flow=${flowId}]`;
const workspaceOutcome = (count: number): string =>
  count === 0 ? 'no_workspace' : count === 1 ? 'single_workspace' : 'multi_workspace';

interface ResetCodePayload {
  code: string;
}

const LOGIN_MAX_FAILED_ATTEMPTS = 5;
const LOGIN_LOCKOUT_SECONDS = 5 * 60;
const LOGIN_FAILED_ATTEMPT_WINDOW_SECONDS = 5 * 60;
const PASSWORD_RESET_REQUEST_MESSAGE = 'If an account exists, a reset code has been sent.';
const MAX_RESET_CODE_ATTEMPTS = 3;
const MAX_RESET_CODES_PER_DAY = 5;

const resetCodeMatches = (expected: string, presented: unknown): boolean => {
  if (typeof presented !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export class EmailAuthController {
  private userService: UserService;
  private prisma = DatabaseClient.getInstance();

  constructor() {
    this.userService = new UserService();
  }

  /**
   * Login with email + password
   * POST /v2/auth/email/login
   *
   * Verifies against the member's stored password hash. On success creates a session,
   * issues JWT + cookies, and returns workspace info identical to OAuth flow.
   */
  login = async (req: Request, res: Response): Promise<void> => {
    const flowId = crypto.randomUUID();
    const tag = (): string => authTag(flowId);

    try {
      logger.info(`${tag()} Email login received`);

      const { email, password, invitationId } = req.body;

      if (!email || !password) {
        logger.warn(`${tag()} Email login rejected (reason=missing_credentials)`);
        res.status(400).json({
          error: 'Missing credentials',
          message: 'email and password are required',
        });
        return;
      }

      if (password.length > 128) {
        logger.warn(`${tag()} Email login rejected (reason=password_too_long)`);
        res.status(400).json({
          error: 'Invalid credentials',
          message: 'Password must be 128 characters or fewer',
        });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();
      const loginLockKey = `emaillogin:lock:${normalizedEmail}`;
      const loginAttemptKey = `emaillogin:attempts:${normalizedEmail}`;

      const existingLock = await redisService.get(loginLockKey);
      if (existingLock) {
        const retryAfterSeconds = Math.max(await redisService.getClient().ttl(loginLockKey), 0);
        if (retryAfterSeconds > 0) {
          res.setHeader('Retry-After', retryAfterSeconds.toString());
        }

        logger.warn(`${tag()} Email login rejected (reason=rate_limited)`);
        res.status(429).json({
          error: 'Rate limited',
          message: 'Too many failed login attempts. Please try again later.',
        });
        return;
      }

      const lockOut = async (): Promise<void> => {
        await redisService.set(loginLockKey, '1', LOGIN_LOCKOUT_SECONDS);
        logger.warn(`${tag()} Email login rejected (reason=rate_limited)`);
        res.setHeader('Retry-After', LOGIN_LOCKOUT_SECONDS.toString());
        res.status(429).json({
          error: 'Rate limited',
          message: 'Too many failed login attempts. Please try again later.',
        });
      };

      // Count the attempt before checking the password: INCR is atomic, so a burst of
      // concurrent guesses can't all pass the lock check above before the counter moves.
      // A successful login clears it below.
      const redis = redisService.getClient();
      const attempts = await redis.incr(loginAttemptKey);
      if (attempts === 1) {
        await redis.expire(loginAttemptKey, LOGIN_FAILED_ATTEMPT_WINDOW_SECONDS);
      }
      if (attempts > LOGIN_MAX_FAILED_ATTEMPTS) {
        await lockOut();
        return;
      }

      // Every failed attempt — unknown email, no password set, or wrong password —
      // ends here, so the attempt counter, the lockout and the response are identical
      // whichever it was, keeping registered and unregistered emails indistinguishable.
      const rejectLogin = async (): Promise<void> => {
        if (attempts >= LOGIN_MAX_FAILED_ATTEMPTS) {
          await lockOut();
          return;
        }

        logger.warn(`${tag()} Email login rejected (reason=invalid_credentials)`);
        res.status(401).json({
          error: 'Invalid credentials',
          message: 'Email or password is incorrect',
        });
      };

      // 1. Look up orgMember (the source of truth for email auth)
      const orgMember = await this.prisma.orgMember.findUnique({
        where: { email: normalizedEmail },
      });

      const storedHash = orgMember && !orgMember.leftAt ? await getPasswordHash(orgMember.memberId) : null;

      // 2. Verify the password. With no account (or no password on it) the check runs
      // against a dummy hash of the same form so the request takes as long as a real
      // wrong-password attempt, and the result is discarded.
      let isValid = false;
      if (storedHash) {
        isValid = await verifyEmailPassword(password, storedHash);
      } else {
        await verifyEmailPassword(password, DUMMY_PASSWORD_HASH);
      }

      if (!isValid || !orgMember) {
        await rejectLogin();
        return;
      }

      await migrateLegacyIdentity({
        email: normalizedEmail,
        authProvider: AuthProvider.EMAIL,
        providerUserId: `email-${normalizedEmail}`,
      });

      // SECURITY: if this email is already registered with an SSO provider
      // (Google/Microsoft), do not allow email+password login. Account linking is
      // intentionally unsupported (it enables account takeover) — mirrors the
      // provider-mismatch guard in the OAuth callbacks. This also blocks an SSO
      // user who set a password via the reset flow from bypassing SSO.
      const existingIdentity = await this.userService.findAuthIdentityByEmail(normalizedEmail);
      if (existingIdentity && existingIdentity.authProvider !== AuthProvider.EMAIL) {
        logger.warn(`${tag()} Email login rejected (reason=provider_mismatch, existingProvider=${existingIdentity.authProvider})`);
        res.status(403).json({
          error: 'provider_mismatch',
          message: 'This account uses a different login method. Please continue with your original sign-in method.',
          existingProvider: existingIdentity.authProvider,
        });
        return;
      }

      logger.info(`${tag()} Email auth success for: ${normalizedEmail}`);

      // Password is correct — immediately clear rate-limit state so a
      // subsequent network/DB failure doesn't leave the user locked out.
      await Promise.all([
        redisService.del(loginAttemptKey),
        redisService.del(loginLockKey),
      ]);

      // 3. Find user's active workspace(s)
      const workspaceUsers = await this.prisma.user.findMany({
        where: { orgMemberId: orgMember.memberId, leftAt: null },
        orderBy: { createdAt: 'desc' },
        include: { workspace: true },
      });
      logger.info(`${tag()} User has ${workspaceUsers.length} workspace(s) before invitation check`);

      // Invitation handling is keyed only by an explicit invitationId from the
      // auth URL. Regular email login should not be diverted by unrelated
      // pending invitations for the same email.
      const normalizedInvitationId = typeof invitationId === 'string'
        ? invitationId.trim()
        : '';
      const pendingInvitation = normalizedInvitationId
        ? await this.prisma.invitation.findFirst({
          where: {
            invitationId: normalizedInvitationId,
            email: normalizedEmail,
            acceptedAt: null,
            expiredAt: { gt: new Date() },
          },
        })
        : null;

      if (workspaceUsers.length === 0 && !pendingInvitation) {
        logger.warn(`${tag()} Email login rejected (reason=no_workspace_access)`);
        res.status(403).json({
          error: 'No workspace access',
          message: 'You do not have access to any workspace. Please contact your administrator.',
        });
        return;
      }

      // Cookie base (used below for both invitation-pending and normal flows)
      const isProduction = config.env === 'production';
      const cookieBase = {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict' as const,
        path: '/',
      };

      if (pendingInvitation) {
        // Invited user hasn't accepted yet — set pending auth cookie (mirrors OAuth flow)
        // and return a signal so the frontend redirects to the invite page.
        const userName = normalizedEmail.split('@')[0];

        res.cookie(
          PENDING_AUTH_COOKIE,
          signPendingAuthToken({
            email: normalizedEmail,
            name: userName,
            providerUserId: `email-${normalizedEmail}`,
            provider: 'EMAIL',
            refreshToken: null,
            accessToken: null,
          }),
          {
            ...cookieBase,
            maxAge: 10 * 60 * 1000, // 10 minutes pending auth window
          },
        );

        logger.info(`${tag()} Email login succeeded (outcome=pending_invitation, invitationId=${pendingInvitation.invitationId})`);
        res.status(200).json({
          success: true,
          invitationPending: true,
          invitationId: pendingInvitation.invitationId,
          pendingUserData: { email: normalizedEmail, name: userName },
          workspaces: [],
          userExistsButRemoved: false,
        });
        return;
      }

      const workspaceUser = workspaceUsers[0];
      const userName = workspaceUser.name || normalizedEmail.split('@')[0];

      res.cookie(
        PENDING_AUTH_COOKIE,
        signPendingAuthToken({
          email: normalizedEmail,
          name: userName,
          providerUserId: `email-${normalizedEmail}`,
          provider: 'EMAIL',
          refreshToken: null,
          accessToken: null,
        }),
        {
          ...cookieBase,
          maxAge: 10 * 60 * 1000, // 10 minutes pending auth window
        },
      );

      // Build workspaces array for frontend auth machine
      const workspaces = workspaceUsers.map(u => ({
        id: u.workspaceId,
        name: u.workspace?.name || u.workspaceId,
        role: u.role,
      }));

      if (workspaceUsers.length === 1) {
        // Auth session (xs) + JWT cookies. The user row may still say GOOGLE/MICROSOFT for an
        // SSO account that set a password, so the method is pinned to EMAIL.
        await completeLogin(req, res, {
          user: workspaceUser,
          loginMethod: AuthProvider.EMAIL,
          cookieOptions: { sameSite: cookieBase.sameSite, secure: cookieBase.secure },
        });

        logger.info(`${tag()} Email login succeeded (outcome=single_workspace, count=1)`);
        res.status(200).json({
          success: true,
          workspaces,
          pendingUserData: { email: normalizedEmail, name: userName },
          userExistsButRemoved: false,
          autoLoginWorkspace: workspaceUser.workspaceId,
        });
        return;
      }

      logger.info(`${tag()} Email login succeeded (outcome=${workspaceOutcome(workspaceUsers.length)}, count=${workspaceUsers.length})`);
      res.status(200).json({
        success: true,
        workspaces,
        pendingUserData: { email: normalizedEmail, name: userName },
        userExistsButRemoved: false,
      });
    } catch (error) {
      if (respondDeviceKeyRequired(res, error)) return;
      logger.error(`${tag()} Email login failed:`, error);
      res.status(500).json({
        error: 'Login failed',
        message: `An unexpected error occurred during login. Error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };

  /**
   * Change password
   * POST /v2/auth/email/change-password
   * Requires authentication (req.user must be set)
   */
  changePassword = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: 'Current password and new password are required' });
        return;
      }

      const passwordValidationError = validatePasswordComplexity(newPassword);
      if (passwordValidationError) {
        res.status(400).json({ error: passwordValidationError });
        return;
      }

      // Get user's orgMember
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { orgMemberId: true, email: true },
      });

      if (!user?.orgMemberId) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const orgMember = await this.prisma.orgMember.findUnique({
        where: { memberId: user.orgMemberId },
      });

      const currentHash = orgMember ? await getPasswordHash(orgMember.memberId) : null;
      if (!orgMember || !currentHash) {
        res.status(400).json({ error: 'Password not set. Please use forgot password to set password.' });
        return;
      }

      // Verify current password
      const isValid = await verifyEmailPassword(currentPassword, currentHash);
      if (!isValid) {
        res.status(401).json({ error: 'Current password is incorrect' });
        return;
      }

      // Ensure new password is not the same as old
      const isSameAsOld = await verifyEmailPassword(newPassword, currentHash);
      if (isSameAsOld) {
        res.status(400).json({
          error: 'New password must be different from your current password',
          message: 'New password must be different from your current password',
        });
        return;
      }

      // Hash and store new password
      const newHash = await hashPassword(newPassword);
      await setPasswordHash({ memberId: orgMember.memberId, orgId: orgMember.orgId, passwordHash: newHash });

      // Revoke every device's auth session for this org member — forces re-auth everywhere
      await authSessionService.revokeAllForOrgMember(orgMember.memberId, AuthSessionRevokeReason.PASSWORD_CHANGED);

      res.status(200).json({ success: true, message: 'Password changed successfully. Please log in again.' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to change password' });
    }
  };

  /**
   * Request a password reset code
   * POST /v2/auth/email/forgot-password
   * Public endpoint — sends 6-digit code to email
   */
  requestResetCode = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email } = req.body;
      if (!email || typeof email !== 'string') {
        res.status(400).json({ error: 'Email is required' });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();

      // Rate-limit before account lookup so the public response stays uniform.
      const rateLimitKey = `pwdreset:ratelimit:${normalizedEmail}`;
      const rateLimited = await redisService.get(rateLimitKey);
      if (rateLimited) {
        res.status(200).json({ success: true, message: PASSWORD_RESET_REQUEST_MESSAGE });
        return;
      }

      // Find orgMember
      const orgMember = await this.prisma.orgMember.findUnique({
        where: { email: normalizedEmail },
      });

      if (!orgMember || orgMember.leftAt) {
        res.status(200).json({ success: true, message: PASSWORD_RESET_REQUEST_MESSAGE });
        return;
      }

      // Each new code resets the attempt counter, so cap how many codes an account gets per day.
      const dailyKey = `pwdreset:daily:${normalizedEmail}`;
      const redis = redisService.getClient();
      const codesToday = await redis.incr(dailyKey);
      if (codesToday === 1) {
        await redis.expire(dailyKey, 24 * 60 * 60);
      }
      if (codesToday > MAX_RESET_CODES_PER_DAY) {
        logger.warn('[AUTH] Password reset code request rejected (reason=daily_cap)');
        res.status(200).json({ success: true, message: PASSWORD_RESET_REQUEST_MESSAGE });
        return;
      }

      // Generate 6-digit code
      const code = generateSixDigitCode();
      const attemptsKey = `pwdreset:attempts:${normalizedEmail}`;
      // Store in Redis with 15-min TTL, plus rate-limit flag (60 sec TTL)
      const payload: ResetCodePayload = { code };
      await Promise.all([
        redisService.set(
          `pwdreset:code:${normalizedEmail}`,
          JSON.stringify(payload),
          15 * 60, // 15 minutes
        ),
        redisService.del(attemptsKey),
        redisService.set(rateLimitKey, '1', 60), // 60-second rate limit
      ]);

      // Send email via existing SMTP
      const emailResult = await emailService.sendEmail({
        to: normalizedEmail,
        subject: 'Xyne Spaces Password Reset Code',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
            <h2>Password Reset</h2>
            <p>You requested a password reset for your Xyne Spaces account.</p>
            <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px; padding: 16px; background: #f5f5f5; border-radius: 8px; text-align: center;">${code}</p>
            <p>This code expires in 15 minutes.</p>
            <p>If you didn't request this, ignore this email.</p>
          </div>
        `,
        text: `Your Xyne Spaces password reset code is: ${code}\n\nThis code expires in 15 minutes.\n`,
      });

      if (!emailResult.success) {
        // Clean up the code since email failed
        await Promise.all([
          redisService.del(`pwdreset:code:${normalizedEmail}`),
          redisService.del(attemptsKey),
          redisService.del(rateLimitKey),
        ]);
        res.status(500).json({ error: 'Failed to send reset email. Please try again.' });
        return;
      }

      res.status(200).json({ success: true, message: PASSWORD_RESET_REQUEST_MESSAGE });
    } catch (error) {
      res.status(500).json({ error: 'An unexpected error occurred' });
    }
  };

  /**
   * Reset password with code
   * POST /v2/auth/email/reset-password
   * Public endpoint — verifies code and updates password
   */
  resetPassword = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, code, newPassword } = req.body;

      if (!email || !code || !newPassword) {
        res.status(400).json({ error: 'Email, code, and new password are required' });
        return;
      }

      const passwordValidationError = validatePasswordComplexity(newPassword);
      if (passwordValidationError) {
        res.status(400).json({ error: passwordValidationError });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();
      const redisKey = `pwdreset:code:${normalizedEmail}`;
      const attemptsKey = `pwdreset:attempts:${normalizedEmail}`;

      // Count the attempt before reading the code: INCR is atomic, so concurrent guesses can't
      // all compare before the cap applies. The counter is left to expire on exhaustion (not
      // deleted), or in-flight requests would start a fresh count.
      const redis = redisService.getClient();
      const attempts = await redis.incr(attemptsKey);
      if (attempts === 1) {
        await redis.expire(attemptsKey, 15 * 60);
      }
      if (attempts > MAX_RESET_CODE_ATTEMPTS) {
        await redisService.del(redisKey);
        res.status(400).json({ error: 'Too many failed attempts. Please request a new code.' });
        return;
      }

      const raw = await redisService.get(redisKey);
      if (!raw) {
        res.status(400).json({ error: 'Invalid or expired code' });
        return;
      }

      let payload: ResetCodePayload;
      try {
        payload = JSON.parse(raw) as ResetCodePayload;
      } catch {
        res.status(400).json({ error: 'Invalid or expired code' });
        return;
      }

      if (!resetCodeMatches(payload.code, code)) {
        if (attempts >= MAX_RESET_CODE_ATTEMPTS) {
          await redisService.del(redisKey);
          res.status(400).json({ error: 'Too many failed attempts. Please request a new code.' });
          return;
        }

        res.status(400).json({ error: 'Invalid code' });
        return;
      }

      // Get orgMember
      const orgMember = await this.prisma.orgMember.findUnique({
        where: { email: normalizedEmail },
      });

      if (!orgMember || orgMember.leftAt) {
        res.status(400).json({ error: 'Account not found' });
        return;
      }

      const existingHash = await getPasswordHash(orgMember.memberId);
      if (existingHash) {
        // Ensure new password is not the same as old when a password already exists.
        const isSameAsOld = await verifyEmailPassword(newPassword, existingHash);
        if (isSameAsOld) {
          res.status(400).json({
            error: 'New password must be different from your current password',
            message: 'New password must be different from your current password',
          });
          return;
        }
      }

      // Update password
      const newHash = await hashPassword(newPassword);
      await setPasswordHash({ memberId: orgMember.memberId, orgId: orgMember.orgId, passwordHash: newHash });

      // Auth sessions are org-level: one revoke covers every workspace and device.
      await authSessionService.revokeAllForOrgMember(orgMember.memberId, AuthSessionRevokeReason.PASSWORD_RESET);

      // Delete the code from Redis (it's been consumed)
      await Promise.all([
        redisService.del(redisKey),
        redisService.del(attemptsKey),
      ]);

      res.status(200).json({ success: true, message: 'Password reset successful. You can now log in.' });
    } catch (error) {
      res.status(500).json({ error: 'An unexpected error occurred' });
    }
  };
}

export const emailAuthController = new EmailAuthController();
