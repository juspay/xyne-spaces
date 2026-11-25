import { Stack } from 'expo-router';
import { ReactElement, useRef } from 'react';
import { View } from 'react-native';
import { useCSSVariable } from 'uniwind';

// Direct paths, not the conversation barrel: with the flag off nothing else of it loads.
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
  // The redesigned thread card; read once, as the thread route reads it, so a flag
  // change mid-session never splits the two. Its bubbles live in the root shell.
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
          // Only the redesigned thread is a card over the room; it animates itself.
          options={
            isThreadCard
              ? {
                  presentation: 'transparentModal',
                  animation: 'none',
                  contentStyle: { backgroundColor: 'transparent' },
                }
              : {}
          }
        />
        <Stack.Screen name='group-details/[groupId]' />
      </Stack>
    </View>
  );
};

export default ChatStackLayout;
