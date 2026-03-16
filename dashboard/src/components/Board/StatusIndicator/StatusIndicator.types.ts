import type { ReactElement } from 'react';
import { TicketStatusV2 } from '@xyne/shared';

export interface StatusIndicatorProps {
  status: TicketStatusV2;
  size?: number;
  stageIndex?: number | undefined;
  totalNonCancelledStages?: number | undefined;
}

export interface StatusOption {
  status: TicketStatusV2;
  label: string;
  icon: ReactElement;
}
