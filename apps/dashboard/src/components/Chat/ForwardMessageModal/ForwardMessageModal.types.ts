import { ChannelScopeType } from '@xyne/shared';
import { MessageWithOptionalNudgeCounts } from '../../ui/MessageBubble/MessageBubble.types';

export type MessageType = MessageWithOptionalNudgeCounts;

export interface ForwardTarget {
  type: 'channel' | 'user' | 'group_dm';
  id: string;
  name: string;
  /** Member IDs of the GROUP_DM (excluding current user). Only set when type === 'group_dm'. */
  memberIds?: string[];
}

export interface ForwardMessageFormProps {
  message: MessageType;
  channelId: string;
  channelScopeType?: ChannelScopeType | undefined;
  onCancel: () => void;
  onSuccess?: () => void;
}

/** Selection mode determines what type of targets can be selected */
export type SelectionMode = 'none' | 'channel' | 'users' | 'group_dm';
