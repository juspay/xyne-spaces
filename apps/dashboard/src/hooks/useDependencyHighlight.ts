import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useAuth } from './useAuth';
import { useTicketDependenciesEnabled } from './useDependencyState';
import {
  DependencyHighlightStore,
  dependencyHighlightIds,
} from '../services/dependencies/highlight';
import type { DependencyBatch } from '../services/dependencies/types';

const highlights = new DependencyHighlightStore();
const serverSnapshot = () => false;

function useHighlightScope(): string | null {
  const { user, isAuthenticated } = useAuth();
  const enabled = useTicketDependenciesEnabled();
  return enabled && isAuthenticated && user ? JSON.stringify([user.workspaceId, user.id]) : null;
}

export function useDependencyHighlight(ticketId: string): boolean {
  const scope = useHighlightScope();
  return useSyncExternalStore(
    highlights.subscribe,
    () => highlights.contains(scope, ticketId),
    serverSnapshot,
  );
}

export function useDependencyHighlightSource(
  ticketId: string,
  batch: DependencyBatch | undefined,
  open: boolean,
): void {
  const scope = useHighlightScope();
  const owner = useRef(Symbol('dependency highlight'));
  useEffect(() => {
    if (!scope || !open || !batch) return;
    return highlights.activate(scope, owner.current, dependencyHighlightIds(ticketId, batch));
  }, [scope, ticketId, batch, open]);
}
