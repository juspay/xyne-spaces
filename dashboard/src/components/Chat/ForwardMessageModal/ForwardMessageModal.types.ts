import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';
import { VisibleChannel } from '../../../machines/stateMachine';
import { User } from '@xyne/shared';

export type MessageType = QueryResultType<typeof queries.conversationMessagesV2>[number];

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
