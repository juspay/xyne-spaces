import { useEffect, useState } from 'react';
import { isEmojiDataReady, loadEmojiData } from '../utils/emojiLookup';

/**
 * Ensures the lazily-loaded emoji-datasource cache is populated and triggers a
 * re-render of the calling component once it lands.
 *
 * `renderEmoji`'s unicode-shortcode branch reads that cache synchronously via
 * `findUnicodeEmoji`. Without this hook, a component that renders a unicode
 * shortcode before the cache is warm would show the neutral fallback icon and
 * never update. Call this hook in components that render reaction emoji so the
 * fallback flips to the real emoji as soon as the datasource is ready. The
 * shared module-level cache means only the first caller pays the load cost.
 */
export function useEmojiDataReady(): boolean {
  const [ready, setReady] = useState<boolean>(isEmojiDataReady());

  useEffect(() => {
    if (ready) return;
    let active = true;
    void loadEmojiData().then((): void => {
      if (active) setReady(true);
    });
    return (): void => {
      active = false;
    };
  }, [ready]);

  return ready;
}
