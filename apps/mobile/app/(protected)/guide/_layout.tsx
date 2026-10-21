import { Stack } from 'expo-router';
import type { ReactElement } from 'react';

export default function GuideLayout(): ReactElement {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name='index' options={{ title: 'User guide' }} />
      <Stack.Screen name='topic/[categoryId]' options={{ title: 'Topic' }} />
      <Stack.Screen name='[guideId]' options={{ title: 'Guide' }} />
    </Stack>
  );
}
