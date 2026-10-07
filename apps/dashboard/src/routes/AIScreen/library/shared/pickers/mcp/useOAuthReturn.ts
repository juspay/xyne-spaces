import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useClawMcp } from '@/hooks/useClawMcp';
import { oauthReturnMessage, readOAuthReturn } from './oauthReturn';

/**
 * Finishes a connector sign-in on the page it was started from: the callback
 * sends the browser back here with `?<type>_connected=true` or
 * `?<type>_error=…`. Refetches connections so every card shows the new state,
 * says how it went, and takes the parameter off the URL so a reload doesn't
 * say it again.
 */
export function useOAuthReturn(): void {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const mcp = useClawMcp();
  const handled = useRef(false);
  const result = readOAuthReturn(params);
  // Waits for the connector list so the toast can name the connector.
  const ready = Boolean(user?.id) && (mcp.isSuccess || mcp.isError);

  useEffect(() => {
    if (!result || !ready || handled.current) return;
    handled.current = true;
    const label =
      mcp.data?.servers.find(server => server.type === result.type)?.name ?? result.type;
    if (result.ok) {
      void queryClient.invalidateQueries({ queryKey: ['claw-mcp', user?.id] });
      toast.success(oauthReturnMessage(result, label));
    } else {
      toast.error(oauthReturnMessage(result, label));
    }
    setParams(
      current => {
        const next = new URLSearchParams(current);
        for (const key of result.keys) next.delete(key);
        return next;
      },
      { replace: true },
    );
  }, [mcp.data, queryClient, ready, result, setParams, user?.id]);
}
