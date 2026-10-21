import { asSystem } from './base';
import { DatabaseClient } from '@/database/client';
import { invitationService } from '@/services/invitationService';

/**
 * Named operations for the org-wide invitation approval flow, relocated from
 * invitationController. An invite may live in any workspace of the org, so once
 * requireOrgAdmin has authorized the caller, these reads/writes must run outside
 * the caller's workspace-scoped ACL. The controller calls these by name; it never
 * opens a bypass scope itself.
 */

const APPROVAL_REASON =
  'invitation approval: org-wide operation across every workspace of the org, after requireOrgAdmin authorized the caller';

/** Fetch a single invitation regardless of which workspace of the org it lives in. */
export function getInvitationByIdOrgWide(id: string) {
  return asSystem(['Invitation', 'Workspace', 'Organization'], APPROVAL_REASON, () =>
    invitationService.getInvitationById(id),
  );
}

/** Pending approvals plus approved invites whose email never went out, org-wide. */
export function listPendingApprovalInvitations(orgId: string) {
  return asSystem(['Invitation', 'User'], APPROVAL_REASON, async () => {
    const invitations = await DatabaseClient.getInstance().invitation.findMany({
      where: {
        orgId,
        acceptedAt: null,
        AND: [
          { OR: [{ expiredAt: null }, { expiredAt: { gt: new Date() } }] },
          { OR: [{ isOrgApproved: false }, { isOrgApproved: true, inviteEmailSentAt: null }] },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        invitedBy: true,
        invitedAt: true,
        createdAt: true,
        isOrgApproved: true,
        inviteEmailSentAt: true,
        workspace: { select: { name: true } },
      },
    });

    const inviterIds = Array.from(new Set(invitations.map(i => i.invitedBy)));
    const inviters = inviterIds.length
      ? await DatabaseClient.getInstance().user.findMany({
          where: { id: { in: inviterIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    return { invitations, inviterById: new Map(inviters.map(u => [u.id, u])) };
  });
}

/** Stamp delivery on an invite email. Works for MEMBER creators too (ACL blocks their updates). */
export function markInvitationEmailSentOrgWide(id: string) {
  return asSystem(
    ['Invitation'],
    'invitation email delivery stamp: the invite may live outside the caller workspace, and a MEMBER creator cannot mutate invitation rows under the ACL',
    () => invitationService.markInviteEmailSent(id),
  );
}

/** Reject: delete a pending invite regardless of which workspace of the org it lives in. */
export function deleteInvitationOrgWide(id: string) {
  return asSystem(
    ['Invitation'],
    'invitation rejection: the invite may live outside the approver workspace',
    () => invitationService.deleteInvitation(id),
  );
}

/** Temp-password decision must see users across every workspace, not just the caller's. */
export function countActiveUsersByEmail(email: string) {
  return asSystem(
    ['User'],
    'invitation approval: temp-password decision must see users across every workspace',
    () => DatabaseClient.getInstance().user.count({ where: { email, leftAt: null } }),
  );
}

/** Org member password for an invitee outside the approver workspace. */
export function generateOrgMemberPasswordOrgWide(email: string) {
  return asSystem(
    ['OrgMember'],
    'invitation approval: org member password for an invitee outside the approver workspace',
    () => invitationService.generateOrgMemberPassword(email),
  );
}
