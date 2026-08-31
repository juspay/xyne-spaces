import crypto from 'crypto';
import { AuthProvider, OrgRole, WorkspaceRole } from '@xyne/shared';
import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
import { UserSessionService } from '../services/userSessionService';
import { UserService } from '../services/userService';
import { jwtService } from '../services/jwtService';
import {
  hashPassword,
  validatePasswordComplexity,
  generateSixDigitCode,
  isClientPasswordHash,
  normalizeClientPasswordHash,
  verifyEmailPassword,
} from '../utils/passwordUtils';
import { DatabaseClient } from '@/database/client';
import { emailService } from '@/services/email/factory';
import { redisService } from '@/services/redisService';
import {
  organizationDomainService,
  OrganizationDomainConflictError,
  PublicEmailDomainError,
} from '@/services/organizationDomainService';
import '../types/express';
import { migrateLegacyIdentity } from '@/services/legacyIdentityMigrationHelper';
import { logger } from '@/utils/logger';
import { invitationService } from '@/services/invitationService';

interface ResetCodePayload {
  code: string;
}

interface RegistrationPendingPayload {
  code: string;
  email: string;
  passwordHash: string;
  name: string;
  workspaceId?: string;
  invitationId?: string;
}

const LOGIN_MAX_FAILED_ATTEMPTS = 5;
const LOGIN_LOCKOUT_SECONDS = 5 * 60;
const LOGIN_FAILED_ATTEMPT_WINDOW_SECONDS = 5 * 60;
const PASSWORD_RESET_REQUEST_MESSAGE = 'If an account exists, a reset code has been sent.';

const REGISTER_RATE_LIMIT_SECONDS = 60;
const REGISTER_REQUEST_MESSAGE = 'If this email is not already registered, a verification code has been sent.';
const REGISTER_CODE_TTL_SECONDS = 15 * 60;
const REGISTER_MAX_VERIFY_ATTEMPTS = 3;
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const NAME_REGEX = /^[a-zA-Z][a-zA-Z\s]*$/;

export class EmailAuthController {
  private userSessionService: UserSessionService;
  private userService: UserService;
  private prisma = DatabaseClient.getInstance();

  constructor() {
    this.userSessionService = new UserSessionService();
    this.userService = new UserService();
  }

