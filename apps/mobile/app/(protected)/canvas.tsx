import { type ReactElement } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';

/**
 * Dashboard canvas WebView host. The native shell is a placeholder; content is
 * rendered by DashboardWebViewShell at /chat/canvas/:canvasId.
 */
const DashboardCanvasScreen = (): ReactElement => {
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />
    </View>
  );
};

export default DashboardCanvasScreen;
