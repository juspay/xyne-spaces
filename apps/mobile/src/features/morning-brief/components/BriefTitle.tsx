import type { ReactElement } from 'react';
import { Platform, Text } from 'react-native';

import { formatBriefTitle } from '../utils/selectors';

/**
 * Libre Baskerville italic, bundled via the expo-font config plugin
 * (app.config.js) — the face behind the web brief title (the web's
 * "semibold" is browser-synthesized; the family only ships a 400 italic).
 * The family name is the file's PostScript name so both platforms resolve
 * the face directly; no fontWeight/fontStyle on top, which would make
 * Android re-resolve the family and lose the face.
 */
export const BRIEF_SERIF_FONT = 'LibreBaskerville-Italic';

export const BRIEF_SERIF_FALLBACK_STYLE = Platform.select({
  ios: { fontFamily: 'Georgia', fontStyle: 'italic' as const, fontWeight: '600' as const },
  default: { fontFamily: 'serif', fontStyle: 'italic' as const, fontWeight: '600' as const },
});

/** Centered serif italic "Brief // Sep 1" — the page's signature moment. */
export function BriefTitle({ date }: { date: string | undefined }): ReactElement {
  return (
    <Text
      className='py-10 text-center text-foreground'
      style={{ fontFamily: BRIEF_SERIF_FONT, fontSize: 34, lineHeight: 42 }}
      accessibilityRole='header'
    >
      {formatBriefTitle(date)}
    </Text>
  );
}
