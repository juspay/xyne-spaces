import {
  Bookmark,
  BookmarkMinus,
  Copy,
  CornerUpLeft,
  Edit,
  AlarmClock,
  Headphones,
  Link as LinkIcon,
  MessageCircleMore,
  Pin,
  PinOff,
  RotateCcw,
  Trash2,
} from 'lucide-react-native';
import { type ReactElement, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { TurnUpRightIcon } from '@/src/components/icons';
import type { MessageRowModel } from '../model/chatRow.types';
import type { MessageActionId } from './actionVisibility';

const RED = '#dc2626';

export const isDestructive = (id: MessageActionId): boolean =>
  id === 'pending-delete' || id === 'delete';

export const actionLabel = (id: MessageActionId, model: MessageRowModel): string => {
  switch (id) {
    case 'pending-retry':
      return 'Retry Send';
    case 'pending-delete':
    case 'delete':
      return 'Delete Message';
    case 'reply-in-thread':
      return 'Reply in Thread';
    case 'send-to-channel':
      return 'Send to Channel';
    case 'edit-in-chat':
      return 'Edit in Chat';
    case 'copy-message':
      return 'Copy Message';
    case 'copy-link':
      return 'Copy Link';
    case 'forward-message':
      return 'Forward Message';
    case 'copy-image':
      return 'Copy Image';
    case 'pin':
      return model.isPinned ? 'Unpin Message' : 'Pin Message';
    case 'bookmark':
      return model.isBookmarked ? 'Remove Bookmark' : 'Add Bookmark';
    case 'remind-me':
      return 'Remind me';
    case 'start-call':
      return 'Start Call';
    case 'mark-as-unread':
      return 'Mark as Unread';
  }
};

export const actionIcon = (
  id: MessageActionId,
  model: MessageRowModel,
  foreground: string,
): ReactNode => {
  const color = isDestructive(id) ? RED : foreground;
  switch (id) {
    case 'pending-retry':
      return <RotateCcw size={20} color={color} />;
    case 'pending-delete':
    case 'delete':
      return <Trash2 size={20} color={color} />;
    case 'reply-in-thread':
      return <MessageCircleMore size={20} color={color} />;
    case 'send-to-channel':
      return <CornerUpLeft size={20} color={color} />;
    case 'edit-in-chat':
      return <Edit size={20} color={color} />;
    case 'copy-message':
    case 'copy-image':
      return <Copy size={20} color={color} />;
    case 'copy-link':
      return <LinkIcon size={20} color={color} />;
    case 'forward-message':
      return <TurnUpRightIcon color={color} />;
    case 'pin':
      return model.isPinned ? <PinOff size={20} color={color} /> : <Pin size={20} color={color} />;
    case 'bookmark':
      return model.isBookmarked ? (
        <BookmarkMinus size={20} color={color} />
      ) : (
        <Bookmark size={20} color={color} />
      );
    case 'remind-me':
      return <AlarmClock size={20} color={color} />;
    case 'start-call':
      return <Headphones size={20} color={color} />;
    case 'mark-as-unread':
      return (
        <View className='h-5 w-5 items-center justify-center'>
          <View className='h-3 w-3 rounded-full border-2' style={{ borderColor: foreground }} />
        </View>
      );
  }
};

export function ActionRow({
  id,
  model,
  foreground,
  onPress,
}: {
  id: MessageActionId;
  model: MessageRowModel;
  foreground: string;
  onPress: () => void;
}): ReactElement {
  const label = actionLabel(id, model);
  const destructive = isDestructive(id);
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      className={`w-full flex-row items-center gap-4 px-5 py-4 ${destructive ? 'active:bg-red-50 dark:active:bg-red-900/10' : 'active:bg-accent'}`}
      onPress={onPress}
    >
      <View className='h-6 w-6 shrink-0 items-center justify-center'>
        {actionIcon(id, model, foreground)}
      </View>
      <Text
        className={`text-base ${destructive ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
