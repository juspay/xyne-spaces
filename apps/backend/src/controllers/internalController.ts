import { Request, Response } from 'express';
import { db } from '@/database/client';
import { getPasswordHash } from '@/services/orgMemberCredentialService';
import { verifyPassword } from '@/utils/passwordUtils';
import {
  accountDeactivationService,
  UserDeactivationResult,
} from '@/services/accountDeactivationService';
import { logger } from '@/utils/logger';

export interface OrgMemberCheckResponse {
  isActiveMember: boolean;
  memberId?: string;
  orgId?: string;
  orgName?: string;
}
interface InternalDeactivateUserResponse {
  success: boolean;
  users: UserDeactivationResult[];
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

      const storedHash = await getPasswordHash(member.memberId);
      if (!storedHash) {
        res.status(200).json({ success: false } as InternalEmailLoginResponse);
        return;
      }

      const isValid = await verifyPassword(password, storedHash);
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
   * Deactivate every user row owning an email: mark it INACTIVE through the
   * user-management deactivation flow (status + leftAt, group / assignment /
   * expertise teardown, ticket hand-off), then run the same access cleanup the
   * auth middleware triggers when an identity provider reports the account is
   * revoked (mTLS certificate revocation, session revocation, push-token
   * unregistration).
   * POST /internal/users/deactivate?email=:email
   *
   * Returns:
   * - 200 { success: true, users: [{ userId, email, ok, steps }] } when every step succeeded
   * - 207 { success: false, users: [...] } when a step failed — the cleanup is
   *   idempotent, so the caller should retry; `steps[].ok` says what is left
   * - 400 { error: "Bad Request", message: "email required" } if email is missing
   * - 401 { error: "Unauthorized" } if authentication fails
   * - 404 { error: "Not Found", message: "user not found" } if no user has that email
   * - 503 { error: "Service Unavailable" } if the user lookup throws
   */
  deactivateUser = async (req: Request, res: Response): Promise<void> => {
    const email = req.query.email?.toString().trim();

    if (!email) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'email required',
      });
      return;
    }

    try {
      // Awaited (unlike the middleware, which fires it off in the background)
      // so the caller learns what the cleanup actually managed to revoke.
      const users = await accountDeactivationService.handleDeactivatedEmail(email);

      if (users.length === 0) {
        res.status(404).json({ error: 'Not Found', message: 'user not found' });
        return;
      }

      const success = users.every((user) => user.ok);
      res.status(success ? 200 : 207).json({ success, users } as InternalDeactivateUserResponse);
    } catch (error) {
      logger.error('[Internal] User deactivation failed', {
        email,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(503).json({ error: 'Service Unavailable' });
    }
  };
}
