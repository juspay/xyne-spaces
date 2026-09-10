import { createContext, type ReactNode } from 'react';

/**
 * Lets a host mark each conversation in the feed without threading a prop
 * through the panel, the list, the item and the bubble. The SDLC hub uses it to
 * say which folder a conversation was started in, because a track's list shows
 * the conversations of every folder inside it alongside its own.
 *
 * Returning null for a conversation renders nothing for it, which is what every
 * surface that does not provide a renderer does.
 */
export type ConversationBadgeRenderer = (conversationId: string) => ReactNode;

export const ConversationBadgeContext = createContext<ConversationBadgeRenderer | null>(null);
