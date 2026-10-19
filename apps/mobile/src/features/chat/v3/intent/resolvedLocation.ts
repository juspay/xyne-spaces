import { intentKeyFor, type OpenSurface } from './openIntent.types';

/** Final place to land after `resolving`. The reducer builds `target` from this once. */
export type ResolvedAnchor = {
  conversationId: string;
  messageId: string;
  createdAt: number;
};

export type UnreadBoundary = {
  at: number;
  conversationId?: string;
};

export type ResolvedLocation = {
  surface: OpenSurface;
  anchor: ResolvedAnchor | null;
  unreadBoundary: UnreadBoundary | null;
};

export const landingKeyForLocation = (location: ResolvedLocation): string => {
  if (location.anchor) {
    return `anchor:${location.anchor.messageId}`;
  }
  return 'tail';
};

export const intentWithResolvedSurface = <T extends { surface: OpenSurface; intentKey: string }>(
  intent: T,
  surface: OpenSurface,
): T => ({
  ...intent,
  surface,
  intentKey: intentKeyFor(surface),
});
