import { TicketStatusV2 } from '@xyne/shared';
import type { StageDefinition } from './stageTemplateTypes';

// Default stages template - all stages without ETA by default
const DEFAULT_STAGE_DEFINITIONS: StageDefinition[] = [
  {
    name: 'TODO',
    sequenceNumber: '1',
    defaultTicketStatusV2: TicketStatusV2.TODO,
  },
  {
    name: 'IN_PROGRESS',
    sequenceNumber: '2',
    defaultTicketStatusV2: TicketStatusV2.STARTED,
  },
  {
    name: 'IN_REVIEW',
    sequenceNumber: '3',
    defaultTicketStatusV2: TicketStatusV2.STARTED,
  },
  {
    name: 'READY_TO_MERGE',
    sequenceNumber: '4',
    defaultTicketStatusV2: TicketStatusV2.STARTED,
  },
  {
    name: 'ON_MERCHANT',
    sequenceNumber: '5',
    defaultTicketStatusV2: TicketStatusV2.PAUSED,
  },
  {
    name: 'ON_JUSPAY',
    sequenceNumber: '6',
    defaultTicketStatusV2: TicketStatusV2.PAUSED,
  },
  {
    name: 'ON_PG',
    sequenceNumber: '7',
    defaultTicketStatusV2: TicketStatusV2.PAUSED,
  },
  {
    name: 'CANCELLED',
    sequenceNumber: '8',
    defaultTicketStatusV2: TicketStatusV2.CANCELLED,
  },
  {
    name: 'COULD_NOT_REPRODUCE',
    sequenceNumber: '9',
    defaultTicketStatusV2: TicketStatusV2.CANCELLED,
  },
  {
    name: 'REJECTED',
    sequenceNumber: '10',
    defaultTicketStatusV2: TicketStatusV2.CANCELLED,
  },
  {
    name: 'DUPLICATE',
    sequenceNumber: '11',
    defaultTicketStatusV2: TicketStatusV2.CANCELLED,
  },
  {
    name: 'DONE',
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