  private getPreAcceptanceOrgRole(role: string): OrgRole {
    return role === WorkspaceRole.GUEST ? OrgRole.GUEST : OrgRole.COMMUNITY_MEMBER;
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
      const loginLockKey = `emaillogin:lock:${normalizedEmail}`;
      const loginAttemptKey = `emaillogin:attempts:${normalizedEmail}`;

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

      let authenticatedWithGuestInvitationTempPassword = false;

      if (!orgMember || orgMember.leftAt || !orgMember.passwordHash) {
        if (pendingInvitation?.role === WorkspaceRole.GUEST) {
          const guestTempPassword = await invitationService.verifyGuestInvitationTempPassword({
            invitationId: pendingInvitation.invitationId ?? normalizedInvitationId,
            email: normalizedEmail,
            password,
          });
          authenticatedWithGuestInvitationTempPassword = Boolean(guestTempPassword);
        }

        if (!authenticatedWithGuestInvitationTempPassword) {
          res.status(401).json({
            error: 'Invalid credentials',
            message: 'Email or password is incorrect',
          });
          return;
        }
      }

      // 2. Verify password against orgMember.passwordHash, unless this is a
      // first-time guest login using the Redis-backed invitation password.
      const isValid = authenticatedWithGuestInvitationTempPassword
        ? true
        : await verifyEmailPassword(password, orgMember!.passwordHash!);
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
        res.status(403).json({
          error: 'provider_mismatch',
          message: 'This account uses a different login method. Please continue with your original sign-in method.',
          existingProvider: existingIdentity.authProvider,
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
      // The sentinel string '__pending_guest_invitation__' ensures the filter
      // is applied (no real user has that orgMemberId), so the query correctly returns an empty array.
      const workspaceUsers = await this.prisma.user.findMany({
        where: { orgMemberId: orgMember?.memberId ?? '__pending_guest_invitation__', leftAt: null },
        orderBy: { createdAt: 'desc' },
        include: { workspace: true },
      });

      if (workspaceUsers.length === 0 && !pendingInvitation) {
        // Check if user has approved community workspace join request(s).
        const approvedJoinRequests = await this.prisma.workspaceJoinRequest.findMany({
          where: { email: normalizedEmail, status: 'APPROVED' },
          orderBy: { updatedAt: 'desc' },
          select: { id: true, workspaceId: true },
        });

        if (approvedJoinRequests.length === 1) {
          // Exactly one approved request — issue pending-auth cookie and
          // signal the frontend to complete the join for this workspace.
          const approvedJoinRequest = approvedJoinRequests[0];
          const userName = normalizedEmail.split('@')[0];
          const pendingAuthJwtId = crypto.randomUUID();

          await redisService.set(
            `pendingauth:jwtid:${pendingAuthJwtId}`,
            normalizedEmail,
            10 * 60,
          );

          const isProduction = process.env.NODE_ENV === 'production';
          const cookieBase = {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'strict' as const,
            path: '/',
          };

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
              maxAge: 10 * 60 * 1000,
            },
          );

          res.status(200).json({
            success: true,
            workspaces: [],
            pendingUserData: { email: normalizedEmail, name: userName },
            userExistsButRemoved: false,
            autoLoginWorkspace: approvedJoinRequest.workspaceId,
          });
          return;
        }

        if (approvedJoinRequests.length > 1) {
          // Multiple approved requests — let the user pick which workspace to join.
          const workspaceIds = approvedJoinRequests.map(r => r.workspaceId);
          const workspaces = await this.prisma.workspace.findMany({
            where: { id: { in: workspaceIds } },
            select: { id: true, name: true },
          });
          const workspaceMap = new Map(workspaces.map(w => [w.id, w.name]));
          const userName = normalizedEmail.split('@')[0];
          const pendingAuthJwtId = crypto.randomUUID();

          await redisService.set(
            `pendingauth:jwtid:${pendingAuthJwtId}`,
            normalizedEmail,
            10 * 60,
          );

          const isProduction = process.env.NODE_ENV === 'production';
          const cookieBase = {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'strict' as const,
            path: '/',
          };

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
              maxAge: 10 * 60 * 1000,
            },
          );

          res.status(200).json({
            success: true,
            workspaces: approvedJoinRequests.map(r => ({
              id: r.workspaceId,
              name: workspaceMap.get(r.workspaceId) || r.workspaceId,
              role: 'COMMUNITY_MEMBER',
            })),
            pendingUserData: { email: normalizedEmail, name: userName },
            userExistsButRemoved: false,
          });
          return;
        }

        // Check if user has a pending join request
        const pendingJoinRequest = await this.prisma.workspaceJoinRequest.findFirst({
          where: { email: normalizedEmail, status: 'PENDING' },
          orderBy: { updatedAt: 'desc' },
        });

        if (pendingJoinRequest) {
          res.status(403).json({
            error: 'Join request pending',
            message: 'Your request to join the community workspace is pending approval.',
          });
          return;
        }

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
        providerUserId: `email-${workspaceUser.email}`,
        provider: AuthProvider.EMAIL,
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
          orgRole: orgMember!.role,
          memberId: orgMember!.memberId,
          authProvider: AuthProvider.EMAIL,
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
      const isValid = await verifyEmailPassword(currentPassword, orgMember.passwordHash);
      if (!isValid) {
        res.status(401).json({ error: 'Current password is incorrect' });
        return;
      }

      // Ensure new password is not the same as old
      const isSameAsOld = await verifyEmailPassword(newPassword, orgMember.passwordHash);
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
        const isSameAsOld = await verifyEmailPassword(newPassword, orgMember.passwordHash);
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

