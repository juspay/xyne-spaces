import { createContext, useContext } from 'react';

/**
 * Whether screens inside this subtree may offer "Ask AI". On everywhere by default;
 * a host that embeds whole screens for one purpose — the composer's related-context
 * popup — turns it off, so a thread, canvas or recording shown there doesn't open a
 * second assistant from inside a modal.
 */
export const AskAIAvailabilityContext = createContext(true);

export const useAskAIAvailable = (): boolean => useContext(AskAIAvailabilityContext);
