import { useMemo, type ReactElement, type ReactNode } from 'react';
import { useCSSVariable, useUniwind } from 'uniwind';

import { deriveBubbleAccent, type BubbleAccent } from '@/src/theme/bubbleAccent';
import { BubbleAccentContext } from '@/src/theme/bubbleAccentContext';
import { useSelectedChatBubbleContentTokens } from '@/src/theme/useSelectedChatBubbleContentTokens';

export const DEFAULT_ACCENT_SURFACE_VAR = '--color-tabs-screen';

/**
 * Derives the brand accent once for the whole app.
 *
 * Consumers previously each opened their own subscriptions — `useUniwind`, an
 * xstate selector on the settings actor, and two CSS variables — and re-derived
 * the same colours. That is invisible on a settings screen and expensive in a
 * recycled list, where forty rows meant forty copies of the same work and the
 * same fan-out on every settings change. Deriving here means consumers do a
 * context read and nothing else.
 */
export const BubbleAccentProvider = ({ children }: { children: ReactNode }): ReactElement => {
  const { theme } = useUniwind();
  const { selectedBubbleBg } = useSelectedChatBubbleContentTokens();
  const surface = useCSSVariable(DEFAULT_ACCENT_SURFACE_VAR) as string;

  const value = useMemo(
    () => deriveBubbleAccent(selectedBubbleBg, theme, surface),
    [selectedBubbleBg, theme, surface],
  );

  return <BubbleAccentContext.Provider value={value}>{children}</BubbleAccentContext.Provider>;
};

/**
 * Derives the accent against a surface other than the screen background — a card
 * or a sheet. Does its own subscriptions and colour maths, so keep it out of list
 * rows; prefer `useBubbleAccent` unless the contrast floor genuinely needs to be
 * measured against something else. Lives here because it needs `uniwind`.
 */
export const useBubbleAccentForSurface = (
  surfaceVar: `--color-${string}` = DEFAULT_ACCENT_SURFACE_VAR,
): BubbleAccent => {
  const { theme } = useUniwind();
  const { selectedBubbleBg } = useSelectedChatBubbleContentTokens();
  const surface = useCSSVariable(surfaceVar) as string;

  return useMemo(
    () => deriveBubbleAccent(selectedBubbleBg, theme, surface),
    [selectedBubbleBg, theme, surface],
  );
};