  /**
   * Register a new account with email + password
   * POST /v2/auth/email/register
   *
   * Validates email + client-hashed password, stores pending
   * registration data in Redis, and sends a 6-digit verification code.
   * The OrgMember is NOT created until the code is verified.
   *
   * If workspaceId is provided, the user is registering to join a specific
   * workspace (community or enterprise). If not provided, the post-verification
   * flow mirrors OAuth — domain checking determines if an org exists, and
   * the user can join existing workspaces or create a new org.
   */
  register = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, hashedPassword, name } = req.body;
      const workspaceId: string | undefined = req.body.workspaceId;
      const invitationId: string | undefined = typeof req.body.invitationId === 'string'
        ? req.body.invitationId.trim()
        : undefined;

      if (!email || !hashedPassword || !name) {
        res.status(400).json({
          error: 'Missing required fields',
          message: 'email, hashedPassword, and name are required',
        });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();
      const trimmedName = name.trim();

      if (!EMAIL_REGEX.test(normalizedEmail)) {
        res.status(400).json({ error: 'Invalid email address' });
        return;
      }

      if (!NAME_REGEX.test(trimmedName)) {
        res.status(400).json({ error: 'Name can only contain alphabets and spaces' });
        return;
      }

      if (!isClientPasswordHash(hashedPassword)) {
        res.status(400).json({ error: 'Invalid password' });
        return;
      }

      // Rate-limit: 60s between registration attempts for the same email
      const rateLimitKey = `emailreg:ratelimit:${normalizedEmail}`;
      const rateLimited = await redisService.get(rateLimitKey);
      if (rateLimited) {
        res.status(429).json({
          error: 'Rate limited',
          message: 'Please wait before requesting another verification code.',
        });
        return;
      }

      // If invitationId is provided, this registration is only for accepting
      // that existing workspace invitation. Do not let it fall through to the
      // normal create-org onboarding path after verification.
      let workspaceName: string | null = null;
      let invitationWorkspaceId: string | null = null;
      if (invitationId) {
        const invitation = await this.prisma.invitation.findFirst({
          where: {
            invitationId,
            email: normalizedEmail,
            acceptedAt: null,
            expiredAt: { gt: new Date() },
          },
          include: {
            workspace: {
              select: { id: true, name: true, status: true },
            },
          },
        });

        if (!invitation || !invitation.workspace || invitation.workspace.status !== 'ACTIVE') {
          res.status(400).json({ error: 'Invalid or expired invitation' });
          return;
        }

        workspaceName = invitation.workspace.name;
        invitationWorkspaceId = invitation.workspace.id;
      } else if (workspaceId) {
        const workspace = await this.prisma.workspace.findUnique({
          where: { id: workspaceId },
          select: { id: true, name: true, status: true },
        });

        if (!workspace || workspace.status !== 'ACTIVE') {
          res.status(404).json({ error: 'Workspace not found' });
          return;
        }
        workspaceName = workspace.name;
      }

      // Check if OrgMember already exists with a password (already registered)
      const existingOrgMember = await this.prisma.orgMember.findUnique({
        where: { email: normalizedEmail },
        select: { memberId: true, passwordHash: true, leftAt: true },
      });

      const existingIdentity = await this.userService.findAuthIdentityByEmail(normalizedEmail);

      const isAlreadyRegistered = existingOrgMember && existingOrgMember.passwordHash && !existingOrgMember.leftAt;
      const isProviderMismatch = existingIdentity && existingIdentity.authProvider !== AuthProvider.EMAIL;

      if (isAlreadyRegistered || isProviderMismatch) {
        const reason = isAlreadyRegistered
          ? 'already registered'
          : `SSO provider mismatch (${existingIdentity?.authProvider})`;
        logger.info(`[EmailAuthController] Registration blocked for ${normalizedEmail}: ${reason}`);
        res.status(200).json({
          success: true,
          message: REGISTER_REQUEST_MESSAGE,
          email: normalizedEmail,
        });
        return;
      }

      // Dashboard already sends the register password as a SHA-256 hash.
      // Store that credential directly so we do not hash it again.
      const passwordHash = normalizeClientPasswordHash(hashedPassword);

      // Generate 6-digit verification code
      const code = generateSixDigitCode();
      const redisKey = `emailreg:code:${normalizedEmail}`;
      const attemptsKey = `emailreg:attempts:${normalizedEmail}`;

      const payload: RegistrationPendingPayload = {
        code,
        email: normalizedEmail,
        passwordHash,
        name: trimmedName,
        ...(invitationWorkspaceId
          ? { workspaceId: invitationWorkspaceId }
          : workspaceId
            ? { workspaceId }
            : {}),
        ...(invitationId ? { invitationId } : {}),
      };

      await Promise.all([
        redisService.set(redisKey, JSON.stringify(payload), REGISTER_CODE_TTL_SECONDS),
        redisService.del(attemptsKey),
        redisService.set(rateLimitKey, '1', REGISTER_RATE_LIMIT_SECONDS),
      ]);

      // Send verification email
      const escapedRegWorkspaceName = workspaceName
        ? workspaceName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
        : null;

      const emailResult = await emailService.sendEmail({
        to: normalizedEmail,
        subject: 'Xyne Spaces — Verify Your Email',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
            <h2>Verify Your Email</h2>
            ${escapedRegWorkspaceName
              ? `<p>You're registering for <strong>${escapedRegWorkspaceName}</strong> on Xyne Spaces.</p>`
              : '<p>Welcome to Xyne Spaces!</p>'
            }
            <p>Enter the following code to complete your registration:</p>
            <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px; padding: 16px; background: #f5f5f5; border-radius: 8px; text-align: center;">${code}</p>
            <p>This code expires in 15 minutes.</p>
            <p>If you didn't request this, you can safely ignore this email.</p>
          </div>
        `,
        text: `Your Xyne Spaces verification code is: ${code}\n\nThis code expires in 15 minutes.\n`,
      });

      if (!emailResult.success) {
        await Promise.all([
          redisService.del(redisKey),
          redisService.del(attemptsKey),
          redisService.del(rateLimitKey),
        ]);
        res.status(500).json({ error: 'Failed to send verification email. Please try again.' });
        return;
      }

      res.status(200).json({
        success: true,
        message: REGISTER_REQUEST_MESSAGE,
        email: normalizedEmail,
      });
    } catch (error) {
      res.status(500).json({
        error: 'Registration failed',
        message: `An unexpected error occurred. Error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };

  /**
   * Verify email and complete registration
   * POST /v2/auth/email/verify
   *
   * Verifies the 6-digit code, creates the OrgMember with passwordHash,
   * and issues a pending-auth cookie (same as OAuth flow). The frontend
   * auth machine then handles the workspace join — community OPEN joins
   * immediately, REQUEST_TO_JOIN creates a join request, and enterprise
   * goes through the domain-check + join-request flow. All identical to
   * what happens after Google/Microsoft SSO authentication.
   */
  verifyEmail = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, code } = req.body;

      if (!email || !code) {
        res.status(400).json({ error: 'Email and verification code are required' });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();
      const redisKey = `emailreg:code:${normalizedEmail}`;
      const attemptsKey = `emailreg:attempts:${normalizedEmail}`;

      const raw = await redisService.get(redisKey);
      if (!raw) {
        res.status(400).json({ error: 'Invalid or expired code. Please register again.' });
        return;
      }

      let payload: RegistrationPendingPayload;
      try {
        payload = JSON.parse(raw) as RegistrationPendingPayload;
      } catch {
        res.status(400).json({ error: 'Invalid or expired code. Please register again.' });
        return;
      }

      if (payload.code !== code) {
        const redis = redisService.getClient();
        const attempts = await redis.incr(attemptsKey);
        if (attempts === 1) {
          await redis.expire(attemptsKey, REGISTER_CODE_TTL_SECONDS);
        }

        if (attempts >= REGISTER_MAX_VERIFY_ATTEMPTS) {
          await Promise.all([
            redisService.del(redisKey),
            redisService.del(attemptsKey),
          ]);
          res.status(400).json({ error: 'Too many failed attempts. Please register again.' });
          return;
        }

        res.status(400).json({ error: 'Invalid code' });
        return;
      }

      // Code verified — retrieve pending data
      const { passwordHash, name, workspaceId, invitationId } = payload;

      const existingIdentity = await this.userService.findAuthIdentityByEmail(normalizedEmail);
      if (existingIdentity && existingIdentity.authProvider !== AuthProvider.EMAIL) {
        res.status(403).json({
          error: 'provider_mismatch',
          message: 'This account uses a different login method. Please continue with your original sign-in method.',
          existingProvider: existingIdentity.authProvider,
        });
        return;
      }

      // Determine the orgId for the OrgMember:
      // - If workspaceId is provided, use that workspace's org
      // - If not, try to find an existing org by email domain
      // - If neither, don't create OrgMember yet — defer to create-org flow
      let orgId: string | null = null;

      let invitationOrgRole: OrgRole | null = null;

      if (invitationId) {
        const invitation = await this.prisma.invitation.findFirst({
          where: {
            invitationId,
            email: normalizedEmail,
            acceptedAt: null,
            expiredAt: { gt: new Date() },
          },
          include: {
            workspace: {
              select: { orgId: true, status: true },
            },
          },
        });

        if (!invitation || !invitation.workspace || invitation.workspace.status !== 'ACTIVE') {
          res.status(400).json({ error: 'Invalid or expired invitation' });
          return;
        }

        orgId = invitation.orgId ?? invitation.workspace.orgId;
        invitationOrgRole = this.getPreAcceptanceOrgRole(invitation.role);
      } else if (workspaceId) {
        const workspace = await this.prisma.workspace.findUnique({
          where: { id: workspaceId },
          select: { orgId: true, status: true },
        });
        if (!workspace || workspace.status !== 'ACTIVE') {
          res.status(404).json({ error: 'Workspace not found' });
          return;
        }
        orgId = workspace.orgId;
      } else {
        // No workspaceId — check if the email domain maps to an existing org
        const existingOrg = await organizationDomainService.findExistingOrgByEmailDomain(normalizedEmail);
        if (existingOrg) {
          orgId = existingOrg.orgId;
        }
      }

      // Create or update OrgMember with passwordHash.
      // If we have an orgId, create/update the OrgMember now.
      // If not, store the passwordHash in Redis so the create-org flow can
      // pick it up when creating the OrgMember.
      const existingOrgMember = await this.prisma.orgMember.findUnique({
        where: { email: normalizedEmail },
        select: { memberId: true, orgId: true, role: true },
      });

      if (existingOrgMember) {
        if (orgId && existingOrgMember.orgId !== orgId) {
          if (existingOrgMember.role !== OrgRole.COMMUNITY_MEMBER) {
            res.status(409).json({
              error: 'Organization conflict',
              message: 'This email is already associated with a different organization.',
            });
            return;
          }
        }
        await this.prisma.orgMember.update({
          where: { email: normalizedEmail },
          data: {
            passwordHash,
            leftAt: null,
            ...(orgId && existingOrgMember.orgId !== orgId ? { orgId } : {}),
            ...(invitationOrgRole ? { role: invitationOrgRole } : {}),
          },
        });
      } else if (orgId) {
        await this.prisma.orgMember.create({
          data: {
            orgId,
            email: normalizedEmail,
            role: invitationOrgRole ?? OrgRole.COMMUNITY_MEMBER,
            passwordHash,
          },
        });
      } else {
        // No orgId and no existing OrgMember — store passwordHash in Redis
        // so createOrganizationWithUser can set it on the OrgMember later.
        await redisService.set(
          `emailreg:verified:${normalizedEmail}`,
          JSON.stringify({ passwordHash, name }),
          10 * 60, // 10 minutes
        );
      }
      
      await Promise.all([
        redisService.del(`emailreg:code:${normalizedEmail}`),
        redisService.del(`emailreg:attempts:${normalizedEmail}`),
      ]);

      // Issue pending-auth cookie — same mechanism as OAuth callback.
      const userName = name || normalizedEmail.split('@')[0];
      const pendingAuthJwtId = crypto.randomUUID();

      await redisService.set(
        `pendingauth:jwtid:${pendingAuthJwtId}`,
        normalizedEmail,
        10 * 60,
      );

      const isProduction = process.env.NODE_ENV === 'production';
      const cookieBase = {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict' as const,
        path: '/',
      };

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
          maxAge: 10 * 60 * 1000,
        },
      );

      // Build response — mirrors OAuth callback structure.
      // If workspaceId was provided, return empty workspaces so the frontend
      // triggers the joinWorkspace actor (handles community/enterprise join).
      // If not, return existing workspaces + domain conflict info (same as OAuth).
      if (workspaceId) {
        res.status(200).json({
          success: true,
          ...(invitationId ? { invitationPending: true, invitationId } : {}),
          workspaces: [],
          pendingUserData: { email: normalizedEmail, name: userName },
          userExistsButRemoved: false,
        });
        return;
      }

      // No workspaceId — same domain-checking logic as OAuth callback
      const workspaces = await this.userService.getWorkspacesByEmail(normalizedEmail);

      let domainConflictError: string | null = null;
      let publicEmailDomainError: string | null = null;
      let enterpriseJoinOrgName: string | null = null;
      let enterpriseJoinWorkspaces: string | null = null;

      if (workspaces.length === 0) {
        try {
          await organizationDomainService.assertCanCreateOrgForEmail(normalizedEmail);
        } catch (error) {
          if (error instanceof PublicEmailDomainError) {
            publicEmailDomainError = error.message;
          } else if (error instanceof OrganizationDomainConflictError) {
            domainConflictError = error.message;
          }
        }

        if (!domainConflictError && !publicEmailDomainError) {
          const domainConflict = await organizationDomainService.findEnterpriseWorkspaceByEmailDomain(normalizedEmail);
          if (domainConflict) {
            domainConflictError = new OrganizationDomainConflictError(domainConflict.domain, domainConflict).message;
            enterpriseJoinOrgName = domainConflict.name;
            enterpriseJoinWorkspaces = JSON.stringify(domainConflict.workspaces);
          }
        }
      }

      res.status(200).json({
        success: true,
        workspaces: workspaces.map(w => ({ id: w.id, name: w.name, role: w.role })),
        pendingUserData: { email: normalizedEmail, name: userName },
        userExistsButRemoved: false,
        ...(domainConflictError ? { domainConflictError } : {}),
        ...(enterpriseJoinOrgName ? { enterpriseJoinOrgName } : {}),
        ...(enterpriseJoinWorkspaces ? { enterpriseJoinWorkspaces } : {}),
        ...(publicEmailDomainError ? { publicEmailDomainError } : {}),
      });
    } catch (error) {
      res.status(500).json({
        error: 'Verification failed',
        message: `An unexpected error occurred. Error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };

  /**
   * Resend verification code
   * POST /v2/auth/email/resend-code
   *
   * Resends a new 6-digit code using the pending registration data in Redis.
   */
  resendVerificationCode = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email } = req.body;

      if (!email) {
        res.status(400).json({ error: 'Email is required' });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();

      const rateLimitKey = `emailreg:ratelimit:${normalizedEmail}`;
      const rateLimited = await redisService.get(rateLimitKey);
      if (rateLimited) {
        res.status(429).json({
          error: 'Rate limited',
          message: 'Please wait before requesting another verification code.',
        });
        return;
      }

      const redisKey = `emailreg:code:${normalizedEmail}`;
      const raw = await redisService.get(redisKey);
      if (!raw) {
        res.status(400).json({
          error: 'No pending registration found',
          message: 'Please register again.',
        });
        return;
      }

      let payload: RegistrationPendingPayload;
      try {
        payload = JSON.parse(raw) as RegistrationPendingPayload;
      } catch {
        res.status(400).json({
          error: 'No pending registration found',
          message: 'Please register again.',
        });
        return;
      }

      // Generate new code
      const newCode = generateSixDigitCode();
      payload.code = newCode;

      const attemptsKey = `emailreg:attempts:${normalizedEmail}`;

      await Promise.all([
        redisService.set(redisKey, JSON.stringify(payload), REGISTER_CODE_TTL_SECONDS),
        redisService.del(attemptsKey),
        redisService.set(rateLimitKey, '1', REGISTER_RATE_LIMIT_SECONDS),
      ]);

      // Fetch workspace name for the email (only when workspaceId is present)
      let workspaceName: string | null = null;
      if (payload.workspaceId) {
        const workspace = await this.prisma.workspace.findUnique({
          where: { id: payload.workspaceId },
          select: { name: true },
        });
        workspaceName = workspace?.name ?? null;
      }
      const escapedWorkspaceName = workspaceName
        ? workspaceName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
        : null;

      const emailResult = await emailService.sendEmail({
        to: normalizedEmail,
        subject: 'Xyne Spaces — Verify Your Email',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
            <h2>Verify Your Email</h2>
            ${escapedWorkspaceName
              ? `<p>You're registering for <strong>${escapedWorkspaceName}</strong> on Xyne Spaces.</p>`
              : '<p>Welcome to Xyne Spaces!</p>'
            }
            <p>Enter the following code to complete your registration:</p>
            <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px; padding: 16px; background: #f5f5f5; border-radius: 8px; text-align: center;">${newCode}</p>
            <p>This code expires in 15 minutes.</p>
            <p>If you didn't request this, you can safely ignore this email.</p>
          </div>
        `,
        text: `Your Xyne Spaces verification code is: ${newCode}\n\nThis code expires in 15 minutes.\n`,
      });

      if (!emailResult.success) {
        res.status(500).json({ error: 'Failed to send verification email. Please try again.' });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'A new verification code has been sent to your email.',
      });
    } catch (error) {
      res.status(500).json({ error: 'An unexpected error occurred' });
    }
  };
}

export const emailAuthController = new EmailAuthController();
