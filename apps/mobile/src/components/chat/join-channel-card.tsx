import { useCallback, useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { UserRoundPlus } from 'lucide-react-native';
import { v4 as uuidv4 } from 'uuid';
import { useCSSVariable } from 'uniwind';

import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';
import { cn } from '@/src/utils/cn';
import { useSelectedChatBubbleContentTokens } from '@/src/theme/useSelectedChatBubbleContentTokens';

type JoinChannelCardProps = {
  channelId: string;
  channelTitle?: string | undefined;
};

export function JoinChannelCard({ channelId, channelTitle }: JoinChannelCardProps): ReactElement {
  const zero = useZero();
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const {
    selectedBubbleBg,
    tokens: { rootTextUser },
  } = useSelectedChatBubbleContentTokens();
  const [isJoining, setIsJoining] = useState(false);

  const handleJoin = useCallback((): void => {
    if (!channelId || isJoining) return;

    setIsJoining(true);
    const mutation = zero.mutate(
      mutators.channel.joinChannel({
        channelId,
        channelParticipantId: uuidv4(),
        channelUserStatusId: uuidv4(),
        timestamp: Date.now(),
      }),
    );

    void mutation.client
      .catch(error => {
        const message = error instanceof Error ? error.message : 'Please try again.';
        Alert.alert('Could not join channel', message);
      })
      .finally(() => {
        setIsJoining(false);
      });
  }, [channelId, isJoining, zero]);

  return (
    <View className='px-3 pb-3'>
      <View className='rounded-2xl border border-border bg-card px-4 py-4 shadow-[0_1px_2px_0] shadow-black/5'>
        <View className='flex-row items-start gap-3'>
          <View className='size-10 items-center justify-center rounded-full bg-muted'>
            <UserRoundPlus size={20} color={foregroundColor} />
          </View>
          <View className='min-w-0 flex-1'>
            <Text className='text-base font-semibold text-foreground' numberOfLines={1}>
              {channelTitle ? `Join #${channelTitle}` : 'Join channel'}
            </Text>
            <Text className='mt-1 text-sm leading-5 text-secondary-foreground'>
              Join this channel to participate in conversations.
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Join channel'
          disabled={isJoining}
          onPress={handleJoin}
          className={cn(
            'mt-4 h-11 flex-row items-center justify-center gap-2 rounded-xl',
            isJoining && 'opacity-70',
          )}
          style={{ backgroundColor: selectedBubbleBg }}
        >
          {isJoining ? <ActivityIndicator size='small' color={rootTextUser} /> : null}
          <Text className='text-sm font-semibold' style={{ color: rootTextUser }}>
            {isJoining ? 'Joining...' : 'Join channel'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
