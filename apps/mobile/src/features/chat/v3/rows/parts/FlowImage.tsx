import { Image } from 'expo-image';
import type { ReactElement } from 'react';
import type { ImageStyle, ViewStyle } from 'react-native';

import { sanitizeFlowUrl } from '@/src/utils/flowJsonMarkdown';

import { flowImageStyle } from './flowComponentRender';
import { getStringProp } from './flowState';

export const FlowImage = ({
  props,
  renderStyle,
}: {
  props: Record<string, unknown> | undefined;
  renderStyle: ViewStyle;
}): ReactElement | null => {
  const source = sanitizeFlowUrl(getStringProp(props, 'src'));
  if (!source) return null;
  return (
    <Image
      source={{ uri: source }}
      style={[renderStyle as ImageStyle, flowImageStyle(props)]}
      contentFit={props?.['objectFit'] === 'cover' ? 'cover' : 'contain'}
      accessibilityLabel={getStringProp(props, 'alt') || 'Flow image'}
    />
  );
};
