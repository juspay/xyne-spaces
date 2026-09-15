/**
 * The Xyne Spaces boot mark — logo over wordmark.
 *
 * Extracted from `AppLoader` so the same brand can stand in for a loading state
 * that is NOT the whole app: the artifact sandbox takes seconds to boot its
 * bundler, and a generic spinner there read as "something is stuck" rather than
 * "this is ours, it is coming". The container is the caller's problem — this is
 * only the mark, so the app loader keeps its fixed full-screen backdrop while
 * the sandbox overlay fills a panel.
 *
 * Sized rather than scaled: 80px is right against a full viewport and far too
 * loud inside a 320px-tall inline card.
 */

import type { ReactElement } from 'react';

const SIZES = {
  sm: { logo: 'h-9 w-9', word: 'w-[60px]', gap: 'gap-2' },
  md: { logo: 'h-14 w-14', word: 'w-[88px]', gap: 'gap-3' },
  lg: { logo: 'h-[80px] w-[80px]', word: 'w-[120px]', gap: 'gap-4' },
} as const;

export type AppLoaderMarkSize = keyof typeof SIZES;

export const AppLoaderMark = ({
  size = 'lg',
  className = '',
}: {
  size?: AppLoaderMarkSize;
  className?: string;
}): ReactElement => {
  const s = SIZES[size];
  return (
    <div className={`flex flex-col items-center ${s.gap} ${className}`}>
      {/* Decorative: the accessible name belongs on the loading region that
          wraps this, not on two images that together say one thing. */}
      <img
        src='/images/xyne_logo_loading.png'
        alt=''
        className={s.logo}
        loading='eager'
        decoding='async'
      />
      <img
        src='/images/spaces_logo_loading.png'
        alt=''
        className={s.word}
        loading='eager'
        decoding='async'
      />
    </div>
  );
};
