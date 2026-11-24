import { useSyncExternalStore } from 'react';

import { useAuth } from '@/src/contexts/AuthContext';

import { bubblesFor, getBubbles, subscribeBubbles, type BubbleState } from '../model/bubble-store';

/** Whose parked threads are showing: the signed-in user in the active workspace. */
export function useBubbleScope(): string | null {
  const { user } = useAuth();
  return user ? `${user.workspaceId}:${user.user_id}` : null;
}

/** The parked threads `scope` may see, re-rendering when they change. */
export function useBubbles(scope: string | null): BubbleState {
  const current = useSyncExternalStore(subscribeBubbles, getBubbles, getBubbles);
  return bubblesFor(current, scope);
}
