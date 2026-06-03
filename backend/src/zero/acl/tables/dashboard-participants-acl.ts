import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { DashboardRole, DashboardVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

// Per-instance ACL for the dashboard_participants table.
// Direct mirror of CanvasParticipantsACL — workspace is verified through the
// parent dashboard's workspaceId (not via channel, since dashboards aren't
// channel-scoped).
//
// Insert : workspace match + (public visibility OR no participants yet OR
//          requester is already a participant). The "no participants yet"
//          carve-out allows the dashboard creator to add the first OWNER
//          participant inside the dashboard.create mutator transaction.
// Update : OWNER/EDITOR can change roles; EDITOR cannot grant OWNER; userId
//          and dashboardId are immutable.
// Delete : self-removal always allowed; otherwise OWNER/EDITOR can remove;
//          EDITOR cannot remove an OWNER.
export class DashboardParticipantsACL extends BaseACL<'dashboard_participants'> {
  private async verifyWorkspace(dashboardId: string, tx: Transaction<Schema>): Promise<void> {
    const dashboard = await tx.run(zql.dashboards.where('id', dashboardId).one());
    if (!dashboard) {
      throw new MutationACLError('Dashboard participant not found: dashboard does not exist', 'dashboard_participants');
    }
    if (dashboard.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Dashboard participant not found in this workspace', 'dashboard_participants');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'dashboard_participants'>>, tx: Transaction<Schema>): Promise<void> {
    const dashboard = await tx.run(zql.dashboards.where('id', args.dashboardId).one());
    if (!dashboard) {
      throw new MutationACLError('Dashboard participant insert failed: the specified dashboard does not exist', 'dashboard_participants');
    }
    await this.verifyWorkspace(args.dashboardId, tx);

    if (dashboard.visibility === DashboardVisibility.PUBLIC) {
      return; // Anyone in the workspace can be added to a public dashboard
    }

    const participantExists = await tx.run(
      zql.dashboard_participants
        .where('dashboardId', args.dashboardId)
        .one(),
    );

    if (!participantExists) {
      // First participant insert — typically the OWNER row created in
      // the dashboard.create mutator transaction (mirrors canvas).
      return;
    }

    const isRequesterParticipant = await tx.run(
      zql.dashboard_participants
        .where('dashboardId', args.dashboardId)
        .where('userId', this.ctx.userID)
        .one(),
    );

    if (!isRequesterParticipant) {
      throw new MutationACLError('Dashboard participant insert failed: you must be a dashboard participant to add others', 'dashboard_participants');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'dashboard_participants'>>, tx: Transaction<Schema>): Promise<void> {
    const participant = await tx.run(zql.dashboard_participants.where('id', args.id).one());
    if (!participant) {
      throw new MutationACLError('Dashboard participant update failed: participant record does not exist', 'dashboard_participants');
    }
    await this.verifyWorkspace(participant.dashboardId, tx);

    if (args.role) {
      const isRequesterParticipant = await tx.run(
        zql.dashboard_participants
          .where('dashboardId', participant.dashboardId)
          .where('userId', this.ctx.userID)
          .one(),
      );
      const canUpdateRole =
        isRequesterParticipant &&
        (isRequesterParticipant.role === DashboardRole.OWNER ||
          isRequesterParticipant.role === DashboardRole.EDITOR);
      if (!canUpdateRole) {
        throw new MutationACLError('Dashboard participant update failed: only dashboard owners or editors can change participant roles', 'dashboard_participants');
      }
      // Editors cannot grant OWNER role
      if (
        isRequesterParticipant.role === DashboardRole.EDITOR &&
        args.role === DashboardRole.OWNER
      ) {
        throw new MutationACLError('Dashboard participant update failed: editors cannot grant owner role', 'dashboard_participants');
      }
    }

    if (args.userId || args.dashboardId) {
      throw new MutationACLError('Dashboard participant update failed: userId and dashboardId are immutable fields', 'dashboard_participants');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'dashboard_participants'>>, tx: Transaction<Schema>): Promise<void> {
    const participant = await tx.run(zql.dashboard_participants.where('id', args.id).one());
    if (!participant) {
      throw new MutationACLError('Dashboard participant delete failed: participant record does not exist', 'dashboard_participants');
    }
    await this.verifyWorkspace(participant.dashboardId, tx);

    // Participants can always remove themselves.
    if (participant.userId === this.ctx.userID) {
      return;
    }

    const isRequesterParticipant = await tx.run(
      zql.dashboard_participants
        .where('dashboardId', participant.dashboardId)
        .where('userId', this.ctx.userID)
        .one(),
    );
    const canRemove =
      isRequesterParticipant &&
      (isRequesterParticipant.role === DashboardRole.OWNER ||
        isRequesterParticipant.role === DashboardRole.EDITOR);
    if (!canRemove) {
      throw new MutationACLError('Dashboard participant delete failed: only dashboard owners or editors can remove other participants', 'dashboard_participants');
    }

    // Editors cannot remove OWNER participants.
    if (
      isRequesterParticipant.role === DashboardRole.EDITOR &&
      participant.role === DashboardRole.OWNER
    ) {
      throw new MutationACLError('Dashboard participant delete failed: editors cannot remove owners', 'dashboard_participants');
    }
  }
}
