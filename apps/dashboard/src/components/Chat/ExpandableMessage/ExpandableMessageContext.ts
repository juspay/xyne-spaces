import { createContext, useContext, useEffect } from 'react';

/** Collapsed height (px) of an ExpandableMessage before "Show more"; the default `maxHeight`. */
export const EXPANDABLE_MESSAGE_MAX_HEIGHT = 500;

interface ExpandableMessageContextValue {
  setChildExpanded: (expanded: boolean) => void;
}

export const ExpandableMessageContext = createContext<ExpandableMessageContextValue | null>(null);

/**
 * Lets a self-collapsing block inside an ExpandableMessage (e.g. a long code block)
 * tell the message it was expanded, so the message doesn't clip it again and show
 * a second "Show more / Show less" toggle.
 */
export function useReportExpandedToMessage(isExpanded: boolean): void {
  const ctx = useContext(ExpandableMessageContext);

  useEffect(() => {
    if (!ctx || !isExpanded) return undefined;
    ctx.setChildExpanded(true);
    return () => ctx.setChildExpanded(false);
  }, [ctx, isExpanded]);
}
