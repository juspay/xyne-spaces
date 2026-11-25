import { BaseConnector } from '@xyne/workflow-sdk';
import type { AnyStep, AnyTrigger } from '@xyne/workflow-sdk';
import { TicketCreatedTrigger } from './triggers/ticket-created.trigger';
import { ReplyOnMessageStep } from './steps/reply-on-message.step';
import { GetTicketStep } from './steps/get-ticket.step';
import { CreateTicketStep } from './steps/create-ticket.step';
import { CreateCanvasStep } from './steps/create-canvas.step';

export class XyneSpacesConnector extends BaseConnector {
  readonly id = 'xyne-spaces';
  readonly version = '1.0.0';
  readonly name = 'Xyne Spaces';
  readonly description = 'Triggers and actions for tickets, conversations and canvases';
  readonly icon = 'workflow';
  readonly credentials = [];

  readonly triggers: readonly AnyTrigger[] = [new TicketCreatedTrigger()];

  readonly steps: readonly AnyStep[] = [
    new ReplyOnMessageStep(),
    new GetTicketStep(),
    new CreateTicketStep(),
    new CreateCanvasStep(),
  ];
}
