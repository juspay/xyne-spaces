import { Stack } from 'expo-router';
import { ReactElement, useRef } from 'react';
import { View } from 'react-native';
import { useCSSVariable } from 'uniwind';

// Direct paths, not the conversation barrel: with the flag off nothing else of it loads.
import { BubbleHost } from '@/src/features/conversation/components/bubbles/bubble-host';
import { isConversationThreadCard } from '@/src/features/conversation/flag';

// A deep link to a nested chat route must return through the channel chat screen,
// never an inferred sibling such as Channel Details.
// eslint-disable-next-line @typescript-eslint/naming-convention
export const unstable_settings = { anchor: '[channelId]' };

const isExternalChatOpen = (params: unknown): boolean => {
  if (!params || typeof params !== 'object') return false;
  const routeParams = params as { source?: unknown; from?: unknown };
  const source = routeParams.source ?? routeParams.from;
  return source === 'notification' || source === 'activity' || source === 'deeplink';
};

const ChatStackLayout = (): ReactElement => {
  const backgroundColor = useCSSVariable('--color-background') as string;
  // The redesigned thread card, and the parked-thread bubbles that belong to it; read once,
  // as the thread route reads it, so a flag change mid-session never splits the two.
  const isThreadCard = useRef(isConversationThreadCard()).current;

  return (
    <View style={{ flex: 1, backgroundColor }}>
      <Stack
        screenOptions={({ route }) => ({
          headerShown: false,
          contentStyle: { backgroundColor },
          ...(isExternalChatOpen(route.params) ? { animation: 'none' as const } : {}),
        })}
      >
        <Stack.Screen
          name='[channelId]/[threadId]'
          options={({ route }) =>
            // Only the redesigned thread is a card over the room.
            isThreadCard
              ? {
                  presentation: 'transparentModal',
                  animation: isExternalChatOpen(route.params) ? 'none' : 'slide_from_bottom',
                  contentStyle: { backgroundColor: 'transparent' },
                }
              : {}
          }
        />
        <Stack.Screen name='group-details/[groupId]' />
      </Stack>
      {isThreadCard ? <BubbleHost /> : null}
    </View>
  );
};

export default ChatStackLayout;
