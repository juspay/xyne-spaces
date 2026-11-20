import { BaseConnector } from '@xyne/workflow-sdk';
import type { AnyStep, AnyTrigger } from '@xyne/workflow-sdk';
import { TicketCreatedTrigger } from './triggers/ticket-created.trigger';

export class XyneSpacesConnector extends BaseConnector {
  readonly id = 'xyne-spaces';
  readonly version = '1.0.0';
  readonly name = 'Xyne Spaces';
  readonly description = 'Triggers for tickets';
  readonly icon = 'workflow';
  readonly credentials = [];

  readonly triggers: readonly AnyTrigger[] = [new TicketCreatedTrigger()];

  readonly steps: readonly AnyStep[] = [];
}
