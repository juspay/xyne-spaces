import { FormEntityType, type Context } from '../../schema';
import { guestChannelAccessWhere, guestSubTicketAccessWhere, guestTicketAccessWhere } from './guest-acl-utils';

type GuestPredicate = (helpers: any) => any;

type GuestFormEntityRule = {
  relation: 'ticket' | 'subTicket' | 'channel';
  where: (ctx: Context) => GuestPredicate;
};

// Entity types whose form values a guest may read, with the rule that decides per entity.
// Any entity type not listed here is denied for guests.
export const GUEST_FORM_ENTITY_REGISTRY: Partial<Record<FormEntityType, GuestFormEntityRule>> = {
  [FormEntityType.TICKET]: { relation: 'ticket', where: guestTicketAccessWhere },
  [FormEntityType.SUB_TICKET]: { relation: 'subTicket', where: guestSubTicketAccessWhere },
  [FormEntityType.CHANNEL]: { relation: 'channel', where: guestChannelAccessWhere },
};

export const guestFormEntityValueWhere = (ctx: Context): GuestPredicate => ({ or, and, cmp, exists }: any) =>
  or(
    ...Object.entries(GUEST_FORM_ENTITY_REGISTRY).map(([entityType, rule]) =>
      and(
        cmp('entityType', '=', entityType),
        exists(rule.relation, (entity: any) =>
          entity.where('workspaceId', '=', ctx.workspaceId).where(rule.where(ctx)),
        ),
      ),
    ),
  );
