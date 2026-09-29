import { Request, Response } from 'express';
import { db } from '@/database/client';
import { verifyPassword } from '@/utils/passwordUtils';
import { accountDeactivationService } from '@/services/accountDeactivationService';
import { logger } from '@/utils/logger';

export interface OrgMemberCheckResponse {
  isActiveMember: boolean;
  memberId?: string;
  orgId?: string;
  orgName?: string;
}
interface InternalDeactivateUserResponse {
  success: boolean;
  email: string;
  userIds: string[];
}
interface InternalEmailLoginResponse {
  success: boolean;
  user?: {
    email: string;
    name: string;
    orgId: string;
    orgName: string;
    orgRole: string;
    memberId: string;
  };
}

export class InternalController {
  /**
   * Check if an email belongs to an active organization member.
   * GET /internal/org-members/check?email=:email
   *
   * Returns:
   * - 200 { isActiveMember: true, memberId: "..." } if found and active
   * - 200 { isActiveMember: false } if not found or inactive
   * - 400 { error: "Bad Request", message: "email required" } if email missing
   * - 401 { error: "Unauthorized" } if authentication fails
   * - 503 { error: "Service Unavailable" } on database errors
   */
  checkOrgMember = async (req: Request, res: Response): Promise<void> => {
    const email = req.query.email?.toString().toLowerCase();

    if (!email) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'email required',
      });
      return;
    }

    try {
      const member = await db.orgMember.findUnique({
        where: { email },
        select: {
          memberId: true,
          leftAt: true,
          orgId: true,
          organization: {
            select: { name: true },
          },
        },
      });

      if (!member) {
        res.status(200).json({ isActiveMember: false } as OrgMemberCheckResponse);
        return;
      }

      if (member.leftAt !== null) {
        res.status(200).json({ isActiveMember: false } as OrgMemberCheckResponse);
        return;
      }

      res.status(200).json({
        isActiveMember: true,
        memberId: member.memberId,
        orgId: member.orgId,
        orgName: member.organization.name,
      } as OrgMemberCheckResponse);
    } catch (error) {
      res.status(503).json({ error: 'Service Unavailable' });
    }
  };

  /**
   * Validate email/password for an active org member.
   * POST /internal/auth/email/login
   *
   * Returns:
    * - 200 { success: true, user: { email, name, orgId, orgName, orgRole, memberId } } when credentials are valid
    * - 200 { success: false } if the member does not exist, is inactive, has no password hash, or the password is incorrect
    * - 400 { error: "Bad Request", message: "email and password are required" } if email or password is missing
    * - 400 { error: "Bad Request", message: "password must be between 1 and 128 characters" } if password length is invalid
    * - 401 { error: "Unauthorized" } if authentication fails
    * - 503 { error: "Service Unavailable" } on database errors
   */
  loginOrgMember = async (req: Request, res: Response): Promise<void> => {
    const email = req.body?.email;
    const password = req.body?.password;

    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({
        error: 'Bad Request',
        message: 'email and password are required',
      });
      return;
    }

    if (password.length === 0 || password.length > 128) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'password must be between 1 and 128 characters',
      });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'email is required',
      });
      return;
    }

    try {
      const member = await db.orgMember.findUnique({
        where: { email: normalizedEmail },
        select: {
          memberId: true,
          email: true,
          role: true,
          leftAt: true,
          passwordHash: true,
          orgId: true,
          organization: {
            select: { name: true },
          },
        },
      });

      if (!member) {
        res.status(200).json({ success: false } as InternalEmailLoginResponse);
        return;
      }

      if (member.leftAt !== null) {
        res.status(200).json({ success: false } as InternalEmailLoginResponse);
        return;
      }

      if (!member.passwordHash) {
        res.status(200).json({ success: false } as InternalEmailLoginResponse);
        return;
      }

      const isValid = await verifyPassword(password, member.passwordHash);
      if (!isValid) {
        res.status(200).json({ success: false } as InternalEmailLoginResponse);
        return;
      }

      const name = normalizedEmail.split('@')[0] || normalizedEmail;
      res.status(200).json({
        success: true,
        user: {
          email: member.email,
          name,
          orgId: member.orgId,
          orgName: member.organization.name,
          orgRole: member.role,
          memberId: member.memberId,
        },
      } as InternalEmailLoginResponse);
    } catch (error) {
      res.status(503).json({ error: 'Service Unavailable' });
    }
  };

  /**
   * Run the deactivated-account cleanup for a user, the same flow the auth
   * middleware triggers when an identity provider reports the account is
   * revoked (mTLS certificate revocation, session revocation, push-token
   * unregistration).
   * POST /internal/users/deactivate?email=:email
   *
   * A user row is unique per (email, workspace), so one email can own a row in
   * several workspaces. All of them are cleaned up: the provider revoked the
   * identity, not one workspace membership.
   *
   * Returns:
   * - 200 { success: true, email, userIds: [...] } once the cleanup ran
   * - 400 { error: "Bad Request", message: "email required" } if email is missing
   * - 401 { error: "Unauthorized" } if authentication fails
   * - 404 { error: "Not Found", message: "user not found" } if no user has that email
   * - 503 { error: "Service Unavailable" } if the lookup or cleanup throws
   */
  deactivateUser = async (req: Request, res: Response): Promise<void> => {
    const email = req.query.email?.toString().toLowerCase().trim();

    if (!email) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'email required',
      });
      return;
    }

    try {
      const users = await db.user.findMany({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true, email: true },
      });

      if (users.length === 0) {
        res.status(404).json({ error: 'Not Found', message: 'user not found' });
        return;
      }

      // Awaited here (unlike the middleware, which fires it off in the
      // background) so the caller learns whether the cleanup completed.
      // handleDeactivatedUser never rejects on a failed step — it logs each one
      // — so a throw here is a bug, not a partially-failed cleanup.
      for (const user of users) {
        await accountDeactivationService.handleDeactivatedUser({
          userId: user.id,
          email: user.email,
        });
      }

      res.status(200).json({
        success: true,
        email,
        userIds: users.map((user) => user.id),
      } as InternalDeactivateUserResponse);
    } catch (error) {
      logger.error('[Internal] User deactivation failed', {
        email,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(503).json({ error: 'Service Unavailable' });
    }
  };
}
