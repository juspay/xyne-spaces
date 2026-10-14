import { Stack } from 'expo-router';

export default function XyneDesksLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name='index' />
      <Stack.Screen name='[channelId]' />
    </Stack>
  );
}
