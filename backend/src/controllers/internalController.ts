import { Request, Response } from 'express';
import { db } from '@/database/client';

export interface OrgMemberCheckResponse {
  isActiveMember: boolean;
  memberId?: string;
  orgId?: string;
  orgName?: string;
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
}
