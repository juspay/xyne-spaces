import { Request, Response } from 'express';
import { db } from '@/database/client';
import { verifyPassword } from '@/utils/passwordUtils';

export interface OrgMemberCheckResponse {
  isActiveMember: boolean;
  memberId?: string;
  orgId?: string;
  orgName?: string;
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
}
