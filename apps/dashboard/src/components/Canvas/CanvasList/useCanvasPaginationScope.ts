import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

/** Invalidate old callbacks before passive scan/query effects run after a filter reset. */
export function useCanvasPaginationScope(scopeKey: string) {
  const scope = useMemo(() => ({ key: scopeKey }), [scopeKey]);
  const currentScope = useRef<object | null>(null);
  const [readyScope, setReadyScope] = useState(scope);

  useLayoutEffect(() => {
    currentScope.current = scope;
    setReadyScope(scope);
    return () => {
      if (currentScope.current === scope) currentScope.current = null;
    };
  }, [scope]);

  const isReady = readyScope === scope;
  const isCurrent = useCallback(() => isReady && currentScope.current === scope, [isReady, scope]);

  return { isReady, isCurrent };
}
