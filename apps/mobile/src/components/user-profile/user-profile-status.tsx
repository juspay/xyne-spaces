import { memo, useState, type ReactElement } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { Pressable, Text, View } from 'react-native';
import { SmilePlus, X } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';
import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
import { useClearOwnStatus } from '@/src/hooks/useClearOwnStatus';
import { Event, logger } from '@/src/utils/logger';
import {
  getActiveUserStatusContent,
  getActiveUserStatusEmoji,
  hasActiveCustomStatus,
} from '@/src/utils/statusUtils';
import { showMessageToast } from '@/src/utils/toast';
import { useUserProfile } from './user-profile-context';
import { UpdateStatusSheet } from './update-status-sheet';

type StatusProps = {
  className?: string;
};

const Status = memo(({ className }: StatusProps): ReactElement | null => {
  const { user, isOwnProfile } = useUserProfile();
  const clearOwnStatus = useClearOwnStatus();
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  const [isStatusSheetOpen, setIsStatusSheetOpen] = useState(false);
  if (!user) return null;

  const statusEmoji = getActiveUserStatusEmoji(user);
  const statusContent = getActiveUserStatusContent(user);
  const hasCustomStatus = hasActiveCustomStatus(user);
  const clearCustomStatus = (): void => {
    try {
      clearOwnStatus();
      showMessageToast('Status cleared', 'success');
    } catch (err) {
      logger.error(Event.ZERO_MUTATION_ERROR, {
        context: 'UserProfile.Status',
        action: 'clear_status',
        error: err,
      });
    }
  };
  const handleClearStatusPress = (event: GestureResponderEvent): void => {
    event.stopPropagation();
    clearCustomStatus();
  };

  return (
    <View className={cn('items-center gap-2', className)}>
      {/* No presence text here — the dot on the avatar already conveys online state. */}
      {isOwnProfile ? (
        <Pressable
          onPress={() => {
            void haptics.buttonTap();
            setIsStatusSheetOpen(true);
          }}
          className='mt-1 w-full flex-row items-center gap-2 rounded-2xl bg-settings-section-bg px-3 py-2.5'
        >
          {hasCustomStatus && statusEmoji ? (
            <ReactionEmojiDisplay emojiName={statusEmoji} size={16} />
          ) : (
            <SmilePlus size={16} color={descriptionColor} />
          )}
          <Text className='flex-1 text-sm' style={{ color: labelColor }} numberOfLines={1}>
            {hasCustomStatus ? statusContent || 'Status updated' : 'Set a status'}
          </Text>
          {hasCustomStatus ? (
            <Pressable
              onPress={event => {
                void haptics.warning();
                handleClearStatusPress(event);
              }}
            >
              <X size={16} color={descriptionColor} />
            </Pressable>
          ) : null}
        </Pressable>
      ) : hasCustomStatus ? (
        <View className='flex-row items-center justify-center gap-2'>
          {statusEmoji ? <ReactionEmojiDisplay emojiName={statusEmoji} /> : null}
          {statusContent ? (
            <Text className='text-sm' style={{ color: labelColor }} numberOfLines={1}>
              {statusContent}
            </Text>
          ) : null}
        </View>
      ) : null}

      {isOwnProfile ? (
        <UpdateStatusSheet
          isOpen={isStatusSheetOpen}
          onOpenChange={setIsStatusSheetOpen}
          currentStatus={
            hasCustomStatus
              ? {
                  emoji: statusEmoji ?? null,
                  content: statusContent ?? null,
                  expiryAt: user.statusExpiryAt ?? null,
                }
              : null
          }
        />
      ) : null}
    </View>
  );
});
Status.displayName = 'UserProfile.Status';

export { Status };
