import { memo, useMemo, type ReactElement } from 'react';
import { Platform, Text, type TextStyle } from 'react-native';

import { COMPOSER_INPUT_FONT_SIZE, COMPOSER_INPUT_LINE_HEIGHT } from './composer-input-typography';
import { parseComposerHtmlToUnfocusedPreviewSegments } from './utils/composer-unfocused-preview.utils';

type ComposerUnfocusedPreviewProps = {
  html: string;
  fallbackText: string;
  textColor: string;
  mentionBg: string;
  mentionText: string;
};

const ComposerUnfocusedPreviewComponent = ({
  html,
  fallbackText,
  textColor,
  mentionBg,
  mentionText,
}: ComposerUnfocusedPreviewProps): ReactElement | null => {
  const segments = useMemo(
    () => parseComposerHtmlToUnfocusedPreviewSegments(html, fallbackText),
    [fallbackText, html],
  );

  if (segments.length === 0) {
    return null;
  }

  const baseTextStyle: TextStyle = {
    fontSize: COMPOSER_INPUT_FONT_SIZE,
    lineHeight: COMPOSER_INPUT_LINE_HEIGHT,
    color: textColor,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  };

  return (
    <Text className='min-w-0 flex-1' style={baseTextStyle} numberOfLines={1} ellipsizeMode='tail'>
      {segments.map((segment, index) => {
        if (segment.type === 'mention') {
          return (
            <Text
              key={`mention-${index}`}
              style={{
                backgroundColor: mentionBg,
                color: mentionText,
              }}
            >
              {segment.label}
            </Text>
          );
        }

        return segment.value;
      })}
    </Text>
  );
};

const ComposerUnfocusedPreview = memo(ComposerUnfocusedPreviewComponent);
ComposerUnfocusedPreview.displayName = 'ComposerUnfocusedPreview';

export { ComposerUnfocusedPreview };
