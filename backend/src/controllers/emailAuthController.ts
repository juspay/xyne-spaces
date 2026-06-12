import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
import { UserSessionService } from '../services/userSessionService';
import { jwtService } from '../services/jwtService';
import {
  verifyPassword,
  hashPassword,
  validatePasswordComplexity,
} from '../utils/passwordUtils';
import { DatabaseClient } from '@/database/client';
import { emailService } from '@/services/email/factory';
import { redisService } from '@/services/redisService';
import '../types/express';

interface ResetCodePayload {
  code: string;
}

const LOGIN_MAX_FAILED_ATTEMPTS = 5;
const LOGIN_LOCKOUT_SECONDS = 5 * 60;
const LOGIN_FAILED_ATTEMPT_WINDOW_SECONDS = 5 * 60;
const PASSWORD_RESET_REQUEST_MESSAGE = 'If an account exists, a reset code has been sent.';

export class EmailAuthController {
  private userSessionService: UserSessionService;
  private prisma = DatabaseClient.getInstance();

  constructor() {
    this.userSessionService = new UserSessionService();
  }

  /**
   * Login with email + password
   * POST /v2/auth/email/login
   *
   * Verifies against orgMember.passwordHash. On success creates a session,
   * issues JWT + cookies, and returns workspace info identical to OAuth flow.
   */
  login = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password, invitationId } = req.body;

      if (!email || !password) {
        res.status(400).json({
          error: 'Missing credentials',
          message: 'email and password are required',
        });
        return;
      }

      if (password.length > 128) {
        res.status(400).json({
          error: 'Invalid credentials',
          message: 'Password must be 128 characters or fewer',
        });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();
      const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
      const loginLockKey = `emaillogin:lock:ip:${clientIp}:${normalizedEmail}`;
      const loginAttemptKey = `emaillogin:attempts:ip:${clientIp}:${normalizedEmail}`;

      const existingLock = await redisService.get(loginLockKey);
      if (existingLock) {
        const retryAfterSeconds = Math.max(await redisService.getClient().ttl(loginLockKey), 0);
        if (retryAfterSeconds > 0) {
          res.setHeader('Retry-After', retryAfterSeconds.toString());
        }

        res.status(429).json({
          error: 'Rate limited',
          message: 'Too many failed login attempts. Please try again later.',
        });
        return;
      }

      // 1. Look up orgMember (the source of truth for email auth)
      const orgMember = await this.prisma.orgMember.findUnique({
        where: { email: normalizedEmail },
      });

      if (!orgMember || orgMember.leftAt) {
        res.status(401).json({
          error: 'Invalid credentials',
          message: 'User is not a member of org',
        });
        return;
      }

      if (!orgMember.passwordHash) {
        // EMAIL user who was invited but password isn't set yet
        res.status(403).json({
          error: 'Password not set',
          message: 'Please use forgot password to set your password.',
        });
        return;
      }

      // 2. Verify password against orgMember.passwordHash
      const isValid = await verifyPassword(password, orgMember.passwordHash);
      if (!isValid) {
        const redis = redisService.getClient();
        const failedAttempts = await redis.incr(loginAttemptKey);
        if (failedAttempts === 1) {
          await redis.expire(loginAttemptKey, LOGIN_FAILED_ATTEMPT_WINDOW_SECONDS);
        }

        if (failedAttempts >= LOGIN_MAX_FAILED_ATTEMPTS) {
          await Promise.all([
            redisService.set(loginLockKey, '1', LOGIN_LOCKOUT_SECONDS),
            redisService.del(loginAttemptKey),
          ]);
          res.setHeader('Retry-After', LOGIN_LOCKOUT_SECONDS.toString());
          res.status(429).json({
            error: 'Rate limited',
            message: 'Too many failed login attempts. Please try again later.',
          });
          return;
        }

        res.status(401).json({
          error: 'Invalid credentials',
          message: 'Email or password is incorrect',
        });
        return;
      }

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
        res.status(403).json({
          error: 'No workspace access',
          message: 'You do not have access to any workspace. Please contact your administrator.',
        });
        return;
      }

      // Cookie base (used below for both invitation-pending and normal flows)
      const isProduction = process.env.NODE_ENV === 'production';
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
        const pendingAuthJwtId = crypto.randomUUID();

        // Store the pending-auth token ID in Redis with 10-minute TTL.
        // acceptInvitation will verify this entry exists before proceeding.
        await redisService.set(
          `pendingauth:jwtid:${pendingAuthJwtId}`,
          normalizedEmail,
          10 * 60, // 10 minutes
        );

        res.cookie(
          'google_access_token',
          jwt.sign(
            {
              email: normalizedEmail,
              name: userName,
              providerUserId: `email-${normalizedEmail}`,
              provider: 'EMAIL',
              refreshToken: null,
              accessToken: null,
              jwtId: pendingAuthJwtId,
            },
            process.env.JWT_SECRET!,
            { expiresIn: '10m' },
          ),
          {
            ...cookieBase,
            maxAge: 10 * 60 * 1000, // 10 minutes pending auth window
          },
        );

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

      // 5. Create session
      const refreshToken = crypto.randomUUID();
      const refreshTokenExpiry = new Date();
      refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 30);

      const session = await this.userSessionService.createSession({
        userId: workspaceUser.id,
        refreshToken,
        refreshTokenExpiry,
        deviceInfo: JSON.stringify({
          userAgent: req.headers['user-agent'],
          timestamp: new Date().toISOString(),
        }),
        ipAddress: req.ip || req.connection.remoteAddress || undefined,
      });

      // 6. Generate JWT
      const jwtToken = jwtService.generateToken({
        sub: workspaceUser.id,
        email: workspaceUser.email,
        name: workspaceUser.name,
        workspaceId: workspaceUser.workspaceId,
        memberId: workspaceUser.orgMemberId,
      });

      res.cookie('google_access_token', jwtToken, {
        ...cookieBase,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });

      res.cookie(`xyne_ws_${workspaceUser.workspaceId}_token`, jwtToken, {
        ...cookieBase,
        maxAge: 24 * 60 * 60 * 1000,
      });

      res.cookie('user_session_id', session.id, {
        ...cookieBase,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      res.cookie('xyne_last_workspace', workspaceUser.workspaceId, {
        ...cookieBase,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      // Build workspaces array for frontend auth machine
      const workspaces = workspaceUsers.map(u => ({
        id: u.workspaceId,
        name: u.workspace?.name || u.workspaceId,
        role: u.role,
      }));

      // 8. Success response — shape matches what useAuth.signInWithEmail expects
      res.status(200).json({
        success: true,
        user: {
          id: workspaceUser.id,
          email: workspaceUser.email,
          name: workspaceUser.name,
          workspaceId: workspaceUser.workspaceId,
          role: workspaceUser.role,
          orgRole: orgMember.role,
          memberId: orgMember.memberId,
          authProvider: 'EMAIL',
        },
        workspaces,
        pendingUserData: {
          email: workspaceUser.email,
          name: workspaceUser.name,
        },
        userExistsButRemoved: false,
      });
    } catch (error) {
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

      if (!orgMember || !orgMember.passwordHash) {
        res.status(400).json({ error: 'Password not set. Please use forgot password to set password.' });
        return;
      }

      // Verify current password
      const isValid = await verifyPassword(currentPassword, orgMember.passwordHash);
      if (!isValid) {
        res.status(401).json({ error: 'Current password is incorrect' });
        return;
      }

      // Ensure new password is not the same as old
      const isSameAsOld = await verifyPassword(newPassword, orgMember.passwordHash);
      if (isSameAsOld) {
        res.status(400).json({
          error: 'New password must be different from your current password',
          message: 'New password must be different from your current password',
        });
        return;
      }

      // Hash and store new password
      const newHash = await hashPassword(newPassword);
      await this.prisma.orgMember.update({
        where: { memberId: orgMember.memberId },
        data: { passwordHash: newHash },
      });

      // Revoke all active sessions for this user — forces re-auth everywhere
      await this.userSessionService.revokeAllUserSessions(userId);

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

      // Generate 6-digit code
      const code = crypto.randomInt(100000, 1000000).toString().padStart(6, '0')
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

      // Retrieve and verify code from Redis
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

      if (payload.code !== code) {
        const redis = redisService.getClient();
        const attempts = await redis.incr(attemptsKey);
        if (attempts === 1) {
          await redis.expire(attemptsKey, 15 * 60);
        }

        if (attempts >= 3) {
          await Promise.all([
            redisService.del(redisKey),
            redisService.del(attemptsKey),
          ]);
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

      if (orgMember.passwordHash) {
        // Ensure new password is not the same as old when a password already exists.
        const isSameAsOld = await verifyPassword(newPassword, orgMember.passwordHash);
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
      await this.prisma.orgMember.update({
        where: { memberId: orgMember.memberId },
        data: { passwordHash: newHash },
      });

      // Find all workspace users tied to this orgMember and revoke their sessions
      const affectedUsers = await this.prisma.user.findMany({
        where: { orgMemberId: orgMember.memberId },
        select: { id: true },
      });
      for (const u of affectedUsers) {
        await this.userSessionService.revokeAllUserSessions(u.id);
      }

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
