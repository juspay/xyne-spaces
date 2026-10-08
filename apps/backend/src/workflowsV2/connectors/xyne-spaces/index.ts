import { BaseConnector } from '@xyne/workflow-sdk';
import type { AnyStep, AnyTrigger } from '@xyne/workflow-sdk';
import { TicketCreatedTrigger } from './triggers/ticket-created.trigger';
import { TicketUpdatedTrigger } from './triggers/ticket-updated.trigger';
import { CallTrigger } from './triggers/call.trigger';
import { UpdateTicketStep } from './steps/update-ticket.step';
import { SendMessageStep } from './steps/send-message.step';
import { ReplyOnMessageStep } from './steps/reply-on-message.step';
import { GetReleaseConfigurationStep } from './steps/get-release-configuration.step';
import { GetTicketStep } from './steps/get-ticket.step';
import { CreateTicketStep } from './steps/create-ticket.step';
import { AddTicketsUnderReleaseStep } from './steps/add-tickets-under-release.step';
import { AddChangeUnderReleaseStep } from './steps/add-change-under-release.step';
import { UpdateDeployedCommitStep } from './steps/update-deployed-commit.step';
import { CreateCanvasStep } from './steps/create-canvas.step';
import { LinkReleaseNotesStep } from './steps/link-release-notes.step';

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
    new ReplyOnMessageStep(),
    new GetReleaseConfigurationStep(),
    new GetTicketStep(),
    new CreateTicketStep(),
    new AddTicketsUnderReleaseStep(),
    new AddChangeUnderReleaseStep(),
    new UpdateDeployedCommitStep(),
    new CreateCanvasStep(),
    new LinkReleaseNotesStep(),
  ];
}
