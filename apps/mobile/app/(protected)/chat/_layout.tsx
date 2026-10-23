import { Stack } from 'expo-router';
import { ReactElement } from 'react';
import { View } from 'react-native';
import { useCSSVariable } from 'uniwind';

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

  return (
    <View style={{ flex: 1, backgroundColor }}>
      <Stack
        screenOptions={({ route }) => ({
          headerShown: false,
          contentStyle: { backgroundColor },
          ...(isExternalChatOpen(route.params) ? { animation: 'none' as const } : {}),
        })}
      >
        <Stack.Screen name='group-details/[groupId]' />
      </Stack>
    </View>
  );
};

export default ChatStackLayout;
