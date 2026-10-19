import { type ReactElement } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';

/**
 * Canvas screen: full-screen WebView loading /chat/canvas from the dashboard.
 * This route is OUTSIDE the tabs group, so the tab bar is hidden.
 */
const CanvasScreen = (): ReactElement => {
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

export default CanvasScreen;
