import type { TableName } from '../acl/core/types';
import type { QueryContext } from '../acl/core/types';
import { BaseSideEffectHandler } from './base-handler';
import { CallParticipantsSideEffectHandler } from './tables/call-participants-handler';
import { ChannelParticipantsSideEffectHandler } from './tables/channel-participants-handler';
import { MessagesSideEffectHandler } from './tables/messages-handler';
import { ConversationsSideEffectHandler } from './tables/conversations-handler';
import { CallSideEffectHandler } from './tables/call-handler';
import { TicketsSideEffectHandler } from './tables/tickets-handler';
import { TicketAssignmentsSideEffectHandler } from './tables/ticket-assignments-handler';
import { TicketStageEtaSideEffectHandler } from './tables/ticket-stage-eta-handler';
import { CanvasSideEffectHandler } from './tables/canvas-handler';
import { ReactionsSideEffectHandler } from './tables/reactions-handler';

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
      case 'channel_participants':
        return new ChannelParticipantsSideEffectHandler(ctx);
      case 'calls':
        return new CallSideEffectHandler(ctx);
      case 'tickets':
        return new TicketsSideEffectHandler(ctx);
      case 'ticket_assignments':
        return new TicketAssignmentsSideEffectHandler(ctx);
      case 'ticket_stage_eta':
        return new TicketStageEtaSideEffectHandler(ctx);
      case 'canvases':
        return new CanvasSideEffectHandler(ctx);
        
      default:
        return new BaseSideEffectHandler(ctx);
    }
  }
}
