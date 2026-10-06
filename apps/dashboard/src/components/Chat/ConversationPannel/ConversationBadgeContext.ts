import { createContext, type ReactNode } from 'react';
import type { SdlcSourceLink } from '../../../routes/SdlcScreen/sdlcItems';

/**
 * The conversation a badge is for. A list scoped to SDLC discussions brings each one's
 * DISCUSSION link with it, and the item it is about, so the badge knows where it is
 * happening without asking.
 */
export interface ConversationBadgeSubject {
  conversationId: string;
  sdlcEntityLinks?: ReadonlyArray<SdlcSourceLink> | undefined;
}

export type ConversationBadgeRenderer = (conversation: ConversationBadgeSubject) => ReactNode;

export const ConversationBadgeContext = createContext<ConversationBadgeRenderer | null>(null);
