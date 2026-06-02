import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { MutationACLError, type TableSchema } from '../core/types';
import { AccessType, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

const AUTOMATION_WORKFLOW_TYPE = 'Automations';
const AUTOMATIONS_RESOURCE_NAME = 'AUTOMATIONS';

/**
 * Status transitions that require `ADMIN` on the AUTOMATIONS resource: approve
 * sets DISABLED, reject sets REJECTED, disable sets DISABLED, archival sets
 * ARCHIVED. Everything else — create, edit, delete, and non-admin status moves
 * — is open to any user in the workspace. Admin is the ONLY scope checked here;
 * read and write are not ACL-gated.
 */
const ADMIN_ONLY_STATUSES = new Set<string>(['DISABLED', 'REJECTED', 'ARCHIVED']);

export class WOrkflowsAcl extends BaseACL<'workflows'> {
  /**
   * Check that the calling user holds `ADMIN` on the AUTOMATIONS resource —
   * directly or via a group mapping. This is the only access tier enforced on
   * automations; read and write are open. Uses Zero's tx (no Prisma) so it
   * shares the mutator's transactional context.
   */
  private async requireAutomationsAdmin(tx: Transaction<Schema>): Promise<void> {
    const resource = await tx.run(zql.resources.where('name', AUTOMATIONS_RESOURCE_NAME).one());
    if (!resource) {
      throw new MutationACLError(
        'AUTOMATIONS resource is not configured on this server',
        'workflows',
      );
    }

    // Direct user grants on the resource.
    const directGrants = await tx.run(
      zql.resource_access
        .where('userId', this.ctx.userID)
        .where('resourceId', resource.id),
    );
    if (directGrants.some(g => g.accessType === AccessType.ADMIN)) return;

    // Group grants: find user's group memberships, then check group access on
    // this resource. Two-step because Zero zql doesn't compose joins yet.
    const memberships = await tx.run(
      zql.user_group_mappings.where('userId', this.ctx.userID),
    );
    const groupIds = new Set(memberships.map(m => m.userGroupId));
    const groupGrants = await tx.run(
      zql.resource_access.where('resourceId', resource.id),
    );
    const allowed = groupGrants.some(
      g => g.groupId != null && groupIds.has(g.groupId) && g.accessType === AccessType.ADMIN,
    );
    if (!allowed) {
      throw new MutationACLError(
        'Admin access on the AUTOMATIONS resource is required',
        'workflows',
      );
    }
  }

  async canInsert(
    args: InsertValue<TableSchema<'workflows'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    // workspaceId is NOT NULL in Postgres; the DB rejects missing values
    // but we still enforce the cross-tenant check here for clarity.
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError(
        'Workflow insert failed: workspaceId must match current workspace',
        'workflows',
      );
    }

    if (args.workflowType === AUTOMATION_WORKFLOW_TYPE) {
      return;
    }

    if (!args.ticketId) {
      throw new MutationACLError(
        'Workflow insert failed: ticketId is required for non-automation workflows',
        'workflows',
      );
    }
    const ticket = await tx.run(zql.tickets.where('id', args.ticketId).one());
    if (!ticket) {
      throw new MutationACLError(
        'Workflow insert failed: the associated ticket does not exist',
        'workflows',
      );
    }
    const isParticipant = await tx.run(
      zql.channels
        .where('projectId', ticket.projectId)
        .whereExists('participants', participants =>
          participants.where('userId', this.ctx.userID),
        )
        .one(),
    );

    if (!isParticipant) {
      throw new MutationACLError(
        'Workflow insert failed: you must be a project participant to create workflows',
        'workflows',
      );
    }
  }

  async canUpdate(
    args: UpdateValue<TableSchema<'workflows'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const existing = await tx.run(zql.workflows.where('id', args.id).one());
    if (!existing) {
      return;
    }
    if (existing.workflowType !== AUTOMATION_WORKFLOW_TYPE) {
      throw new MutationACLError(
        'Workflow update failed: workflows are immutable once created',
        'workflows',
      );
    }

    if (existing.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Automation update failed: not in this workspace', 'workflows');
    }
    // Prevent changing workspace ownership via update.
    if (args.workspaceId !== undefined && args.workspaceId !== existing.workspaceId) {
      throw new MutationACLError('Automation update failed: workspaceId is immutable', 'workflows');
    }

    // Status transitions to DISABLED / REJECTED / ARCHIVED are admin-only
    // (approve / reject / disable / archive). Every other update — name,
    // config, metadata, or non-admin status transitions (DRAFT, ACTIVE,
    // PENDING_APPROVAL, REVOKED, AUTO_REVOKED) — is open to any workspace user.
    const nextStatus = (args as { status?: string }).status;
    if (nextStatus && ADMIN_ONLY_STATUSES.has(nextStatus)) {
      await this.requireAutomationsAdmin(tx);
    }
  }

  async canDelete(
    args: DeleteID<TableSchema<'workflows'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const existing = await tx.run(zql.workflows.where('id', args.id).one());
    if (!existing) {
      return;
    }
    if (existing.workflowType !== AUTOMATION_WORKFLOW_TYPE) {
      throw new MutationACLError(
        'Workflow delete failed: workflows cannot be deleted',
        'workflows',
      );
    }
    if (existing.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Automation delete failed: not in this workspace', 'workflows');
    }
    if (existing.status !== 'DRAFT') {
      throw new MutationACLError(
        'Automation delete failed: only draft automations can be deleted',
        'workflows',
      );
    }
  }

  async canUpsert(
    _args: UpsertValue<TableSchema<'workflows'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    throw new MutationACLError('Workflow upsert failed: use insert operation only', 'workflows');
  }
}
