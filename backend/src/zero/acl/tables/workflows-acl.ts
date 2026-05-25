import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { MutationACLError, type TableSchema } from '../core/types';
import { AccessType, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

const AUTOMATION_WORKFLOW_TYPE = 'Automations';
const AUTOMATIONS_RESOURCE_NAME = 'AUTOMATIONS';

type Tier = 'READ' | 'WRITE' | 'ADMIN';

/**
 * Status values whose write requires `ADMIN` on the AUTOMATIONS resource:
 * approve sets DISABLED, reject sets REJECTED, disable sets DISABLED,
 * archival sets ARCHIVED. Everything else (DRAFT, ACTIVE, PENDING_APPROVAL,
 * REVOKED, AUTO_REVOKED) requires only WRITE.
 */
const ADMIN_ONLY_STATUSES = new Set<string>(['DISABLED', 'REJECTED', 'ARCHIVED']);

function tierSatisfies(holder: AccessType, required: Tier): boolean {
  if (holder === AccessType.ADMIN) return true;
  if (holder === AccessType.WRITE) return required === 'WRITE' || required === 'READ';
  if (holder === AccessType.READ) return required === 'READ';
  return false;
}

export class WOrkflowsAcl extends BaseACL<'workflows'> {
  /**
   * Check that the calling user holds at least `tier` on the AUTOMATIONS
   * resource — directly or via a group mapping. Uses Zero's tx (no Prisma)
   * so it shares the mutator's transactional context.
   */
  private async requireAutomationsTier(tx: Transaction<Schema>, tier: Tier): Promise<void> {
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
    if (directGrants.some(g => tierSatisfies(g.accessType, tier))) return;

    // Group grants: find user's group memberships, then check group access on
    // this resource. Two-step because Zero zql doesn't compose joins yet.
    const memberships = await tx.run(
      zql.user_group_mappings.where('userId', this.ctx.userID),
    );
    if (memberships.length === 0) {
      throw new MutationACLError(
        `${tier} access on the AUTOMATIONS resource is required`,
        'workflows',
      );
    }
    const groupIds = new Set(memberships.map(m => m.userGroupId));
    const groupGrants = await tx.run(
      zql.resource_access.where('resourceId', resource.id),
    );
    const allowed = groupGrants.some(
      g => g.groupId != null && groupIds.has(g.groupId) && tierSatisfies(g.accessType, tier),
    );
    if (!allowed) {
      throw new MutationACLError(
        `${tier} access on the AUTOMATIONS resource is required`,
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
      // Creating an automation proposal is a WRITE-tier action.
      await this.requireAutomationsTier(tx, 'WRITE');
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
    // PENDING_APPROVAL, REVOKED, AUTO_REVOKED) — requires WRITE.
    const nextStatus = (args as { status?: string }).status;
    const tier: Tier = nextStatus && ADMIN_ONLY_STATUSES.has(nextStatus) ? 'ADMIN' : 'WRITE';
    await this.requireAutomationsTier(tx, tier);
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
    await this.requireAutomationsTier(tx, 'WRITE');
  }

  async canUpsert(
    _args: UpsertValue<TableSchema<'workflows'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    throw new MutationACLError('Workflow upsert failed: use insert operation only', 'workflows');
  }
}
