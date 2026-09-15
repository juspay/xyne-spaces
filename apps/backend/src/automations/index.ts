import { logger } from '@/utils/logger';
import { triggerRegistry } from './triggers/trigger-registry';
import { stepRegistry } from './steps/step-registry';

import { ticketCreatedTrigger } from './triggers/ticket-created.trigger';
import { ticketUpdatedTrigger } from './triggers/ticket-updated.trigger';
import { emailReceivedTrigger } from './triggers/email-received.trigger';
import { emailSentTrigger } from './triggers/email-sent.trigger';
import { ticketCommentedTrigger } from './triggers/ticket-commented.trigger';
import { messageReceivedTrigger } from './triggers/message-received.trigger';
import { callTrigger } from './triggers/call.trigger';
import { webhookTrigger } from './triggers/webhook.trigger';
import { tagGeneratedTrigger } from './triggers/tag-generated.trigger';

import { conditionalStep } from './steps/conditional.step';
import { switchStep } from './steps/switch.step';
import { delayStep } from './steps/delay.step';

import { sendMessageStep } from './steps/send-message.step';
import { notifyUserStep } from './steps/notify-user.step';
import { notifyUserSosStep } from './steps/notify-user-sos.step';
import { createTicketStep } from './steps/create-ticket.step';
import { createSubTicketStep } from './steps/create-sub-ticket.step';
import { updateTicketStep } from './steps/update-ticket.step';
import { assignTicketStep } from './steps/assign-ticket.step';
import { closeTicketStep } from './steps/close-ticket.step';
import { changeStageStep } from './steps/change-stage.step';
import { archiveTicketStep } from './steps/archive-ticket.step';
import { sendEmailReplyStep } from './steps/send-email-reply.step';
import { sendEmailToUserStep } from './steps/send-email-to-user.step';
import { notifyGroupStep } from './steps/notify-group.step';
import { updateTagsStep } from './steps/update-tags.step';
import { applyConversationLabelStep } from './steps/apply-conversation-label.step';
import { assignTicketToGroupStep } from './steps/assign-ticket-to-group.step';
import { triggerWebhookStep } from './steps/trigger-webhook.step';
import { runAgentStep } from './steps/run-agent.step';
import { createEmailDraftStep } from './steps/create-email-draft.step';
import { replyOnMessageStep } from './steps/reply-on-message.step';
import { promoteMessageToTicketStep } from './steps/promote-message-to-ticket.step';
import { updateFormFieldsStep } from './steps/update-form-fields.step';
import { sendCsatRequestStep } from './steps/send-csat-request.step';
import { makeCallStep } from './steps/make-call.step';

import { automationQueue } from './queue/automation.queue';
import { deskLabelBackfillQueue } from './queue/desk-label-backfill.queue';

let initialised = false;

export async function initializeAutomations(): Promise<void> {
  if (initialised) return;
  initialised = true;

  triggerRegistry.register(ticketCreatedTrigger);
  triggerRegistry.register(ticketUpdatedTrigger);
  triggerRegistry.register(emailReceivedTrigger);
  triggerRegistry.register(emailSentTrigger);
  triggerRegistry.register(ticketCommentedTrigger);
  triggerRegistry.register(messageReceivedTrigger);
  triggerRegistry.register(callTrigger);
  triggerRegistry.register(webhookTrigger);
  triggerRegistry.register(tagGeneratedTrigger);

  stepRegistry.register(conditionalStep);
  stepRegistry.register(switchStep);
  stepRegistry.register(delayStep);

  stepRegistry.register(sendMessageStep);
  stepRegistry.register(notifyUserStep);
  stepRegistry.register(notifyUserSosStep);
  stepRegistry.register(createTicketStep);
  stepRegistry.register(createSubTicketStep);
  stepRegistry.register(updateTicketStep);
  stepRegistry.register(assignTicketStep);
  stepRegistry.register(closeTicketStep);
  stepRegistry.register(changeStageStep);
  stepRegistry.register(archiveTicketStep);
  stepRegistry.register(sendEmailReplyStep);
  stepRegistry.register(sendEmailToUserStep);
  stepRegistry.register(notifyGroupStep);
  stepRegistry.register(updateTagsStep);
  stepRegistry.register(applyConversationLabelStep);
  stepRegistry.register(assignTicketToGroupStep);
  stepRegistry.register(triggerWebhookStep);
  stepRegistry.register(runAgentStep);
  stepRegistry.register(createEmailDraftStep);
  stepRegistry.register(replyOnMessageStep);
  stepRegistry.register(promoteMessageToTicketStep);
  stepRegistry.register(updateFormFieldsStep);
  stepRegistry.register(sendCsatRequestStep);
  stepRegistry.register(makeCallStep);

  await automationQueue.initialize();
  await deskLabelBackfillQueue.initialize();

  logger.info(
    `[automations] Initialised — triggers=${triggerRegistry.list().length}, steps=${stepRegistry.list().length}`,
  );
}

export { automationQueue } from './queue/automation.queue';
export { deskLabelBackfillQueue } from './queue/desk-label-backfill.queue';
export { triggerRegistry } from './triggers/trigger-registry';
export { stepRegistry } from './steps/step-registry';
export { eventRouter } from './engine/event-router';
export { automationService } from './services/automation.service';
export { default as automationRoutes } from './routes/automation.routes';
