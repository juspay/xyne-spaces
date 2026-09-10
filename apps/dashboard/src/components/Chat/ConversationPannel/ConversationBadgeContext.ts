import { createContext, type ReactNode } from 'react';

export type ConversationBadgeRenderer = (conversationId: string) => ReactNode;

export const ConversationBadgeContext = createContext<ConversationBadgeRenderer | null>(null);
