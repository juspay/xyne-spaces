import { Stack } from 'expo-router';
import type { ReactElement } from 'react';

export default function SettingsLayout(): ReactElement {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name='index' options={{ title: 'Settings' }} />
      <Stack.Screen name='theme' options={{ title: 'Theme' }} />
      <Stack.Screen name='online-status' options={{ title: 'Online status' }} />
      <Stack.Screen name='availability' options={{ title: 'Availability' }} />
      <Stack.Screen name='profile-photo' options={{ title: 'Profile photo' }} />
      <Stack.Screen name='status' options={{ title: 'Set status' }} />
      <Stack.Screen name='chat-theme' options={{ title: 'Chat theme' }} />
      <Stack.Screen name='developers' options={{ title: 'Developers' }} />
      <Stack.Screen name='join-requests' options={{ title: 'Workspace join requests' }} />
      <Stack.Screen name='notifications/index' options={{ title: 'Notifications' }} />
      <Stack.Screen
        name='notifications/preferences'
        options={{ title: 'Notification Preferences' }}
      />
      <Stack.Screen name='notifications/sound' options={{ title: 'Sound' }} />
      <Stack.Screen name='notifications/pause' options={{ title: 'Pause Notifications' }} />
      <Stack.Screen name='beta' options={{ title: 'Beta' }} />
    </Stack>
  );
}
