import { TicketStatusV2 } from '@xyne/shared';
import { ReactElement } from 'react';

export interface StageDefinition {
  name: string;
  eta?: string;
  sequenceNumber: string;
  defaultTicketStatusV2: TicketStatusV2;
}

export interface StageMetadata {
  isManaged: boolean;
  badgeLabel?: string;
  badgeIcon?: ReactElement;
}

export interface StageTemplateMetadata {
  templateType: string;
  isManaged: boolean; // Whether stages from this template are read-only (all stages in template share this)
  getStageMetadata: (stageName: string) => StageMetadata; // Function to get per-stage metadata (badge, etc.)
}
