import { memo, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { GuideIcon, isGuideIconKey } from '../guide-icons';
import { parseStepTokens, stripStepTokens } from '../step-tokens';

const INLINE_ICON_SIZE = 13;
const INLINE_ICON_BOX = 20;

type GuideStepTextProps = {
  text: string;
  color: string;
  fontSize?: number;
  lineHeight?: number;
};

/**
 * A step body with `[[Icon]]` tokens rendered as small boxed glyphs inline.
 * Views nested inside Text flow with the line, so the glyph sits where the word
 * would. Unknown keys fall back to their literal text rather than vanishing.
 */
export const GuideStepText = memo(function GuideStepText({
  text,
  color,
  fontSize = 15,
  lineHeight = 22,
}: GuideStepTextProps): ReactElement {
  const boxBg = useCSSVariable('--color-settings-bg') as string;
  const boxBorder = useCSSVariable('--color-settings-row-divider') as string;
  const segments = parseStepTokens(text);

  return (
    <Text style={{ color, fontSize, lineHeight }} accessibilityLabel={stripStepTokens(text)}>
      {segments.map((segment, index) => {
        if (segment.type === 'icon' && isGuideIconKey(segment.value)) {
          return (
            <View
              key={`${segment.value}-${index}`}
              accessible={false}
              style={{
                width: INLINE_ICON_BOX,
                height: INLINE_ICON_BOX,
                borderRadius: 5,
                borderWidth: 1,
                borderColor: boxBorder,
                backgroundColor: boxBg,
                alignItems: 'center',
                justifyContent: 'center',
                marginHorizontal: 2,
                transform: [{ translateY: 4 }],
              }}
            >
              <GuideIcon name={segment.value} size={INLINE_ICON_SIZE} color={color} />
            </View>
          );
        }
        return <Text key={`t-${index}`}>{segment.value}</Text>;
      })}
    </Text>
  );
});
