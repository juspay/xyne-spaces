import { memo, type ReactElement } from 'react';
import { View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { type ChatInputFormatProps } from './input-composer-format-shared';

const FormatDividerComponent = ({ className }: ChatInputFormatProps): ReactElement => {
  const borderColor = useCSSVariable('--color-border') as string;
  return <View className={className ?? 'w-px h-5'} style={{ backgroundColor: borderColor }} />;
};
const FormatDivider = memo(FormatDividerComponent);

FormatDivider.displayName = 'ChatInput.FormatDivider';

export { FormatDivider };
