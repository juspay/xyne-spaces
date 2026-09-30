import { BaseConnector } from '@xyne/workflow-sdk';
import type { AnyStep, AnyTrigger } from '@xyne/workflow-sdk';
import { TicketCreatedTrigger } from './triggers/ticket-created.trigger';
import { TicketUpdatedTrigger } from './triggers/ticket-updated.trigger';
import { CallTrigger } from './triggers/call.trigger';
import { UpdateTicketStep } from './steps/update-ticket.step';
import { SendMessageStep } from './steps/send-message.step';

export class XyneSpacesConnector extends BaseConnector {
  readonly id = 'xyne-spaces';
  readonly version = '1.0.0';
  readonly name = 'Xyne Spaces';
  readonly description = 'Triggers and actions for tickets, conversations and people';
  readonly icon = 'workflow';
  readonly credentials = [];

  readonly triggers: readonly AnyTrigger[] = [
    new TicketCreatedTrigger(),
    new TicketUpdatedTrigger(),
    new CallTrigger(),
  ];

  readonly steps: readonly AnyStep[] = [
    new SendMessageStep(),
    new UpdateTicketStep(),
  ];
}
