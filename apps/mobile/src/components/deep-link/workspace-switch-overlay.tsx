import type { ReactElement } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

/**
 * Covers the app while a deep link enters another workspace.
 *
 * A workspace switch tears down and rebuilds the session (new token, new Zero
 * client, remounted stores), so without this the user watches the previous
 * workspace's screens flicker through an empty state before the link opens. Holding
 * a single surface across the switch makes it read as one transition.
 */
export function WorkspaceSwitchOverlay({ workspaceName }: { workspaceName: string }): ReactElement {
  return (
    <View className='absolute inset-0 z-10000 items-center justify-center gap-4 bg-background px-8'>
      <ActivityIndicator size='large' />
      <Text className='text-center text-base text-foreground'>
        {workspaceName ? `Switching to ${workspaceName}…` : 'Switching workspace…'}
      </Text>
    </View>
  );
}
