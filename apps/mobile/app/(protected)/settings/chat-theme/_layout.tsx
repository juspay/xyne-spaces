import { Stack } from 'expo-router';
import type { ReactElement } from 'react';
import { useCSSVariable } from 'uniwind';

export default function ChatThemeLayout(): ReactElement {
  const stackContentBackground = useCSSVariable('--color-background') as string;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: stackContentBackground,
        },
      }}
    >
      <Stack.Screen name='index' />
      <Stack.Screen name='chat-bubble' />
      <Stack.Screen name='chat-bubble-preview' />
    </Stack>
  );
}
