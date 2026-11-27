import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from './useAuth';
import {
  dependencyConsent,
  runDependencyMutation,
  type DependencyMutationResult,
  type DependencyOverride,
} from '../services/dependencies/gate';

/** Each surface owns its pending intent. A replacement move, identity change or unmount cancels it. */
export function useDependencyMutation(intentKey?: string) {
  const { user, isAuthenticated } = useAuth();
  const scope =
    isAuthenticated && user ? JSON.stringify([user.workspaceId, user.id, intentKey]) : null;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), [scope]);
  return useCallback(
    async <T extends DependencyMutationResult | undefined>(
      execute: (override?: DependencyOverride) => Promise<T>,
      onRefused?: () => void,
    ) => {
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      const identity = currentScope.current;
      // Original writer may still report its ordinary auth failure. No consent/retry without a session.
      if (!identity) return execute();
      try {
        return await runDependencyMutation(
          execute,
          async gate => {
            if (currentScope.current !== identity) return null;
            return dependencyConsent.ask(identity, gate, controller.signal);
          },
          controller.signal,
          onRefused,
          () => currentScope.current === identity,
        );
      } finally {
        if (pending.current === controller) pending.current = null;
      }
    },
    [],
  );
}
