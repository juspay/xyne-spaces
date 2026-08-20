import type { ReactNode } from 'react';
import type { HistoryScopeMode } from '@xyne/shared';

export type AddPeopleStep = 'people' | 'history';

export interface AddPeopleContext {
  step: AddPeopleStep;
  isDirectConversation: boolean;
  joinsExistingConversation: boolean;
}

export interface AddPeopleFormProps {
  channelId: string;
  existingUserIds?: string[] | undefined;
  onSuccess?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  loading?: boolean | undefined;
  embedded?: boolean | undefined;
  onContextChange?: ((context: AddPeopleContext) => void) | undefined;
}

export interface AddPeopleDialogProps {
  channelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingUserIds?: string[] | undefined;
}

export interface HistoryScopeOption {
  mode: HistoryScopeMode;
  label: string;
  requiresDate?: boolean;
}

export interface PreviewAttachment {
  readonly id: string;
  readonly originalFilename?: string | null | undefined;
}

export interface PreviewMessage {
  readonly conversationId: string;
  readonly createdAt: number;
  readonly attachments?: readonly PreviewAttachment[] | undefined;
  readonly initialMessage?:
    | {
        readonly senderId?: string | null | undefined;
        readonly content?: string | null | undefined;
        readonly senderName?: string | null | undefined;
      }
    | null
    | undefined;
}

export interface PreviewGroup {
  key: string;
  label: string;
  items: readonly PreviewMessage[];
}

export interface AddPeopleHistoryStepProps {
  scopeMode: HistoryScopeMode;
  onScopeModeChange: (mode: HistoryScopeMode) => void;
  customDate: string;
  onCustomDateChange: (value: string) => void;
  cutoffChosen: boolean;
  joinsExistingConversation: boolean;
  previewGroups: PreviewGroup[];
  hasPreviewItems: boolean;
  embedded: boolean;
  dimmed: boolean;
  footer: ReactNode;
}
