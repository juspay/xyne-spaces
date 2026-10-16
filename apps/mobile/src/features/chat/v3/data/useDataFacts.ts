import { useRef } from 'react';

import type { DataFacts, LandingTarget } from '../machine/openState';
import { deriveDataFacts, isSameDataFacts } from './deriveDataFacts';
import type { ConversationWindow } from './normalizeConversationWindow';
import type { WarmWindow } from '../warm/warmWindow.types';

/**
 * Machine data inputs, derived during render. Never stored in React state.
 * Reused when the derived booleans are unchanged so a `dataFactsChanged`
 * dispatch can be keyed on reference equality (C4 — no Effect to copy facts).
 */
export const useDataFacts = (
  window: ConversationWindow,
  target: LandingTarget,
  warm: WarmWindow | null = null,
): DataFacts => {
  const next = deriveDataFacts(window, target, warm);
  const prevRef = useRef(next);
  if (!isSameDataFacts(prevRef.current, next)) {
    prevRef.current = next;
  }
  return prevRef.current;
};
