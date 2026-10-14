import { createContext } from 'react';

import type { BubbleAccent } from '@/src/theme/bubbleAccent';

/**
 * Deliberately its own module, holding nothing but the context.
 *
 * The provider needs `uniwind` to read the theme and CSS variables; consumers
 * need only a context read. Keeping them in one file put `uniwind` — untransformed
 * ESM under Jest — into the import graph of every component that shows a badge or
 * a button, which broke render tests that have nothing to do with theming.
 */
export const BubbleAccentContext = createContext<BubbleAccent | null>(null);
