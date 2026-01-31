import { Conversation, TicketPriority } from '@xyne/shared';
import { getPriorityIcon } from '../TicketCard/TicketCard.utils';
import { CreateTicketFormData } from './CreateTicketModal';

export const DUPLICATE_REASON_TRUNCATE_LENGTH = 140;

export const TAG_COLORS = [
  'bg-cyan-600',
  'bg-yellow-600',
  'bg-purple-600',
  'bg-green-600',
  'bg-pink-600',
  'bg-blue-600',
];

export const getPriorityOptions = () => [
  { label: 'Low', value: 'LOW', icon: getPriorityIcon(TicketPriority.LOW) },
  { label: 'Medium', value: 'MEDIUM', icon: getPriorityIcon(TicketPriority.MEDIUM) },
  { label: 'High', value: 'HIGH', icon: getPriorityIcon(TicketPriority.HIGH) },
  { label: 'Critical', value: 'CRITICAL', icon: getPriorityIcon(TicketPriority.CRITICAL) },
];

// Parse assignee with type
export const parseAssignee = (value: string | null): CreateTicketFormData['assignee'] => {
  if (!value) return null;
  const [type, id] = value.split(':');
  if (!id) return null;
  return type === 'user' ? { type: 'assigneeTo', value: id } : { type: 'userGroup', value: id };
};

// Get source id
export function getSourceId(
  sourceConversation: Conversation | undefined,
  tab: string | null,
  channelId: string,
): string {
  if (sourceConversation?.conversationId) {
    return sourceConversation.conversationId;
  }

  if (tab === 'tickets') {
    return `${channelId}-tickets`;
  }

  return channelId;
}
