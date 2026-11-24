import { memo, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Wifi, WifiOff } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import type { OfflineBannerViewProps } from '@/src/components/chat/offline-composer-banner';

import {
  OFFLINE_BANNER_GAP,
  OFFLINE_BANNER_HIT_SLOP,
  OFFLINE_BANNER_ICON_SIZE,
  OFFLINE_BANNER_INSET_X,
  OFFLINE_BANNER_MARGIN_BOTTOM,
  OFFLINE_BANNER_PADDING_X,
  OFFLINE_BANNER_PADDING_Y,
  OFFLINE_BANNER_RADIUS,
} from '../constants';
import { colorOf } from '../model/token-color';

const BANNER_STYLE = {
  marginHorizontal: OFFLINE_BANNER_INSET_X,
  marginBottom: OFFLINE_BANNER_MARGIN_BOTTOM,
  borderRadius: OFFLINE_BANNER_RADIUS,
  paddingHorizontal: OFFLINE_BANNER_PADDING_X,
  paddingVertical: OFFLINE_BANNER_PADDING_Y,
  columnGap: OFFLINE_BANNER_GAP,
} as const;

/**
 * The offline banner over the room's typing bar (Figma draws none): a quiet
 * surface card on the bar's sides, the classic copy in Body/Small, and a
 * "Reconnect" text button; once back, a short "Connected" in the positive colour.
 */
export const RoomOfflineBanner = memo(function RoomOfflineBanner({
  status,
  message,
  isReconnecting,
  onReconnect,
}: OfflineBannerViewProps): ReactElement {
  const muted = colorOf(useCSSVariable('--color-spaces-muted'));
  const positive = colorOf(useCSSVariable('--color-spaces-positive'));

  if (status === 'reconnected') {
    return (
      <View
        className='flex-row items-center bg-spaces-surface'
        style={BANNER_STYLE}
        accessibilityLiveRegion='polite'
      >
        <Wifi size={OFFLINE_BANNER_ICON_SIZE} color={positive} />
        <Text className='text-[14px] leading-5 tracking-[-0.14px] text-spaces-positive'>
          Connected
        </Text>
      </View>
    );
  }

  return (
    <View
      className='flex-row items-center bg-spaces-surface'
      style={BANNER_STYLE}
      accessibilityLiveRegion='polite'
    >
      <WifiOff size={OFFLINE_BANNER_ICON_SIZE} color={muted} />
      <Text
        className='min-w-0 flex-1 text-[14px] leading-5 tracking-[-0.14px] text-spaces-muted'
        numberOfLines={2}
      >
        {message}
      </Text>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel='Reconnect'
        accessibilityState={{ busy: isReconnecting, disabled: isReconnecting }}
        onPress={onReconnect}
        disabled={isReconnecting}
        hitSlop={OFFLINE_BANNER_HIT_SLOP}
        className='shrink-0 active:opacity-60'
      >
        <Text
          className={`text-[14px] font-medium leading-5 ${isReconnecting ? 'text-spaces-subtle' : 'text-spaces-foreground'}`}
        >
          {isReconnecting ? 'Reconnecting…' : 'Reconnect'}
        </Text>
      </Pressable>
    </View>
  );
});
