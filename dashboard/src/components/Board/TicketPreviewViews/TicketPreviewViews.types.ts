import type { TicketStatusV2, TicketPriority, FieldEnumOption } from '@xyne/shared';

export interface Tag {
  name: string;
  color?: string;
}

export interface TicketPreviewProps {
  boardId?: string;
  board?: {
    title: string;
    description?: string;
  };
  ticket?: {
    title: string;
    description: string;
    status?: string;
    statusV2?: TicketStatusV2;
    priority?: TicketPriority;
    assignee?: string;
    assigneeAvatar?: string;
    dueDate?: string;
    createdAt?: string;
    createdBy?: string;
    channel?: string;
    tags?: Tag[] | string[];
    tagMappings?: { tagName: string }[];
    userGroup?: string;
  };
  onClose?: () => void;
}

export interface PreviewField {
  id: string;
  label: string;
  type: string;
  options?: readonly FieldEnumOption[] | undefined;
  required?: boolean;
}

export interface CreateField {
  id: string;
  name: string;
  label: string;
  type: string;
  required: boolean;
  order: number;
  visibleInCreate: boolean;
  options?: readonly FieldEnumOption[] | undefined;
}

export interface TicketPreviewContentProps {
  ticket?: TicketPreviewProps['ticket'];
  boardId?: string;
  fields?: PreviewField[];
}

export interface CreateTicketModalProps {
  boardId?: string;
  fields?: CreateField[];
}
