import { VisibleChannel } from '../../../machines/stateMachine';
import { User } from '@xyne/shared';
import type { RefObject } from 'react';
import { MessageWithOptionalNudgeCounts } from '../../ui/MessageBubble/MessageBubble.types';

export type MessageType = MessageWithOptionalNudgeCounts;

export interface ForwardTarget {
  type: 'channel' | 'user';
  id: string;
  name: string;
}

export interface ForwardMessageFormProps {
  message: MessageType;
  channelId: string;
  onCancel: () => void;
  onSuccess?: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export interface SearchResultItem {
  type: 'channel' | 'user';
  id: string;
  name: string;
  description?: string | null;
  channel?: VisibleChannel;
  user?: User;
}

/** Selection mode determines what type of targets can be selected */
export type SelectionMode = 'none' | 'channel' | 'users';
