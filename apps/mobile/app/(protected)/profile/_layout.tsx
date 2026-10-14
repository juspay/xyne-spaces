import { Stack } from 'expo-router';
import type { ReactElement } from 'react';

export default function ProfileLayout(): ReactElement {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name='index' />
      <Stack.Screen name='[id]' />
    </Stack>
  );
}
