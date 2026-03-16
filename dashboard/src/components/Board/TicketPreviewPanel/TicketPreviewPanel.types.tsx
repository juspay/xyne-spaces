import { ReactElement } from 'react';

export type PreviewMode = 'ticket' | 'create';

export interface TicketPreviewPanelProps {
  onClose: () => void;
  /** Custom content for the ticket preview mode */
  ticketPreviewContent: ReactElement;
  /** Custom content for the create ticket mode */
  createTicketContent: ReactElement;
  /** Track category for analytics */
  trackCategory?: string;
}
