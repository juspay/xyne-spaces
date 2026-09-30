import { createContext, useContext, useEffect, useRef } from 'react';

/** "Collapse all" / "Expand all" from the builder toolbar; each click is a new object. */
export interface CollapseAllSignal {
  collapsed: boolean;
}

export const CollapseAllContext = createContext<CollapseAllSignal | null>(null);

/**
 * Applies each new signal once to a card's own `collapsed` state, so cards can still be
 * toggled one by one; cards added later start expanded.
 */
export function useCollapseAll(setCollapsed: (collapsed: boolean) => void): void {
  const signal = useContext(CollapseAllContext);
  const applied = useRef(signal);
  useEffect(() => {
    if (!signal || signal === applied.current) return;
    applied.current = signal;
    setCollapsed(signal.collapsed);
  }, [signal, setCollapsed]);
}
