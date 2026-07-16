import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleTicketIds } from './channel-access-helper'

/**
 * Fail-closed ACL for `form_entity_values` on the generic /api/query gateway.
 *
 * Form answers are sensitive per-entity data. Workspace-level scoping alone is
 * NOT sufficient: a workspace spans many channels/projects, so a caller could
 * read form answers for tickets in channels they are not a member of. The only
 * generic-gateway consumer today is the spaces-tickets MCP tool, which reads
 * TICKET form answers, so every gateway read is constrained to:
 *   - entityType = 'TICKET' (non-ticket entity values are not exposed here), AND
 *   - entityId ∈ the caller's channel-accessible ticket ids, AND
 *   - formId  ∈ the caller's workspace forms (defense-in-depth boundary).
 *
 * `getAccessibleTicketIds` walks channel participation + public-project channels
 * (channelParticipant → conversation → ticket), so a caller can only read form
 * answers for tickets in channels they can actually see. If the caller has no
 * accessible tickets, the `in: []` clause matches nothing — the model fails
 * CLOSED instead of falling back to workspace-wide (cross-channel) exposure.
 */
export class FormEntityValuesACL extends BaseQueryACL<Prisma.FormEntityValuesWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.FormEntityValuesWhereInput> {
    // Channel/ticket-level gate: only tickets the caller can actually reach.
    const accessibleTicketIds = await getAccessibleTicketIds(
      this.prisma,
      this.ctx.userId
    )

    // Workspace boundary (defense-in-depth): forms owned by the caller's workspace.
    const workspaceFormIds = (
      await this.prisma.form.findMany({
        where: { workspaceId: this.ctx.workspaceId ?? '' },
        select: { id: true },
      })
    ).map((f) => f.id)

    return {
      entityType: 'TICKET',
      entityId: { in: accessibleTicketIds },
      formId: { in: workspaceFormIds },
    }
  }
}
