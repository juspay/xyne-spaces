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
  return asSystem(['Invitation', 'User', 'Channel', 'Canvas', 'Project'], APPROVAL_REASON, async () => {
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
        entityType: true,
        entityId: true,
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

    // Guest invites are scoped to one channel/canvas/project — name it so the
    // approver can see what access they are granting.
    const idsOfType = (type: string): string[] =>
      invitations.filter(i => i.entityType === type && i.entityId).map(i => i.entityId!);
    const db = DatabaseClient.getInstance();
    const [channels, canvases, projects] = await Promise.all([
      db.channel.findMany({ where: { id: { in: idsOfType('CHANNEL') } }, select: { id: true, name: true } }),
      db.canvas.findMany({ where: { id: { in: idsOfType('CANVAS') } }, select: { id: true, title: true } }),
      db.project.findMany({ where: { id: { in: idsOfType('PROJECT') } }, select: { id: true, name: true } }),
    ]);
    const entityTitleById = new Map<string, string | null>([
      ...channels.map(c => [c.id, c.name] as const),
      ...canvases.map(c => [c.id, c.title] as const),
      ...projects.map(p => [p.id, p.name] as const),
    ]);

    return { invitations, inviterById: new Map(inviters.map(u => [u.id, u])), entityTitleById };
  });
}

/** Name of the user who sent the invite — may sit in another workspace of the org than the approver. */
export function getInviterNameOrgWide(userId: string) {
  return asSystem(['User'], APPROVAL_REASON, async () => {
    const inviter = await DatabaseClient.getInstance().user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    return inviter?.name ?? null;
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
