import { useAuth } from '../../../hooks/useAuth';
import { EmojiPickerEmoji } from '../../../hooks/useCustomEmojis';

export interface MobileAddReactionDrawerProps {
  messageId: string;
  user: ReturnType<typeof useAuth>['user'];
  reactionsMd: string | null | undefined;
  toggleReaction: (params: { messageId: string; emoji: string; hasReacted: boolean }) => void;
  customEmojis: EmojiPickerEmoji[] | undefined;
}
