import { type ReactElement, useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSegments } from 'expo-router';
import { useCSSVariable } from 'uniwind';

import { useTabBarHeight } from '@/src/hooks/useTabBarHeight';
import { isOnTabShell } from '@/src/navigation/routes';

const LOADING_LABEL_BY_SEGMENT: Record<string, string> = {
  canvas: 'Loading canvas',
  bookmarks: 'Loading bookmarks',
  rca: 'Loading RCA',
  call: 'Loading call',
  'channel-canvas': 'Loading canvas',
};

type DashboardWebViewLoaderProps = {
  label?: string;
  bottomInset?: number;
  absolute?: boolean;
};

function useDashboardWebViewLoaderColors() {
  return {
    backgroundColor: (useCSSVariable('--color-background') as string) || '#FFFFFF',
    foregroundColor: (useCSSVariable('--color-foreground') as string) || '#111827',
    mutedColor: (useCSSVariable('--color-muted-foreground') as string) || '#6B7280',
    brandColor: (useCSSVariable('--color-brand') as string) || '#16A34A',
  };
}

export function getDashboardWebViewLoadingLabel(segments: string[]): string {
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i];
    if (segment && LOADING_LABEL_BY_SEGMENT[segment]) {
      return LOADING_LABEL_BY_SEGMENT[segment];
    }
  }

  return 'Loading workspace';
}

export function DashboardWebViewLoader({
  label = 'Loading workspace',
  bottomInset = 0,
  absolute = false,
}: DashboardWebViewLoaderProps): ReactElement {
  const { backgroundColor, foregroundColor, mutedColor, brandColor } =
    useDashboardWebViewLoaderColors();

  return (
    <View
      accessibilityLabel={label}
      accessibilityRole='progressbar'
      pointerEvents='auto'
      style={[
        absolute ? StyleSheet.absoluteFill : styles.fill,
        styles.container,
        {
          backgroundColor,
          bottom: absolute ? bottomInset : undefined,
        },
      ]}
    >
      <ActivityIndicator size='large' color={brandColor} />
      <Text numberOfLines={1} style={[styles.title, { color: foregroundColor }]}>
        {label}
      </Text>
      <Text numberOfLines={1} style={[styles.subtitle, { color: mutedColor }]}>
        Preparing the workspace view
      </Text>
    </View>
  );
}

export function DashboardWebViewRouteLoader(): ReactElement {
  const segments = useSegments();
  const { tabBarHeight } = useTabBarHeight();
  const isInsideTabs = isOnTabShell(segments as string[]);
  const bottomInset = isInsideTabs ? tabBarHeight : 0;
  const label = useMemo(() => getDashboardWebViewLoadingLabel(segments as string[]), [segments]);

  return <DashboardWebViewLoader absolute bottomInset={bottomInset} label={label} />;
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  container: {
    alignItems: 'center',
    elevation: 45,
    justifyContent: 'center',
    left: 0,
    paddingHorizontal: 28,
    right: 0,
    top: 0,
    zIndex: 45,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
    marginTop: 18,
    maxWidth: 260,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
    marginTop: 4,
    maxWidth: 260,
    textAlign: 'center',
  },
});
