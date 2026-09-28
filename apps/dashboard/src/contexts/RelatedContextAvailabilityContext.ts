import { createContext, useContext } from 'react';

/**
 * Whether composers inside this subtree may suggest related context. On everywhere by
 * default; the related-context popup turns it off for the screens it embeds, so
 * replying in a thread shown there doesn't start its own lookups or open a second
 * popup on top of the first.
 */
export const RelatedContextAvailabilityContext = createContext(true);

export const useRelatedContextAvailable = (): boolean =>
  useContext(RelatedContextAvailabilityContext);
