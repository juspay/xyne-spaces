import type { DependencyState } from '@xyne/shared';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';
import type { DependencyBatch } from '../../../services/dependencies/types';

export interface DependencyBadgeProps {
  state: DependencyState;
  compact?: boolean;
}
export interface DependencyHoverCardProps {
  ticketId: string;
  batch: DependencyBatch;
  onOpen?: (ticketId: string) => void;
}
export interface DependencyPanelProps {
  ticketId: string;
  ticketOptions: SelectorOption[];
  linkedTicketIds?: readonly string[];
  onOpen?: (ticketId: string) => void;
}
