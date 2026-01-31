import { TicketStatusV2 } from '@xyne/shared';
import type { StageDefinition } from './stageTemplateTypes';

// Default stages template
const DEFAULT_STAGE_DEFINITIONS: StageDefinition[] = [
  {
    name: 'TODO',
    eta: '1',
    sequenceNumber: '1',
    defaultTicketStatusV2: TicketStatusV2.TODO,
  },
  {
    name: 'IN_PROGRESS',
    eta: '1',
    sequenceNumber: '2',
    defaultTicketStatusV2: TicketStatusV2.STARTED,
  },
  {
    name: 'IN_REVIEW',
    eta: '1',
    sequenceNumber: '3',
    defaultTicketStatusV2: TicketStatusV2.STARTED,
  },
  {
    name: 'READY_TO_MERGE',
    eta: '1',
    sequenceNumber: '4',
    defaultTicketStatusV2: TicketStatusV2.STARTED,
  },
  {
    name: 'ON_MERCHANT',
    eta: '1',
    sequenceNumber: '5',
    defaultTicketStatusV2: TicketStatusV2.PAUSED,
  },
  {
    name: 'ON_JUSPAY',
    eta: '1',
    sequenceNumber: '6',
    defaultTicketStatusV2: TicketStatusV2.PAUSED,
  },
  {
    name: 'ON_PG',
    eta: '1',
    sequenceNumber: '7',
    defaultTicketStatusV2: TicketStatusV2.PAUSED,
  },
  {
    name: 'CANCELLED',
    eta: '1',
    sequenceNumber: '8',
    defaultTicketStatusV2: TicketStatusV2.CANCELLED,
  },
  {
    name: 'COULD_NOT_REPRODUCE',
    eta: '1',
    sequenceNumber: '9',
    defaultTicketStatusV2: TicketStatusV2.CANCELLED,
  },
  {
    name: 'REJECTED',
    eta: '1',
    sequenceNumber: '10',
    defaultTicketStatusV2: TicketStatusV2.CANCELLED,
  },
  {
    name: 'DUPLICATE',
    eta: '1',
    sequenceNumber: '11',
    defaultTicketStatusV2: TicketStatusV2.CANCELLED,
  },
  {
    name: 'DONE',
    eta: '1',
    sequenceNumber: '12',
    defaultTicketStatusV2: TicketStatusV2.COMPLETED,
  },
];

// Default Stages Template - just the definitions, no metadata
export const DEFAULT_STAGES_TEMPLATE = {
  definitions: DEFAULT_STAGE_DEFINITIONS,
};

// Export for backward compatibility
export { DEFAULT_STAGE_DEFINITIONS };
