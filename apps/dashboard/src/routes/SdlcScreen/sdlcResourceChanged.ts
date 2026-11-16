import { useEffect } from 'react';
import { queryClient } from '../../services/clients/queryClient';
import { websocketService } from '../../services/clients/socketClient';

export const SDLC_RESOURCE_KINDS = ['agents', 'knowledge', 'environments'] as const;
export type SdlcResourceKind = (typeof SDLC_RESOURCE_KINDS)[number];

export function isSdlcResourceKind(kind: unknown): kind is SdlcResourceKind {
  return SDLC_RESOURCE_KINDS.includes(kind as SdlcResourceKind);
}

// Query key prefixes each kind's views read; only mounted queries refetch.
const QUERY_KEYS: Record<SdlcResourceKind, string[]> = {
  agents: ['claw-auth-agents', 'claw-subagents', 'sdlc-hub-agents'],
  // The Skills tab reads the claw skill catalog next to the hub's links.
  knowledge: ['sdlc-hub-knowledge', 'claw-skills'],
  environments: ['sdlc-environments', 'sdlc-sandbox-profiles', 'claw-sandbox-repos'],
};

export function invalidateSdlcResource(kind: SdlcResourceKind): void {
  for (const key of QUERY_KEYS[kind]) void queryClient.invalidateQueries({ queryKey: [key] });
}

export function refreshSdlcResource(kind: SdlcResourceKind): void {
  invalidateSdlcResource(kind);
}

/**
 * Joins the workspace's SDLC resource room while `onPage`, so only open pages get the push.
 * Each join refetches too, since pushes sent while off the page were missed.
 */
export function useSdlcResourceRoom(onPage: boolean): void {
  useEffect(() => {
    if (!onPage) return;
    let left = false;
    let socket = websocketService.getSocket();
    const join = (): void => {
      websocketService.emit('subscribe_to_sdlc_resources');
      SDLC_RESOURCE_KINDS.forEach(refreshSdlcResource);
    };
    const attach = (): void => {
      socket?.on('connect', join);
      if (socket?.connected) join();
    };
    // connect() replaces a socket that is mid-reconnect, dropping every listener on it; only call it when none exists.
    if (socket) attach();
    else
      void websocketService
        .connect()
        .then(() => {
          if (left) return;
          socket = websocketService.getSocket();
          attach();
        })
        .catch(() => {});
    return (): void => {
      left = true;
      socket?.off('connect', join);
      websocketService.emit('unsubscribe_from_sdlc_resources');
    };
  }, [onPage]);
}
