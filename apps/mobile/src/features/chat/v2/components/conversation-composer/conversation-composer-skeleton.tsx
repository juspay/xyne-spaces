import { useEffect, type ReactElement } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useSelectedChatBubbleContentTokens } from '@/src/theme/useSelectedChatBubbleContentTokens';

const AVATAR_SIZE = 24;

type SkeletonRowProps = {
  side: 'left' | 'right';
  showAvatar: boolean;
  bubbleWidthPct: number;
  showUsername: boolean;
  contentLines: { widthPct: number }[];
  /** Outgoing bubble fill, resolved once by the parent. */
  selfBubbleBg: string;
};

const SkeletonRow = ({
  side,
  showAvatar,
  bubbleWidthPct,
  showUsername,
  contentLines,
  selfBubbleBg,
}: SkeletonRowProps): ReactElement => {
  const justify = side === 'right' ? 'justify-end' : 'justify-start';
  // Incoming bubbles are a neutral surface token, so the class is right for them.
  // Outgoing ones must track the user's chosen bubble, which is a runtime setting
  // — the `-root-bg-user` token is pinned to --color-chat-message-bubble-2 and so
  // showed the default green whatever the user had picked.
  const bubbleBg = side === 'right' ? '' : 'bg-conversation-composer-root-bg-other';

  return (
    <View className={`py-1 flex-row items-end gap-2 ${justify}`}>
      {side === 'left' ? (
        showAvatar ? (
          <View
            className='bg-foreground/10'
            style={{
              width: AVATAR_SIZE,
              height: AVATAR_SIZE,
              borderRadius: AVATAR_SIZE / 2,
            }}
          />
        ) : (
          <View style={{ width: AVATAR_SIZE }} />
        )
      ) : null}

      <View
        className={`rounded-xl px-2 py-1.5 ${bubbleBg}`}
        style={{
          width: `${bubbleWidthPct}%`,
          ...(side === 'right' ? { backgroundColor: selfBubbleBg } : {}),
        }}
      >
        {showUsername ? <View className='mb-2 h-3 w-20 rounded-md bg-foreground/15' /> : null}
        <View className='gap-1.5'>
          {contentLines.map((line, idx) => (
            <View
              key={idx}
              className='h-3 rounded-md bg-foreground/10'
              style={{ width: `${line.widthPct}%` }}
            />
          ))}
        </View>
      </View>
    </View>
  );
};

const ConversationSkeleton = (): ReactElement => {
  // Resolved once here rather than in SkeletonRow: this block is rendered four
  // times over, so the hook would otherwise run for all twelve fake messages.
  const { selectedBubbleBg } = useSelectedChatBubbleContentTokens();
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.55, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View style={animatedStyle} accessibilityLabel='Loading older messages'>
      <SkeletonRow
        side='left'
        showAvatar
        bubbleWidthPct={62}
        showUsername
        contentLines={[{ widthPct: 90 }, { widthPct: 65 }]}
        selfBubbleBg={selectedBubbleBg}
      />
      <SkeletonRow
        side='right'
        showAvatar={false}
        bubbleWidthPct={48}
        showUsername={false}
        contentLines={[{ widthPct: 80 }]}
        selfBubbleBg={selectedBubbleBg}
      />
      <SkeletonRow
        side='left'
        showAvatar
        bubbleWidthPct={55}
        showUsername
        contentLines={[{ widthPct: 70 }]}
        selfBubbleBg={selectedBubbleBg}
      />
    </Animated.View>
  );
};
ConversationSkeleton.displayName = 'ConversationSkeleton';

export { ConversationSkeleton };
