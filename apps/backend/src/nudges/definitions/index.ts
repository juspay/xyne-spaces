import { nudgeRegistry } from '../registry';
import { createTicketFromMessage } from './create-ticket-from-message';
import { findRelatedTicketFromMessage } from './find-related-ticket-from-message';
import { findRelatedMessageFromMessage } from './find-related-message-from-message';
import { linkPasteToSurface } from './link-paste-to-surface';
import { forwardMessageLink } from './forward-message-link';
import { deleteMessageCleanup } from './delete-message-cleanup';
import { scheduleCallFromThread } from './schedule-call-from-thread';

export function registerAllNudgeDefinitions(): void {
  // Explicit definitions (show nudge UI)
  nudgeRegistry.register(createTicketFromMessage);
  nudgeRegistry.register(findRelatedTicketFromMessage);
  nudgeRegistry.register(findRelatedMessageFromMessage);
  nudgeRegistry.register(scheduleCallFromThread);

  // Implicit definitions (fire automatically, no UI)
  nudgeRegistry.register(linkPasteToSurface);
  nudgeRegistry.register(forwardMessageLink);
  nudgeRegistry.register(deleteMessageCleanup);
}
