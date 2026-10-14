import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import type { GuidePlatform } from '../types';

export const PLATFORM_LABELS: Readonly<Record<GuidePlatform, string>> = {
  ios: 'iOS',
  android: 'Android',
};

type PillProps = {
  label: string;
  /** Accent pills carry the brand tint; plain pills are outlined. */
  tone?: 'accent' | 'plain';
  accentSoft?: string;
  accentText?: string;
};

export const GuidePill = ({
  label,
  tone = 'plain',
  accentSoft,
  accentText,
}: PillProps): ReactElement => {
  const border = useCSSVariable('--color-settings-row-divider') as string;
  const plainText = useCSSVariable('--color-settings-description') as string;
  const isAccent = tone === 'accent' && accentSoft && accentText;

  return (
    <View
      className='rounded-full px-2.5 py-1'
      style={isAccent ? { backgroundColor: accentSoft } : { borderWidth: 1, borderColor: border }}
    >
      <Text
        className='text-[12px] font-semibold'
        style={{ color: isAccent ? accentText : plainText }}
      >
        {label}
      </Text>
    </View>
  );
};
