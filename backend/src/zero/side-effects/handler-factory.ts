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
import { CanvasParticipantsSideEffectHandler } from './tables/canvas-participants-handler';
import { ReactionsSideEffectHandler } from './tables/reactions-handler';
import { DelayedMessagesSideEffectHandler } from './tables/delayed-messages-handler';
import { TicketTagsSideEffectHandler } from './tables/ticket-tags-handler';
import { ChannelsSideEffectHandler } from './tables/channels-handler';
import { EmailReadsSideEffectHandler } from './tables/email-reads-handler';
import { ChannelUserStatusSideEffectHandler } from './tables/channel-user-status-handler';
import { ConversationParticipantsSideEffectHandler } from './tables/conversation-participants-handler';
import { FormEntityValuesSideEffectHandler } from './tables/form-entity-values-handler';

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
      case 'canvas_participants':
        return new CanvasParticipantsSideEffectHandler(ctx);
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
      case 'delayed_messages':
        return new DelayedMessagesSideEffectHandler(ctx);

      case 'ticket_tags':
        return new TicketTagsSideEffectHandler(ctx);
      case 'channels':
        return new ChannelsSideEffectHandler(ctx);
      case 'email_reads':
        return new EmailReadsSideEffectHandler(ctx);
      case 'channel_user_status':
        return new ChannelUserStatusSideEffectHandler(ctx);
      case 'conversation_participants':
        return new ConversationParticipantsSideEffectHandler(ctx);
      case 'form_entity_values':
        return new FormEntityValuesSideEffectHandler(ctx);

      default:
        return new BaseSideEffectHandler(ctx);
    }
  }
}
