import React, { useCallback } from 'react';
import { Text, View } from 'react-native';
import { Link as LinkIcon } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useCSSVariable } from 'uniwind';

import { useChannelDisplayName, useVisibleChannelById } from '@/src/hooks/useChannels';
import { useAuthContextValues } from '@/src/contexts/AuthContext';
import {
  HeaderBackButton,
  HeaderPill,
  HEADER_ICON_BUTTON_SIZE,
} from '@/src/components/ui/header-icon-button';

import { LinksHeaderV3Props } from './links-header-v3.types';

const ROOT_SIZE = HEADER_ICON_BUTTON_SIZE;
const GAP_SIZE = 8;
const HORIZONTAL_PADDING = 8;

const LinksHeaderV3: React.FC<LinksHeaderV3Props> = ({ channelId }) => {
  const router = useRouter();
  const { userID: currentUserId } = useAuthContextValues();
  const insets = useSafeAreaInsets();
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const cardColor = useCSSVariable('--color-card') as string;

  const channel = useVisibleChannelById(channelId);
  const displayName = useChannelDisplayName(channel, currentUserId);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <View className='absolute left-0 right-0 top-0' style={{ zIndex: 40 }} pointerEvents='box-none'>
      <LinearGradient
        colors={[cardColor, 'transparent']}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: insets.top + ROOT_SIZE + 2 * HORIZONTAL_PADDING + 16,
        }}
        pointerEvents='none'
      />

      <View style={{ height: insets.top }} pointerEvents='none' />

      <View
        className='relative w-full'
        style={{
          paddingHorizontal: HORIZONTAL_PADDING,
          paddingTop: 0,
          paddingBottom: HORIZONTAL_PADDING,
        }}
        pointerEvents='box-none'
      >
        <View
          className='relative flex-row items-center'
          style={{ height: ROOT_SIZE, gap: GAP_SIZE }}
          pointerEvents='box-none'
        >
          <HeaderBackButton liquidGlass onPress={handleBack} />

          <HeaderPill liquidGlass>
            <View
              className='flex-row items-center px-2'
              style={{ height: ROOT_SIZE }}
              pointerEvents='none'
            >
              <View className='size-8 items-center justify-center'>
                <LinkIcon color={foregroundColor} size={18} />
              </View>
              <View className='min-w-0 flex-1 justify-center'>
                <Text
                  className='text-sm font-medium leading-[18px] text-foreground'
                  numberOfLines={1}
                >
                  Links
                </Text>
                <Text
                  className='text-[11px] leading-[14px] text-secondary-foreground'
                  numberOfLines={1}
                >
                  {displayName}
                </Text>
              </View>
            </View>
          </HeaderPill>
        </View>
      </View>
    </View>
  );
};

export default LinksHeaderV3;
