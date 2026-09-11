import type { User, UserGroup } from '../../../machines/stateMachine';
import type { TicketStatusV2, TicketPriority } from '@xyne/shared';

export type ActiveMenu = 'assignee' | 'status' | 'priority' | 'stage' | 'dueDate' | 'tags' | null;

export interface EntityOption {
  value: string;
  label: string;
  icon: React.ReactNode;
  isDeactivated?: boolean;
}

export interface StatusEntityOption extends EntityOption {
  bgColor: string;
  textColor: string;
}

export interface StageOptionSource {
  id: string;
  name: string;
  defaultTicketStatusV2?: string | null;
}

export interface GenericCellEditorProps {
  value: string | null;
  onValueChange: (value: string | null) => void;
  stopEditing?: (() => void) | undefined;
  options: EntityOption[];
  placeholder?: string;
  searchPlaceholder?: string;
}

export interface AssigneeCellEditorProps {
  value: string | null;
  onValueChange: (value: string | null) => void;
  stopEditing?: () => void;
  users: User[];
  userGroups?: UserGroup[];
}

export interface StatusCellEditorProps {
  value: TicketStatusV2;
  onValueChange: (value: TicketStatusV2) => void;
  stopEditing?: () => void;
}

export interface PriorityCellEditorProps {
  value: TicketPriority | null;
  onValueChange: (value: TicketPriority | null) => void;
  stopEditing?: () => void;
}

export interface StageCellEditorProps {
  value: string;
  onValueChange: (value: string) => void;
  stopEditing?: () => void;
  stages?: StageOptionSource[];
  data?: { boardId?: string | null } | undefined;
}

export interface DueDateCellEditorProps {
  value: number | null;
  onValueChange: (value: number | null) => void;
}

export interface TagsCellEditorProps {
  value: string[] | undefined;
  onValueChange: (value: string[]) => void;
  stopEditing: () => void;
  availableTags: string[];
}
