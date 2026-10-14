import { type ReactElement } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';

/**
 * Call screen: full-screen WebView loading /call/[callId] from the dashboard.
 * Call screen: full-screen WebView loading call grid from the dashboard.
 * This route is OUTSIDE the tabs group, so the tab bar is hidden.
 * The actual call UI is rendered by the DashboardWebViewHost via resolveDashboardWebViewTarget.
 */
const CallScreen = (): ReactElement => {
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />
    </View>
  );
};

export default CallScreen;
