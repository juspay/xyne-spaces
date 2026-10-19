import type { ReactElement } from 'react';
import {
  Bookmark,
  Copy,
  CornerUpLeft,
  Forward,
  Link,
  MessageCircleMore,
  Mic,
  Pin,
  SquareAsterisk,
  Ticket,
} from 'lucide-react';
import { PhoneDefault } from '@xyne/icons';
import { EditMessageIcon } from '../../../assets/icons';
import { XyneAIStar } from '../../icons/xyne-ai';
import { MESSAGE_BAR_ACTION_IDS, type MessageBarActionId } from '../../../constants/messageBar';

const MESSAGE_BAR_ACTION_META: Record<
  MessageBarActionId,
  { label: string; icon: ReactElement; hint?: string }
> = {
  reply: { label: 'Reply in thread', icon: <MessageCircleMore className='w-4 h-4' /> },
  createTicket: { label: 'Create ticket', icon: <Ticket className='w-4 h-4' /> },
  createSubTicket: {
    label: 'Create subticket',
    icon: <SquareAsterisk className='w-4 h-4' />,
    hint: 'In ticket channels',
  },
  call: {
    label: 'Start call',
    icon: <PhoneDefault className='w-4 h-4' />,
    hint: 'On the first message of a thread',
  },
  notes: {
    label: 'Take notes',
    icon: <Mic className='w-4 h-4' />,
    hint: 'On the first message of a thread',
  },
  askAI: { label: 'Ask AI', icon: <XyneAIStar size={16} /> },
  edit: {
    label: 'Edit message',
    icon: <EditMessageIcon className='w-4 h-4' />,
    hint: 'On your own messages',
  },
  sendToChannel: { label: 'Send to channel', icon: <CornerUpLeft className='w-4 h-4' /> },
  markUnread: {
    label: 'Mark as unread',
    icon: <div className='w-2.5 h-2.5 rounded-full border-2 border-current' />,
  },
  bookmark: { label: 'Bookmark', icon: <Bookmark className='w-4 h-4' /> },
  pin: { label: 'Pin message', icon: <Pin className='w-4 h-4' /> },
  copyLink: { label: 'Copy link', icon: <Link className='w-4 h-4' /> },
  copyMessage: { label: 'Copy message', icon: <Copy className='w-4 h-4' /> },
  forward: { label: 'Forward message', icon: <Forward className='w-4 h-4' /> },
};

export const MESSAGE_BAR_ACTIONS = MESSAGE_BAR_ACTION_IDS.map(id => ({
  id,
  ...MESSAGE_BAR_ACTION_META[id],
}));

export const MESSAGE_BAR_ICONS = Object.fromEntries(
  MESSAGE_BAR_ACTION_IDS.map(id => [id, MESSAGE_BAR_ACTION_META[id].icon]),
) as Record<MessageBarActionId, ReactElement>;
