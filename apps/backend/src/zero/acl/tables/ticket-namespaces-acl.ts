import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
    MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared'
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';
import { hasProjectAdminAccess } from '../core/admin-access';
import { assertGuestWriteBlocked } from '../core/guest-access';

// Frozen after creation: changing any of these would break existing ticket ids
// (or move the namespace across tenants). Only `name` (display label) is editable.
type FrozenArgs = { code?: string; projectId?: string; workspaceId?: string; ticketSequence?: number };
type NamespaceRow = { code: string; projectId: string; workspaceId: string; ticketSequence: number };

export class TicketNamespaceAcl extends BaseACL<'ticket_namespaces'> {

    private verifyWorkspace(workspaceId: string | null | undefined): void {
        if (!workspaceId || workspaceId !== this.ctx.workspaceId) {
            throw new MutationACLError('Ticket namespace not found in this workspace', 'ticket_namespaces');
        }
    }

    private assertFrozen(args: FrozenArgs, existing: NamespaceRow): void {
        if (args.code !== undefined && args.code !== existing.code) {
            throw new MutationACLError('Ticket namespace update failed: code is immutable', 'ticket_namespaces');
        }
        if (args.projectId !== undefined && args.projectId !== existing.projectId) {
            throw new MutationACLError('Ticket namespace update failed: projectId is immutable', 'ticket_namespaces');
        }
        if (args.workspaceId !== undefined && args.workspaceId !== existing.workspaceId) {
            throw new MutationACLError('Ticket namespace update failed: workspaceId is immutable', 'ticket_namespaces');
        }
        if (args.ticketSequence !== undefined && args.ticketSequence !== existing.ticketSequence) {
            throw new MutationACLError('Ticket namespace update failed: ticketSequence is immutable', 'ticket_namespaces');
        }
    }

    async canInsert(args: InsertValue<TableSchema<'ticket_namespaces'>>, tx: Transaction<Schema>): Promise<void> {
        assertGuestWriteBlocked(this.ctx, 'ticket_namespaces', 'insert', 'Ticket namespace');
        this.verifyWorkspace(args.workspaceId);

        // Namespace is project-scoped: the project must exist in this workspace.
        const project = await tx.run(zql.projects.where('id', args.projectId).one());
        if (!project) {
            throw new MutationACLError('Ticket namespace insert failed: the specified project does not exist', 'ticket_namespaces');
        }
        this.verifyWorkspace(project.workspaceId);

        // Only project admins can create namespaces
        const hasAdminAccess = await hasProjectAdminAccess(this.ctx, tx);
        if (!hasAdminAccess) {
            throw new MutationACLError('Ticket namespace insert failed: only project admins can create namespaces', 'ticket_namespaces');
        }
    }

    async canUpdate(args: UpdateValue<TableSchema<'ticket_namespaces'>>, tx: Transaction<Schema>): Promise<void> {
        assertGuestWriteBlocked(this.ctx, 'ticket_namespaces', 'update', 'Ticket namespace');
        const namespace = await tx.run(zql.ticket_namespaces.where('id', args.id).one());
        if (!namespace) {
            throw new MutationACLError('Ticket namespace update failed: namespace does not exist', 'ticket_namespaces');
        }
        this.verifyWorkspace(namespace.workspaceId);
        this.assertFrozen(args, namespace);

        // Allow if user is the creator
        if (namespace.createdBy === this.ctx.userID) {
            return;
        }

        // Allow if user has PROJECT ADMIN access
        const hasAdminAccess = await hasProjectAdminAccess(this.ctx, tx);
        if (hasAdminAccess) {
            return;
        }

        throw new MutationACLError('Ticket namespace update failed: only the creator or a project admin can modify this namespace', 'ticket_namespaces');
    }

    async canUpsert(args: UpsertValue<TableSchema<'ticket_namespaces'>>, tx: Transaction<Schema>): Promise<void> {
        assertGuestWriteBlocked(this.ctx, 'ticket_namespaces', 'upsert', 'Ticket namespace');
        const namespace = await tx.run(zql.ticket_namespaces.where('id', args.id).one());
        if (!namespace) {
            throw new MutationACLError('Ticket namespace upsert failed: namespace does not exist for update', 'ticket_namespaces');
        }
        this.verifyWorkspace(namespace.workspaceId);
        this.assertFrozen(args, namespace);

        if (namespace.createdBy === this.ctx.userID) {
            return;
        }

        const hasAdminAccess = await hasProjectAdminAccess(this.ctx, tx);
        if (hasAdminAccess) {
            return;
        }

        throw new MutationACLError('Ticket namespace upsert failed: only the creator or a project admin can modify this namespace', 'ticket_namespaces');
    }

    async canDelete(_args: DeleteID<TableSchema<'ticket_namespaces'>>, _tx: Transaction<Schema>): Promise<void> {
        assertGuestWriteBlocked(this.ctx, 'ticket_namespaces', 'delete', 'Ticket namespace');
        // Namespaces are never deleted: the code stays reserved for the life of the
        // workspace so historical ticket ids can never be reused.
        throw new MutationACLError('Ticket namespaces cannot be deleted', 'ticket_namespaces');
    }
}
