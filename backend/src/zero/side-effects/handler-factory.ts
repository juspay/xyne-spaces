import type { TableName } from '../acl/core/types';
import type { QueryContext } from '../acl/core/types';
import { BaseSideEffectHandler } from './base-handler';
import { CallParticipantsSideEffectHandler } from './tables/call-participants-handler';
import { MessagesSideEffectHandler } from './tables/messages-handler';
import { ReactionsSideEffectHandler } from './tables/reactions-handler';
import { ConversationsSideEffectHandler } from './tables/conversations-handler';
import { CallSideEffectHandler } from './tables/call-handler';
import { TicketsSideEffectHandler } from './tables/tickets-handler';
import { TicketAssignmentsSideEffectHandler } from './tables/ticket-assignments-handler';

export class SideEffectHandlerFactory {

  static getHandler(table: TableName, ctx: QueryContext): BaseSideEffectHandler {
    switch (table) {
      case 'messages':
        return new MessagesSideEffectHandler(ctx);
      case 'reactions':
        return new ReactionsSideEffectHandler(ctx);
      case 'conversations':
        return new ConversationsSideEffectHandler(ctx);

      case 'call_participants':
        return new CallParticipantsSideEffectHandler(ctx);
      case 'calls':
        return new CallSideEffectHandler(ctx);
      case 'tickets':
        return new TicketsSideEffectHandler(ctx);
      case 'ticket_assignments':
        return new TicketAssignmentsSideEffectHandler(ctx);
        
      default:
        return new BaseSideEffectHandler(ctx);
    }
  }
}
