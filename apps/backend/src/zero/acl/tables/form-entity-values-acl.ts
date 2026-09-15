import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { ChannelVisibility, FormEntityType, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class FormEntityValuesACL extends BaseACL<'form_entity_values'> {

  private async verifyWorkspace(formId: string, tx: Transaction<Schema>): Promise<void> {
    const form = await tx.run(zql.forms.where('id', formId).one());
    if (!form) {
      throw new MutationACLError('Form entity value not found: form does not exist', 'form_entity_values');
    }
    // Direct workspaceId check - formId is now on form_entity_values, no need to lookup through form_fields
    if (form.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Form entity value not found in this workspace', 'form_entity_values');
    }
  }

  // True if the ticket's channel is accessible to the caller (PUBLIC, or the caller is a
  // participant), matching TicketsACL's read predicate.
  private async ticketChannelAccessible(ticketId: string, tx: Transaction<Schema>): Promise<boolean> {
    const accessible = await tx.run(zql.tickets
      .where('id', ticketId)
      .whereExists('channel', (channel) =>
        channel.where(({ or, cmp, exists }) =>
          or(
            cmp('visibility', ChannelVisibility.PUBLIC),
            exists('participants', (participants) => participants.where('userId', this.ctx.userID))
          )
        )
      )
      .one());
    return !!accessible;
  }

  // Gate ticket-scoped entities on the referenced ticket's channel. TICKET: entityId is a
  // ticket id. SUB_TICKET: entityId is a SUB_TICKET id — resolve the sub-ticket, verify its
  // workspace, and (when it is mapped to a parent ticket) gate on that ticket's channel; an
  // unmapped sub-ticket is authorized by the workspace check alone.
  private async verifyEntityAccess(entityType: string, entityId: string, tx: Transaction<Schema>): Promise<void> {
    if (entityType === FormEntityType.TICKET) {
      if (!(await this.ticketChannelAccessible(entityId, tx))) {
        throw new MutationACLError('Form entity value failed: you do not have access to the referenced ticket', 'form_entity_values');
      }
      return;
    }
    if (entityType === FormEntityType.SUB_TICKET) {
      const subTicket = await tx.run(zql.sub_tickets.where('id', entityId).one());
      if (!subTicket || subTicket.workspaceId !== this.ctx.workspaceId) {
        throw new MutationACLError('Form entity value failed: you do not have access to the referenced sub-ticket', 'form_entity_values');
      }
      if (subTicket.mappedTicketId && !(await this.ticketChannelAccessible(subTicket.mappedTicketId, tx))) {
        throw new MutationACLError('Form entity value failed: you do not have access to the referenced sub-ticket', 'form_entity_values');
      }
      return;
    }
    // Non-ticket entity types are not channel-gated here.
  }

  async canInsert(args: InsertValue<TableSchema<'form_entity_values'>>, tx: Transaction<Schema>): Promise<void> {
    // Use args.formId directly - now available on form_entity_values
    await this.verifyWorkspace(args.formId, tx);
    await this.verifyEntityAccess(args.entityType, args.entityId, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'form_entity_values'>>, tx: Transaction<Schema>): Promise<void> {
    const entityValue = await tx.run(zql.form_entity_values.where('id', args.id).one());
    if (!entityValue) {
      throw new MutationACLError('Form entity value update failed: record does not exist', 'form_entity_values');
    }
    // Use entityValue.formId directly
    await this.verifyWorkspace(entityValue.formId, tx);
    await this.verifyEntityAccess(entityValue.entityType, entityValue.entityId, tx);
  }

  async canDelete(args: DeleteID<TableSchema<'form_entity_values'>>, tx: Transaction<Schema>): Promise<void> {
    const entityValue = await tx.run(zql.form_entity_values.where('id', args.id).one());
    if (!entityValue) {
      throw new MutationACLError('Form entity value delete failed: record does not exist', 'form_entity_values');
    }
    // Use entityValue.formId directly
    await this.verifyWorkspace(entityValue.formId, tx);
    await this.verifyEntityAccess(entityValue.entityType, entityValue.entityId, tx);
  }
}
